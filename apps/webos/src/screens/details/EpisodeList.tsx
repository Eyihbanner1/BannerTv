import type { Video } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Artwork } from '../../components/Artwork';
import { Pressable } from '../../components/Pressable';
import { fallbackArt } from '../../components/Tile';
import { formatDate } from '../../data/describe';
import {
  recallFocus,
  recallScroll,
  rememberFocus,
  rememberScroll,
} from '../../navigation/focus-memory';
import { canSlide } from '../../platform/input-mode';
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
}

/**
 * A season's episodes, top to bottom. Like rows, the list slides so the
 * focused episode stays near the top, and only episodes near the view are
 * drawn: some anime seasons have hundreds.
 */
export function EpisodeList({ focusKey, memoryKey, videos, onPress }: EpisodeListProps) {
  const { t } = useTranslation();
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
    const title = video.title
      ? t('details.episodeTitle', { number, title: video.title })
      : t('details.untitledEpisode', { number });
    const upcoming = video.released !== undefined && Date.parse(video.released) > now;
    const date = video.released
      ? upcoming
        ? t('details.airs', { date: formatDate(video.released) })
        : formatDate(video.released)
      : '';
    items.push(
      <Pressable
        key={index}
        focusKey={itemKey}
        label={[title, date].filter(Boolean).join(', ')}
        className={styles.episode}
        focusedClassName={styles.focused}
        style={{ top: index * ITEM_HEIGHT }}
        onPress={() => onPress(video)}
        onFocus={() => {
          rememberFocus(memoryKey, itemKey);
          const target = Math.max(0, index - 1);
          if (canSlide() && target !== anchor) {
            setAnchor(target);
            rememberScroll(memoryKey, target);
          }
        }}
      >
        <div className={styles.thumb} style={{ backgroundImage: fallbackArt(index, 120) }}>
          <Artwork key={video.thumbnail} src={video.thumbnail} className={styles.image} />
        </div>
        <div className={styles.text}>
          <p className={styles.title}>{title}</p>
          {date && <p className={upcoming ? styles.upcoming : styles.date}>{date}</p>}
          {video.overview && <p className={styles.overview}>{video.overview}</p>}
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
