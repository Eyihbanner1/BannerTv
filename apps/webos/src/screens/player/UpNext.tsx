import type { Video } from '@bannertv/protocol';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { useBack } from '../../navigation/use-back';
import { cardArrows } from './card-arrows';
import styles from './PlayerScreen.module.css';

interface UpNextProps {
  video: Video;
  /** Its season and number, as the controls name episodes: "S2:E5". */
  number?: string;
  /** The count the player keeps: seconds to the end, or after it. */
  seconds: number;
  onPlay: () => void;
  onDismiss: () => void;
  /** Up or Down: the controls come up in its place, with the count on Next episode. */
  onControls: () => void;
}

/**
 * "Next episode in 12 s", in the corner over the credits, counting to the
 * end of the episode, with the episode's number and name. OK plays it now,
 * Back keeps watching, Up or Down brings the controls. The player shows it
 * only while nothing else is on screen (the controls, a sheet, a skip), so it
 * takes focus from the picture alone; the player says where focus goes after.
 * The pointer over it moves focus to the button under it, and a click on
 * the picture beside it brings the controls.
 */
export function UpNext({ video, number, seconds, onPlay, onDismiss, onControls }: UpNextProps) {
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
  const onArrowPress = cardArrows(onControls);

  const name =
    video.title ||
    (video.episode !== undefined ? t('details.untitledEpisode', { number: video.episode }) : '');
  const count = t('player.nextEpisodeIn', { seconds });
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.upNext} role="dialog" aria-label={t('player.upNext')}>
        {video.thumbnail && <Artwork src={video.thumbnail} className={styles.upNextThumb} />}
        <div className={styles.upNextText}>
          <p className={styles.upNextLabel}>{count}</p>
          {number && <p className={styles.upNextNumber}>{number}</p>}
          <p className={styles.upNextTitle}>{name}</p>
        </div>
        <div className={styles.upNextButtons}>
          {/* Audio Guidance reads the count with it, as the card shows it above. */}
          <Button
            focusKey="player-upnext-play"
            variant="primary"
            label={t('player.playNowCounting', { count })}
            onPress={onPlay}
            onArrowPress={onArrowPress}
          >
            {t('player.playNow')}
          </Button>
          <Button
            focusKey="player-upnext-dismiss"
            label={t('player.keepWatching')}
            onPress={onDismiss}
            onArrowPress={onArrowPress}
          />
        </div>
      </div>
    </FocusContext.Provider>
  );
}
