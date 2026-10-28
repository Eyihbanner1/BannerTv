import { type ContinueItem, continueWatching } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import type { TFunction } from 'i18next';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenSlot } from '../../app/screen-slot';
import { Row } from '../../components/Row';
import type { TileExtra } from '../../components/Tile';
import { cardsMissing, fillPlayedCards, onCardAnswer } from '../../data/continue';
import { playedVideos, progress } from '../../data/playback';
import { onActivity } from '../../navigation/activity';
import { rememberFocus, rememberScroll } from '../../navigation/focus-memory';

/** The row's key on Home, beside the catalog rows' keys. */
export const CONTINUE_ROW_KEY = 'continue';
export const CONTINUE_FOCUS_KEY = `home-${CONTINUE_ROW_KEY}`;
const HOUR_MS = 60 * 60 * 1000;
/** How long after launch Home waits for a tile whose card is still being fetched. */
const CARD_WAIT_MS = 3000;
// A steady clock, so the TV setting its time just after power-on cannot stretch the wait.
const launchedAt = performance.now();
const sinceLaunch = () => performance.now() - launchedAt;

const sameTitles = (a: readonly ContinueItem[], b: readonly ContinueItem[]) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index]!;
    return (
      item.videoId === other.videoId &&
      item.startAt === other.startAt &&
      item.progress === other.progress &&
      item.upNext === other.upNext
    );
  });

// The list is worked out once per change of progress or cards, whoever asks,
// and once an hour, for next episodes that air while the app is open.
let latest: { versions: string; hour: number; items: ContinueItem[] } | null = null;
function snapshot(): ContinueItem[] {
  const now = Date.now();
  const versions = `${progress.version()}:${playedVideos.version()}`;
  const hour = Math.floor(now / HOUR_MS);
  if (latest && latest.versions === versions && latest.hour === hour) return latest.items;
  let items = continueWatching(progress, playedVideos.get, now);
  // With the same progress and cards, a new hour changes the row only when an episode aired.
  if (latest && latest.versions === versions && sameTitles(items, latest.items)) {
    items = latest.items;
  }
  latest = { versions, hour, items };
  return items;
}

/**
 * The tile Back lands on after playing `metaId` from tile `pressed`: that
 * title wherever the row has it now (the first tile once playing made it the
 * most recent, the same tile if nothing was saved), or the first tile once it
 * has left the row. The row is scrolled to match before it draws again.
 */
function returnTile(metaId: string, pressed: number): string | undefined {
  const items = snapshot();
  if (items.length === 0) return undefined;
  const found = items.findIndex((item) => item.preview.id === metaId);
  const index = found < 0 ? 0 : found;
  const tile = `${CONTINUE_FOCUS_KEY}-tile-${index}`;
  if (index !== pressed) {
    rememberScroll(CONTINUE_FOCUS_KEY, index);
    rememberFocus(CONTINUE_FOCUS_KEY, tile);
  }
  return tile;
}

/**
 * The titles to continue, or null until saved progress has been read (and,
 * just after launch, until titles waiting for their cards have them). Worked
 * out again only while Home is on show: the player saves progress every few
 * seconds while Home sits hidden underneath, and showing Home again catches
 * up. Covering or uncovering Home re-renders it only when the list changed.
 */
export function useContinueItems(): ContinueItem[] | null {
  const slot = useScreenSlot();
  const subscribe = useCallback(
    (listener: () => void) => {
      const whileShown = () => {
        if (slot.get()) listener();
      };
      // On the hour while Home is on show, for a next episode that has just aired.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onTheHour = () => {
        clearTimeout(timer);
        if (!slot.get()) return;
        timer = setTimeout(
          () => {
            listener();
            onTheHour();
          },
          HOUR_MS - (Date.now() % HOUR_MS) + 1000,
        );
      };
      onTheHour();
      const undo = [
        slot.subscribe(() => {
          onTheHour();
          listener();
        }),
        progress.subscribe(whileShown),
        playedVideos.subscribe(whileShown),
        () => clearTimeout(timer),
      ];
      return () => undo.forEach((stop) => stop());
    },
    [slot],
  );
  const items = useSyncExternalStore(subscribe, snapshot);
  const [loaded, setLoaded] = useState(false);
  // The wait ends at the cap, when no answer is still to come, or when the
  // viewer uses the remote. A press then shows where focus is, as on a screen
  // with nothing focused: the wait ends after the press is handled, so OK
  // never presses a tile that was not shown focused, nor Back leaves the app.
  const [waited, setWaited] = useState(() => sinceLaunch() >= CARD_WAIT_MS);
  useEffect(() => {
    if (waited) return;
    const stop = () => setWaited(true);
    const timer = setTimeout(stop, CARD_WAIT_MS - sinceLaunch());
    const undo = [
      onCardAnswer(() => {
        if (!cardsMissing()) stop();
      }),
      onActivity(() => {
        setTimeout(stop, 0);
      }),
    ];
    return () => {
      clearTimeout(timer);
      undo.forEach((off) => off());
    };
  }, [waited]);
  useEffect(() => {
    let live = true;
    void Promise.all([progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  // Cards for older progress are filled in while Home is on show, walking
  // further back as cards that arrive turn out to take no place on the row.
  useEffect(() => {
    if (!loaded) return;
    const fill = () => {
      if (slot.get()) fillPlayedCards();
    };
    fill();
    const undo = [slot.subscribe(fill), playedVideos.subscribe(fill)];
    return () => undo.forEach((stop) => stop());
  }, [loaded, slot]);
  if (!loaded) return null;
  // Progress can come without the title's name and artwork, as after an
  // update, and its card is fetched at launch. Home waits a moment for it, so
  // it opens on the row rather than the row arriving above the catalogs.
  if (items.length === 0 && !waited && cardsMissing()) return null;
  return items;
}

function noteFor(t: TFunction, item: ContinueItem): string | undefined {
  if (item.season !== undefined && item.episode !== undefined) {
    const numbers = { season: item.season, episode: item.episode };
    return item.upNext ? t('home.nextEpisodeNote', numbers) : t('home.episodeNote', numbers);
  }
  return item.upNext ? t('home.nextNote') : undefined;
}

interface ContinueRowProps {
  items: readonly ContinueItem[];
  onItemFocus: (rowKey: string, item: MetaPreview | undefined) => void;
}

/**
 * Continue Watching: what was left part-way, most recent first, as wide
 * tiles with a progress bar. OK goes straight back into the player where
 * playback stopped, or into the next episode.
 */
export const ContinueRow = memo(function ContinueRow({ items, onItemFocus }: ContinueRowProps) {
  const { t } = useTranslation();
  const previews = useMemo(() => items.map((item) => item.preview), [items]);
  const extras = useMemo(
    () =>
      items.map((item): TileExtra => {
        const extra: TileExtra = {};
        const note = noteFor(t, item);
        if (note) extra.note = note;
        if (item.progress !== undefined) extra.progress = item.progress;
        return extra;
      }),
    [items, t],
  );
  // A card filled in while the row has focus can move titles under it; Row
  // reports the title now under focus, so the hero follows.
  const onFocus = useCallback(
    (preview: MetaPreview | undefined) => onItemFocus(CONTINUE_ROW_KEY, preview),
    [onItemFocus],
  );
  const onPress = useCallback(
    (preview: MetaPreview) => {
      const index = previews.indexOf(preview);
      const item = items[index];
      if (!item) return;
      push(
        {
          name: 'player',
          type: preview.type,
          metaId: preview.id,
          videoId: item.videoId,
          preview,
          startAt: item.startAt,
        },
        () => returnTile(preview.id, index),
      );
    },
    [items, previews],
  );
  return (
    <Row
      focusKey={CONTINUE_FOCUS_KEY}
      scrollKey={items}
      title={t('home.continueWatching')}
      shape="landscape"
      items={previews}
      extras={extras}
      onItemFocus={onFocus}
      onItemPress={onPress}
    />
  );
});
