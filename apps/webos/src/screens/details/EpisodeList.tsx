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
  onPress: (video: Video) => void;
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
  watched: boolean;
  /** How far through a started episode is, 0 to 1. */
  fraction: number;
  /** Stable handlers that take the episode's index, so a move redraws only what changed. */
  onItemFocus: (index: number) => void;
  onItemPress: (index: number) => void;
}

/** One episode in the list: its still, title, date and overview. */
const EpisodeItem = memo(function EpisodeItem({
  t,
  listKey,
  index,
  video,
  extra,
  upcoming,
  watched,
  fraction,
  onItemFocus,
  onItemPress,
}: EpisodeItemProps) {
  const number = video.episode ?? index + 1;
  const name = video.title || extra?.name;
  const title = name
    ? t('details.episodeTitle', { number, title: name })
    : t('details.untitledEpisode', { number });
  const thumbnail = video.thumbnail ?? tmdbImageUrl(extra?.stillPath, 'w300');
  const overview = video.overview || extra?.overview;
  const date = video.released
    ? upcoming
      ? t('details.airs', { date: formatDate(video.released) })
      : formatDate(video.released)
    : '';
  const style = useMemo<CSSProperties>(() => ({ top: index * ITEM_HEIGHT }), [index]);
  return (
    <Pressable
      focusKey={`${listKey}-${index}`}
      label={[title, date, watched ? t('details.watched') : ''].filter(Boolean).join(', ')}
      className={styles.episode}
      focusedClassName={styles.focused}
      style={style}
      onPress={() => onItemPress(index)}
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
        {date && <p className={upcoming ? styles.upcoming : styles.date}>{date}</p>}
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
  onPress,
  onFocusVideo,
  extras,
}: EpisodeListProps) {
  const { t } = useTranslation();
  // Trakt's watched ticks arrive with a sync.
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  const [anchor, setAnchor] = useState(() =>
    Math.min(recallScroll(memoryKey), Math.max(0, videos.length - 1)),
  );
  const { ref } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: true,
    preferredChildFocusKey: recallFocus(memoryKey) ?? `${focusKey}-0`,
  });
  const [now] = useState(Date.now);

  // Episodes get handlers that never change, so a move redraws the episodes
  // whose focus changed and the one that slid into view, not all nine.
  const latest = useRef({ focusKey, memoryKey, videos, anchor, onPress, onFocusVideo });
  useLayoutEffect(() => {
    latest.current = { focusKey, memoryKey, videos, anchor, onPress, onFocusVideo };
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

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(videos.length, anchor + VISIBLE + OVERSCAN);
  const items = [];
  for (let index = first; index < last; index++) {
    const video = videos[index]!;
    const state = episodeState(video, progress.get(video.id), watchedSet.has(video.id), now);
    items.push(
      <EpisodeItem
        key={index}
        t={t}
        listKey={focusKey}
        index={index}
        video={video}
        extra={video.episode === undefined ? undefined : extras?.[video.episode]}
        upcoming={state.kind === 'upcoming'}
        watched={state.kind === 'watched'}
        fraction={state.kind === 'started' ? state.fraction : 0}
        onItemFocus={onItemFocus}
        onItemPress={onItemPress}
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
