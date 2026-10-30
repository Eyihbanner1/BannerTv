import type { Video } from '@bannertv/protocol';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { useBack } from '../../navigation/use-back';
import styles from './PlayerScreen.module.css';

interface UpNextProps {
  video: Video;
  /** The count the player keeps: seconds to the end, or after it. */
  seconds: number;
  onPlay: () => void;
  onDismiss: () => void;
}

/**
 * "Up next", in the corner over the credits, counting to the end of the
 * episode. OK plays it now, Back keeps watching. The player shows it only
 * while nothing else is on screen (the controls, a sheet, a skip), so it
 * takes focus from the picture alone; the player says where focus goes after.
 */
export function UpNext({ video, seconds, onPlay, onDismiss }: UpNextProps) {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-upnext',
    isFocusBoundary: true,
    preferredChildFocusKey: 'player-upnext-play',
  });
  useEffect(() => void setFocus('player-upnext-play'), []);

  useBack('overlay', () => {
    onDismiss();
    return true;
  });

  const number = video.episode;
  const name =
    video.title || (number !== undefined ? t('details.untitledEpisode', { number }) : '');
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.upNext} role="dialog" aria-label={t('player.upNext')}>
        {video.thumbnail && <Artwork src={video.thumbnail} className={styles.upNextThumb} />}
        <div className={styles.upNextText}>
          <p className={styles.upNextLabel}>{t('player.upNext')}</p>
          <p className={styles.upNextTitle}>{name}</p>
        </div>
        <div className={styles.upNextButtons}>
          <Button
            focusKey="player-upnext-play"
            variant="primary"
            label={t('player.playNextIn', { seconds })}
            onPress={onPlay}
          />
          <Button
            focusKey="player-upnext-dismiss"
            label={t('player.keepWatching')}
            onPress={onDismiss}
          />
        </div>
      </div>
    </FocusContext.Provider>
  );
}
