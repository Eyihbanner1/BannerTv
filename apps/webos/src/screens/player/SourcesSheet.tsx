import {
  keepOrder,
  otherLanguages,
  releaseShort,
  type QualityReference,
  type StreamEntry,
  type StreamOrder,
  streamTier,
} from '@bannertv/core';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import { addonNames } from '../../data/addons';
import { preferences, setPreference } from '../../data/preferences';
import { streamBadges, streamRowText } from '../../player/describe';
import { entryKey, isHeavy, listOrder, type StreamFinder } from '../../player/finder';
import {
  filterButtonLabel,
  filteredStatus,
  filterKey,
  shownStreams,
} from '../../player/stream-filter';
import { StreamFilterMenu } from '../streams/StreamFilterMenu';
import { Pane } from './SheetTabs';
import { SheetDetail } from './SheetDetail';
import { rowParts, type SheetRow, SheetList } from './SheetList';
import styles from './SourcesSheet.module.css';

const SHEET = 'player-sources';
const ORDERS: readonly StreamOrder[] = ['quality', 'fast', 'addon'];
/** Two lines a row: what the stream is (picture, sound, size), then its addon and release. */
const ROW_HEIGHT = 100;
const VISIBLE = 4;

/**
 * Streams in the order first shown under each order and tier: those shown
 * keep their places while more addons answer, and new ones go after the
 * others of their tier, never above the one in focus nor below those that
 * cannot play.
 */
function rememberPlaces() {
  const seen = new Map<string, string[]>();
  return (order: StreamOrder, entries: readonly StreamEntry[]): StreamEntry[] => {
    const tiers: StreamEntry[][] = [[], [], [], []];
    for (const entry of entries) tiers[streamTier(entry)]!.push(entry);
    const placed: StreamEntry[] = [];
    tiers.forEach((tier, index) => {
      const scope = `${order}:${index}`;
      const byKey = new Map(tier.map((entry) => [entryKey(entry), entry]));
      const keys = keepOrder(seen.get(scope) ?? [], Array.from(byKey.keys()));
      seen.set(scope, keys);
      for (const key of keys) placed.push(byKey.get(key)!);
    });
    return placed;
  };
}

/**
 * Every stream the addons offered, over the picture, which keeps playing: the
 * same list, order and filter as All streams, with the stream playing ticked
 * and listed whatever the filter. It asks the addons nothing and tests
 * nothing: the decoder is the film's.
 */
export function SourcesSheet({
  finder,
  playing,
  reference,
  returnFocusKey,
  onPick,
  onAllStreams,
  onBack,
  onClose,
}: {
  finder: StreamFinder;
  playing: StreamEntry | null;
  /** What plays, for the "Spanish audio" note. */
  reference?: QualityReference;
  returnFocusKey: () => string;
  onPick: (entry: StreamEntry) => void;
  onAllStreams: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(finder.subscribe, finder.get);
  const order = useSyncExternalStore(
    preferences.subscribe,
    () => preferences.get().allStreamsOrder,
  );
  const filter = useSyncExternalStore(preferences.subscribe, () => preferences.get().streamFilter);
  const [filtering, setFiltering] = useState(false);
  const [stable] = useState(rememberPlaces);
  // Places are kept for the whole list, so a filter taken off puts rows back where they were.
  const ordered = useMemo(
    () => stable(order, listOrder(state.entries, order, finder.orderOptions())),
    [stable, state.entries, order, finder],
  );
  const playingKey = playing ? entryKey(playing) : undefined;
  const shown = useMemo(
    () => shownStreams(ordered, filter, (entry) => entryKey(entry) === playingKey),
    [ordered, filter, playingKey],
  );
  const entries = shown.entries;
  const seconds = finder.runtimeSeconds();
  // The player draws a few times a second as the film plays: the rows are
  // built again only when the streams, what plays, or their tests change.
  const pick = useRef(onPick);
  useLayoutEffect(() => {
    pick.current = onPick;
  });
  const { probes } = state;
  // The stream focused, whose addon, notes and release in full show in the box beside.
  const [focused, setFocused] = useState<string | null>(null);
  const described = useMemo(() => {
    const names = addonNames();
    return entries.map((entry) => {
      const key = entryKey(entry);
      const text = streamRowText(t, entry, {
        heavy: isHeavy(entry, seconds),
        languages: otherLanguages(entry.facts, reference),
      });
      // The facts on boxes and remotes lead; whether it is cached is a tag of its own.
      const facts = streamBadges(entry.facts);
      return {
        entry,
        key,
        text,
        facts,
        cached: entry.facts.cached === true,
        tested: probes[key] === 'works',
        addon: names.get(entry.addonId) ?? entry.addonId,
        short: text.playable ? releaseShort(text.title) : undefined,
      };
    });
  }, [entries, reference, probes, seconds, t]);
  const rows = useMemo(
    () =>
      described.map(({ entry, key, text, facts, cached, tested, addon, short }): SheetRow => {
        const here = key === playingKey;
        const headline = facts.length > 0 ? facts.join(' · ') : (short ?? text.title);
        return {
          focusKey: `${SHEET}-row-${key}`,
          label: text.title,
          spoken: [
            addon,
            text.title,
            text.badges.join(', '),
            here ? t('player.playingNow') : undefined,
            tested ? t('streams.tested') : undefined,
            ...text.notes,
          ]
            .filter(Boolean)
            .join('. '),
          selected: here,
          dim: !text.playable,
          body: (
            <>
              <span className={styles.top}>
                {headline}
                {cached && <span className={rowParts.chip}>{t('streams.cached')}</span>}
                {tested && (
                  <span className={`${rowParts.chip} ${rowParts.good}`}>{t('streams.tested')}</span>
                )}
              </span>
              <span className={rowParts.line}>
                {[addon, facts.length > 0 ? (short ?? text.title) : undefined]
                  .filter(Boolean)
                  .join(' · ')}
                {text.note && (
                  <span className={text.playable ? rowParts.warn : undefined}>
                    {` · ${text.note}`}
                  </span>
                )}
              </span>
            </>
          ),
          onFocus: () => setFocused(key),
          onPress: () => pick.current(entry),
        };
      }),
    [described, playingKey, t],
  );
  const playingRow = rows.find((row) => row.selected)?.focusKey;
  const boxed =
    described.find((item) => item.key === focused) ??
    described.find((item) => item.key === playingKey) ??
    described[0];
  const first = playingRow ?? rows[0]?.focusKey;
  const filterLabel = filterButtonLabel(t, filter, addonNames());

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.sources')}
      defaultFocusKey={first ?? `${SHEET}-all`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      // One level: Back from a row or the header closes onto the controls.
      onBack={() => {
        onBack();
        return true;
      }}
      placement="bottom"
    >
      <div className={styles.view}>
        <div className={styles.header}>
          <h2 className={styles.heading}>
            {t('player.sources')}
            <span className={styles.status} role="status">
              {filteredStatus(t, state, shown, ordered.length)}
            </span>
          </h2>
          {/* Up from the rows lands on All streams, the way out of the sheet's few. */}
          <Pane focusKey={`${SHEET}-buttons`} preferred={`${SHEET}-all`} className={styles.buttons}>
            <Pressable
              focusKey={`${SHEET}-filter`}
              label={filterLabel}
              className={`${styles.button} ${styles.filter}`}
              focusedClassName={styles.buttonFocused}
              onPress={() => setFiltering(true)}
            >
              {filterLabel}
            </Pressable>
            <Pressable
              focusKey={`${SHEET}-sort`}
              label={t('streams.sortBy', { order: t(`streams.order.${order}`) })}
              className={styles.button}
              focusedClassName={styles.buttonFocused}
              onPress={() =>
                setPreference(
                  'allStreamsOrder',
                  ORDERS[(ORDERS.indexOf(order) + 1) % ORDERS.length]!,
                )
              }
            >
              {t('streams.sortBy', { order: t(`streams.order.${order}`) })}
            </Pressable>
            <Pressable
              focusKey={`${SHEET}-all`}
              label={t('player.allStreams')}
              className={styles.button}
              focusedClassName={styles.buttonFocused}
              onPress={onAllStreams}
            >
              {t('player.allStreams')}
            </Pressable>
          </Pane>
        </div>
        {rows.length === 0 && state.settled && <p className={styles.empty}>{t('streams.none')}</p>}
        {/* Another order or filter starts afresh: its rows register anew. */}
        <SheetList
          key={`${order}|${filterKey(filter)}`}
          focusKey={`${SHEET}-list`}
          rows={rows}
          preferred={first}
          remember
          visible={VISIBLE}
          rowHeight={ROW_HEIGHT}
          className={styles.list}
        />
        {boxed && (
          <SheetDetail
            className={styles.box}
            title={
              boxed.key === playingKey ? `${boxed.addon} · ${t('player.playingNow')}` : boxed.addon
            }
            chips={boxed.cached ? [...boxed.facts, t('streams.cached')] : boxed.facts}
            good={boxed.tested ? t('streams.tested') : undefined}
            text={boxed.text.notes.join(' · ')}
            label={t('player.infoRow.release')}
            name={boxed.text.title}
          />
        )}
      </div>
      {/* Over the sheet: Back goes up its levels, then back to the Filter button. */}
      {filtering && (
        <StreamFilterMenu
          focusKey={`${SHEET}-filter-menu`}
          entries={ordered}
          filter={filter}
          names={addonNames()}
          returnFocusKey={`${SHEET}-filter`}
          onClose={() => setFiltering(false)}
        />
      )}
    </Overlay>
  );
}
