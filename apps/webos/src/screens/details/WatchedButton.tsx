import type { MetaDetail, MetaPreview } from '@bannertv/protocol';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { watchedSet } from '../../data/library';
import { isWatched, markFilm, type TitleRoute } from '../../data/marks';
import { progress } from '../../data/playback';
import styles from './MyListButton.module.css';

const CIRCLE = 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16';
const TICK = 'M5 12.5l4.5 4.5L19 7';

/**
 * Marks a film (or a title played as one video) watched, or not watched:
 * here, on the profile's other screens through the account, and on Trakt
 * when signed in there.
 */
export function WatchedButton({
  route,
  item,
  meta,
  videoId,
  onFocus,
}: {
  route: TitleRoute;
  item: MetaPreview;
  meta: MetaDetail | undefined;
  videoId: string;
  onFocus?: () => void;
}) {
  const { t } = useTranslation();
  useSyncExternalStore(progress.subscribe, progress.version);
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  const watched = isWatched(videoId);
  return (
    <Button
      focusKey="details-watched"
      label={
        watched
          ? t('browsing.markTitleUnwatched', { name: item.name })
          : t('browsing.markTitleWatched', { name: item.name })
      }
      onFocus={onFocus}
      onPress={() => markFilm(route, item, meta, videoId, !isWatched(videoId))}
    >
      <svg className={styles.icon} width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={watched ? TICK : CIRCLE}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t('browsing.watched')}
    </Button>
  );
}
