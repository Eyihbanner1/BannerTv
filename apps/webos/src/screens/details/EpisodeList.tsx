import { type TmdbEpisode, tmdbImageUrl } from '@bannertv/core';
import type { Video } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { TFunction } from 'i18next';
import {
  type CSSProperties,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Artwork } from '../../components/Artwork';
import { Pressable } from '../../components/Pressable';
import { fallbackArt } from '../../components/Tile';
import { formatDate } from '../../data/describe';
import { watchedSet } from '../../data/library';
import { progress } from '../../data/playback';
import {
  recallFocus,
  recallScroll,
  rememberFocus,
  rememberScroll,
} from '../../navigation/focus-memory';
import { canSlide } from '../../platform/input-mode';
import { episodeState } from './seasons';
import styles from './EpisodeList.module.css';

const ITEM_HEIGHT = 168;
const VISIBLE = 5;
const OVERSCAN = 2;

interface EpisodeListProps {
  focusKey: string;
  /** Where the list keeps its scroll and last episode, e.g. per title and season. */
  memoryKey: string;
  videos: readonly Video[];
  /** The episode focus goes to, and the list starts at, when nothing is remembered. */
  startIndex?: number;
  /** An episode that has aired was pressed. One not out yet says when it is instead. */
  onPress: (video: Video) => void;
  /** OK held on an episode that has aired: what else can be done with it. */
  onLongPress?: (video: Video, index: number) => void;
  /** Focus moved to an episode, so its streams can be looked for. */
  onFocusVideo?: (video: Video) => void;
  /** TMDB's names, overviews and stills by episode number, for what the addon left out. */
  extras?: Readonly<Record<number, TmdbEpisode>>;
}

interface EpisodeItemProps {
  t: TFunction;
  /** The list's focus key: the episode's own is the list's, a dash and its index. */
  listKey: string;
  index: number;
  video: Video;
  extra: TmdbEpisode | undefined;
  upcoming: boolean;
  /** Not out yet, and OK was last pressed on it: it says when it is out. */
  telling: boolean;
  watched: boolean;
  /** How far through a started episode is, 0 to 1. */
  fraction: number;
  /** Stable handlers that take the episode's index, so a move redraws only what changed. */
  onItemFocus: (index: number) => void;
  onItemPress: (index: number) => void;
  /** Absent when the list has no hold: OK then presses at once. */
  onItemLongPress: ((index: number) => void) | undefined;
  /** OK on an episode not out yet: says when instead of opening the player. */
  onTell: (videoId: string) => void;
}

/** One episode in the list: its still, title, date and overview. */
const EpisodeItem = memo(function EpisodeItem({
  t,
  listKey,
  index,
  video,
  extra,
  upcoming,
  telling,
  watched,
  fraction,
  onItemFocus,
  onItemPress,
  onItemLongPress,
  onTell,
}: EpisodeItemProps) {
  const number = video.episode ?? index + 1;
  const name = video.title || extra?.name;
  const title = name
    ? t('details.episodeTitle', { number, title: name })
    : t('details.untitledEpisode', { number });
  const thumbnail = video.thumbnail ?? tmdbImageUrl(extra?.stillPath, 'w300');
  const overview = video.overview || extra?.overview;
  const date = video.released
    ? telling
      ? t('browsing.outOn', { date: formatDate(video.released) })
      : upcoming
        ? t('details.airs', { date: formatDate(video.released) })
        : formatDate(video.released)
    : '';
  const style = useMemo<CSSProperties>(() => ({ top: index * ITEM_HEIGHT }), [index]);
  return (
    <Pressable
      focusKey={`${listKey}-${index}`}
      label={[title, date, watched ? t('details.watched') : ''].filter(Boolean).join(', ')}
      className={upcoming ? `${styles.episode} ${styles.soon}` : styles.episode}
      focusedClassName={styles.focused}
      style={style}
      // Not out yet: no streams can exist, so it says when instead of opening the player.
      onPress={() => (upcoming ? onTell(video.id) : onItemPress(index))}
      onLongPress={onItemLongPress && !upcoming ? () => onItemLongPress(index) : undefined}
      onFocus={() => onItemFocus(index)}
    >
      <div className={styles.thumb} style={{ backgroundImage: fallbackArt(index, 120) }}>
        <Artwork key={thumbnail} src={thumbnail} className={styles.image} />
        {watched ? (
          <span className={styles.watched} aria-hidden="true" />
        ) : (
          fraction > 0 && (
            <span className={styles.progress}>
              <span className={styles.progressFill} style={{ width: `${fraction * 100}%` }} />
            </span>
          )
        )}
      </div>
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {date && (
          <p
            className={
              telling
                ? `${styles.upcoming} ${styles.told}`
                : upcoming
                  ? styles.upcoming
                  : styles.date
            }
            aria-live={telling ? 'polite' : undefined}
          >
            {date}
          </p>
        )}
        {overview && <p className={styles.overview}>{overview}</p>}
      </div>
    </Pressable>
  );
});

/**
 * A season's episodes, top to bottom. Like rows, the list slides so the
 * focused episode stays near the top, and only episodes near the view are
 * drawn: some anime seasons have hundreds.
 */
export function EpisodeList({
  focusKey,
  memoryKey,
  videos,
  startIndex = 0,
  onPress,
  onLongPress,
  onFocusVideo,
  extras,
}: EpisodeListProps) {
  const { t } = useTranslation();
  // Trakt's watched ticks arrive with a sync.
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  const lastIndex = Math.max(0, videos.length - 1);
  const start = Math.min(startIndex, lastIndex);
  const remembered = recallFocus(memoryKey);
  const [anchor, setAnchor] = useState(() =>
    // Nothing remembered: the episode to start at sits second from the top, as focus leaves it.
    Math.min(remembered ? recallScroll(memoryKey) : Math.max(0, start - 1), lastIndex),
  );
  const { ref } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: true,
    preferredChildFocusKey: remembered ?? `${focusKey}-${start}`,
  });
  const [now] = useState(Date.now);
  // The episode not out yet that OK was last pressed on: it says when it is out.
  const [told, setTold] = useState<string | null>(null);

  // Episodes get handlers that never change, so a move redraws the episodes
  // whose focus changed and the one that slid into view, not all nine.
  const latest = useRef({
    focusKey,
    memoryKey,
    videos,
    anchor,
    onPress,
    onLongPress,
    onFocusVideo,
  });
  useLayoutEffect(() => {
    latest.current = { focusKey, memoryKey, videos, anchor, onPress, onLongPress, onFocusVideo };
  });
  const onItemFocus = useCallback((index: number) => {
    const current = latest.current;
    const video = current.videos[index];
    if (video) current.onFocusVideo?.(video);
    rememberFocus(current.memoryKey, `${current.focusKey}-${index}`);
    const target = Math.max(0, index - 1);
    if (canSlide() && target !== current.anchor) {
      setAnchor(target);
      rememberScroll(current.memoryKey, target);
    }
  }, []);
  const onItemPress = useCallback((index: number) => {
    const { videos: list, onPress: press } = latest.current;
    const video = list[index];
    if (video) press(video);
  }, []);
  const onItemHold = useCallback((index: number) => {
    const { videos: list, onLongPress: hold } = latest.current;
    const video = list[index];
    if (video) hold?.(video, index);
  }, []);
  // Only whether the list has a hold reaches the episodes, not the caller's latest handler.
  const onItemLongPress = onLongPress ? onItemHold : undefined;

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(videos.length, anchor + VISIBLE + OVERSCAN);
  const items = [];
  for (let index = first; index < last; index++) {
    const video = videos[index]!;
    const state = episodeState(video, progress.get(video.id), watchedSet.has(video.id), now);
    const upcoming = state.kind === 'upcoming';
    items.push(
      <EpisodeItem
        key={index}
        t={t}
        listKey={focusKey}
        index={index}
        video={video}
        extra={video.episode === undefined ? undefined : extras?.[video.episode]}
        upcoming={upcoming}
        telling={upcoming && told === video.id}
        watched={state.kind === 'watched'}
        fraction={state.kind === 'started' ? state.fraction : 0}
        onItemFocus={onItemFocus}
        onItemPress={onItemPress}
        onItemLongPress={onItemLongPress}
        onTell={setTold}
      />,
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.list}>
        <div
          className={styles.track}
          style={{ transform: `translateY(${-anchor * ITEM_HEIGHT}px)` }}
        >
          {items}
        </div>
      </div>
    </FocusContext.Provider>
  );
}
