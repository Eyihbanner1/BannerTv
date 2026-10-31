import { type TmdbEpisode, tmdbImageUrl } from '@bannertv/core';
import type { Video } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useState, useSyncExternalStore } from 'react';
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

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(videos.length, anchor + VISIBLE + OVERSCAN);
  const items = [];
  for (let index = first; index < last; index++) {
    const video = videos[index]!;
    const itemKey = `${focusKey}-${index}`;
    const number = video.episode ?? index + 1;
    const extra = video.episode === undefined ? undefined : extras?.[video.episode];
    const name = video.title || extra?.name;
    const title = name
      ? t('details.episodeTitle', { number, title: name })
      : t('details.untitledEpisode', { number });
    const thumbnail = video.thumbnail ?? tmdbImageUrl(extra?.stillPath, 'w300');
    const overview = video.overview || extra?.overview;
    const state = episodeState(video, progress.get(video.id), watchedSet.has(video.id), now);
    const upcoming = state.kind === 'upcoming';
    const watched = state.kind === 'watched';
    const fraction = state.kind === 'started' ? state.fraction : 0;
    const date = video.released
      ? upcoming
        ? t('details.airs', { date: formatDate(video.released) })
        : formatDate(video.released)
      : '';
    items.push(
      <Pressable
        key={index}
        focusKey={itemKey}
        label={[title, date, watched ? t('details.watched') : ''].filter(Boolean).join(', ')}
        className={styles.episode}
        focusedClassName={styles.focused}
        style={{ top: index * ITEM_HEIGHT }}
        onPress={() => onPress(video)}
        onFocus={() => {
          onFocusVideo?.(video);
          rememberFocus(memoryKey, itemKey);
          const target = Math.max(0, index - 1);
          if (canSlide() && target !== anchor) {
            setAnchor(target);
            rememberScroll(memoryKey, target);
          }
        }}
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
      </Pressable>,
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
