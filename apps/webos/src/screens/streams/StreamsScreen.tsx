import { otherLanguages, parseRuntime, type StreamEntry, type StreamOrder } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { type EventPlay, type PlayerRoute, replace, topRoute } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { Menu } from '../../components/Menu';
import { Pressable } from '../../components/Pressable';
import { addonClient, addonNames } from '../../data/addons';
import { preferences, setPreference } from '../../data/preferences';
import { useQuery } from '../../data/use-query';
import { useBack } from '../../navigation/use-back';
import { canSlide } from '../../platform/input-mode';
import { playTrailer } from '../../platform/youtube';
import { streamRowText, streamsStatus } from '../../player/describe';
import { entryKey, isHeavy, listOrder, streamFinder } from '../../player/finder';
import { leaveSleepTimer } from '../../player/sleep';
import styles from './StreamsScreen.module.css';

const ITEM_HEIGHT = 168;
const VISIBLE = 5;
const OVERSCAN = 2;
const ORDERS: readonly StreamOrder[] = ['quality', 'fast', 'addon'];

interface StreamsScreenProps {
  type: string;
  metaId: string;
  videoId: string;
  preview?: MetaPreview;
  /** Seconds, when the player sent the viewer here: the chosen stream starts at the same moment. */
  startAt?: number;
  /** A sports event: the streams of its own sources only. */
  event?: EventPlay;
  /** Sent from the player's Sources: Back goes back to the film, where it was. */
  backTo?: PlayerRoute;
}

/**
 * Every stream the addons offered for one video, for choosing by hand when
 * auto-play's pick is not the one wanted. Streams this TV cannot play stay
 * in the list, last and dimmed, with the reason.
 */
export function StreamsScreen(props: StreamsScreenProps) {
  const { type, metaId, videoId, preview, startAt, event, backTo } = props;
  const { t } = useTranslation();
  const finder = useMemo(() => streamFinder(type, videoId, event), [type, videoId, event]);
  const state = useSyncExternalStore(finder.subscribe, finder.get);
  const order = useSyncExternalStore(
    preferences.subscribe,
    () => preferences.get().allStreamsOrder,
  );
  // A sports event's page comes from the addon that listed it, never another one.
  const metaQuery = useMemo(
    () => (type === 'movie' || event ? null : addonClient.meta(type, metaId)),
    [type, metaId, event],
  );
  const meta = useQuery(metaQuery).data;
  const item = meta ?? preview;
  const episode = meta?.videos.find((v) => v.id === videoId);
  const [sorting, setSorting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);

  useEffect(() => finder.start(), [finder]);
  // A sleep timer the player left for here goes on only into this title's player.
  useEffect(() => () => leaveSleepTimer(metaId, topRoute()), [metaId]);
  useBack(
    'screen',
    () => {
      if (backTo) replace(backTo);
      return true;
    },
    backTo !== undefined,
  );
  const runtime = item?.runtime;
  useEffect(() => finder.setRuntime(parseRuntime(runtime)), [finder, runtime]);
  // Re-sorted when the order changes or more addons answer. The finder answers
  // again when the running time or the connection's limit changes.
  const entries = useMemo(
    () => listOrder(state.entries, order, finder.orderOptions()),
    [state.entries, order, finder],
  );
  const names = addonNames();

  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'streams-list',
    saveLastFocusedChild: true,
    preferredChildFocusKey: 'streams-item-0',
  });
  useScreenFocus(
    entries.length > 0 ? 'streams-item-0' : 'streams-sort',
    entries.length > 0 || state.settled,
  );

  const open = (entry: StreamEntry) => {
    const action = entry.assessment.action;
    setNote(null);
    if (action.kind === 'play') {
      replace({
        name: 'player',
        type,
        metaId,
        videoId,
        preview,
        stream: entry,
        chosen: true,
        startAt,
        event,
      });
    } else if (action.kind === 'youtube' && entry.stream.source.kind === 'youtube') {
      playTrailer(entry.stream.source.ytId).catch(() => setNote(t('details.trailerFailed')));
    } else {
      setNote(t(`streams.cannot.${action.kind === 'unavailable' ? action.reason : 'external'}`));
    }
  };

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(entries.length, anchor + VISIBLE + OVERSCAN);
  const rows = [];
  for (let index = first; index < last; index++) {
    const entry = entries[index]!;
    const { title, badges, playable, note, notes } = streamRowText(t, entry, {
      heavy: isHeavy(entry, finder.runtimeSeconds()),
      languages: otherLanguages(entry.facts),
    });
    const probe = state.probes[entryKey(entry)];
    const name = names.get(entry.addonId) ?? entry.addonId;
    rows.push(
      <Pressable
        key={entryKey(entry)}
        focusKey={`streams-item-${index}`}
        label={[name, title, badges.join(', '), ...notes].filter(Boolean).join('. ')}
        className={playable ? styles.stream : `${styles.stream} ${styles.unplayable}`}
        focusedClassName={styles.focused}
        style={{ top: index * ITEM_HEIGHT }}
        onPress={() => open(entry)}
        onFocus={() => {
          const target = Math.max(0, index - 1);
          if (canSlide() && target !== anchor) setAnchor(target);
        }}
      >
        <div className={styles.addon}>{name}</div>
        <div className={styles.text}>
          <p className={styles.title}>{title}</p>
          <p className={styles.badges}>
            {badges.map((badge) => (
              <span key={badge} className={styles.badge}>
                {badge}
              </span>
            ))}
            {probe === 'works' && <span className={styles.works}>{t('streams.tested')}</span>}
          </p>
          {note && <p className={playable ? styles.warning : styles.reason}>{note}</p>}
        </div>
      </Pressable>,
    );
  }

  const status = streamsStatus(t, state, entries.length);

  return (
    <section className={styles.screen} aria-label={t('streams.title')}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.name}>{item?.name ?? t('streams.title')}</h1>
          {episode && (
            <p className={styles.episode}>
              {[
                episode.season !== undefined && episode.episode !== undefined
                  ? t('player.episodeNumber', { season: episode.season, episode: episode.episode })
                  : undefined,
                episode.title,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <p className={styles.status} role="status">
            {status}
          </p>
        </div>
        <Button
          focusKey="streams-sort"
          label={t('streams.sortBy', { order: t(`streams.order.${order}`) })}
          onPress={() => setSorting(true)}
        />
      </div>
      {note && <p className={styles.note}>{note}</p>}
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className={styles.list}>
          {entries.length === 0 && state.settled && (
            <p className={styles.empty}>{t('streams.none')}</p>
          )}
          <div
            className={styles.track}
            style={{ transform: `translateY(${-anchor * ITEM_HEIGHT}px)` }}
          >
            {rows}
          </div>
        </div>
      </FocusContext.Provider>
      {sorting && (
        <Menu
          focusKey="streams-order"
          title={t('streams.sortTitle')}
          options={ORDERS.map((value) => ({ value, label: t(`streams.order.${value}`) }))}
          selected={order}
          returnFocusKey="streams-sort"
          onSelect={(value) => {
            setSorting(false);
            setAnchor(0);
            setPreference('allStreamsOrder', value as StreamOrder);
          }}
          onClose={() => setSorting(false)}
        />
      )}
    </section>
  );
}
