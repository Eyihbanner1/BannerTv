import {
  keepOrder,
  otherLanguages,
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
import { streamRowText, streamsStatus } from '../../player/describe';
import { entryKey, isHeavy, listOrder, type StreamFinder } from '../../player/finder';
import { type SheetRow, SheetList } from './SheetList';
import styles from './SourcesSheet.module.css';

const SHEET = 'player-sources';
const ORDERS: readonly StreamOrder[] = ['quality', 'fast', 'addon'];
/** Two lines a row: the release, then its facts and the one note. */
const ROW_HEIGHT = 116;
const VISIBLE = 3;

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
 * same list and order as All streams, with the stream playing ticked. It asks
 * the addons nothing and tests nothing: the decoder is the film's.
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
  const [stable] = useState(rememberPlaces);
  const entries = useMemo(
    () => stable(order, listOrder(state.entries, order, finder.orderOptions())),
    [stable, state.entries, order, finder],
  );
  const playingKey = playing ? entryKey(playing) : undefined;
  const seconds = finder.runtimeSeconds();
  // The player draws a few times a second as the film plays: the rows are
  // built again only when the streams, what plays, or their tests change.
  const pick = useRef(onPick);
  useLayoutEffect(() => {
    pick.current = onPick;
  });
  const { probes } = state;
  const rows = useMemo(() => {
    const names = addonNames();
    return entries.map((entry): SheetRow => {
      const key = entryKey(entry);
      const here = key === playingKey;
      const text = streamRowText(t, entry, {
        heavy: isHeavy(entry, seconds),
        languages: otherLanguages(entry.facts, reference),
      });
      const name = names.get(entry.addonId) ?? entry.addonId;
      const tested = probes[key] === 'works';
      return {
        focusKey: `${SHEET}-row-${key}`,
        label: text.title,
        spoken: [
          name,
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
            <span className={styles.addon}>{name}</span>
            <span className={styles.text}>
              <span className={styles.title}>{text.title}</span>
              <span className={styles.facts}>
                {text.badges.map((badge) => (
                  <span key={badge} className={styles.badge}>
                    {badge}
                  </span>
                ))}
                {tested && <span className={styles.works}>{t('streams.tested')}</span>}
                {text.note && (
                  <span className={text.playable ? styles.warning : styles.reason}>
                    {text.note}
                  </span>
                )}
              </span>
            </span>
          </>
        ),
        onPress: () => pick.current(entry),
      };
    });
  }, [entries, playingKey, reference, probes, seconds, t]);
  const playingRow = rows.find((row) => row.selected)?.focusKey;
  const first = playingRow ?? rows[0]?.focusKey;

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
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.kicker}>{t('player.sources')}</span>
          <span className={styles.status} role="status">
            {streamsStatus(t, state, entries.length)}
          </span>
        </div>
        <div className={styles.buttons}>
          <Pressable
            focusKey={`${SHEET}-sort`}
            label={t('streams.sortBy', { order: t(`streams.order.${order}`) })}
            className={styles.button}
            focusedClassName={styles.buttonFocused}
            onPress={() =>
              setPreference('allStreamsOrder', ORDERS[(ORDERS.indexOf(order) + 1) % ORDERS.length]!)
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
        </div>
      </div>
      {rows.length === 0 && state.settled && <p className={styles.empty}>{t('streams.none')}</p>}
      {/* Another order starts afresh: its rows register anew. */}
      <SheetList
        key={order}
        focusKey={`${SHEET}-list`}
        rows={rows}
        preferred={first}
        remember
        visible={VISIBLE}
        rowHeight={ROW_HEIGHT}
      />
    </Overlay>
  );
}
