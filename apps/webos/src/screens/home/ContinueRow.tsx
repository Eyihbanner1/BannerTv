import { type ContinueItem, continueWatching } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import type { TFunction } from 'i18next';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenSlot } from '../../app/screen-slot';
import { Row } from '../../components/Row';
import type { TileExtra } from '../../components/Tile';
import { fillPlayedCards } from '../../data/continue';
import { playedVideos, progress } from '../../data/playback';
import { rememberFocus, rememberScroll } from '../../navigation/focus-memory';

/** The row's key on Home, beside the catalog rows' keys. */
export const CONTINUE_ROW_KEY = 'continue';
export const CONTINUE_FOCUS_KEY = `home-${CONTINUE_ROW_KEY}`;
const FIRST_TILE = `${CONTINUE_FOCUS_KEY}-tile-0`;
const HOUR_MS = 60 * 60 * 1000;

// The list is worked out once per change of progress or cards, whoever asks,
// and once an hour, for next episodes that air while the app is open.
let latest: { key: string; items: ContinueItem[] } | null = null;
function snapshot(): ContinueItem[] {
  const now = Date.now();
  const key = `${progress.version()}:${playedVideos.version()}:${Math.floor(now / HOUR_MS)}`;
  if (!latest || latest.key !== key) {
    latest = { key, items: continueWatching(progress, playedVideos.get, now) };
  }
  return latest.items;
}

/**
 * The titles to continue, or null until saved progress has been read. Worked
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
      const undo = [
        slot.subscribe(listener),
        progress.subscribe(whileShown),
        playedVideos.subscribe(whileShown),
      ];
      return () => undo.forEach((stop) => stop());
    },
    [slot],
  );
  const items = useSyncExternalStore(subscribe, snapshot);
  const [loaded, setLoaded] = useState(false);
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
  // Cards for older progress are filled in while Home is on show.
  useEffect(() => {
    if (!loaded) return;
    const fill = () => {
      if (slot.get()) fillPlayedCards();
    };
    fill();
    return slot.subscribe(fill);
  }, [loaded, slot]);
  return loaded ? items : null;
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
      const item = items[previews.indexOf(preview)];
      if (!item) return;
      // What plays becomes the most recent, so Back finds it on the first
      // tile, with the row scrolled back to the start.
      rememberScroll(CONTINUE_FOCUS_KEY, 0);
      rememberFocus(CONTINUE_FOCUS_KEY, FIRST_TILE);
      push(
        {
          name: 'player',
          type: preview.type,
          metaId: preview.id,
          videoId: item.videoId,
          preview,
          startAt: item.startAt,
        },
        FIRST_TILE,
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
