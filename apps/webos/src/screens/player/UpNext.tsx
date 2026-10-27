import type { Video } from '@bannertv/protocol';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { useBack } from '../../navigation/use-back';
import styles from './PlayerScreen.module.css';

/** Seconds the card counts down before the next episode starts by itself. */
export const UP_NEXT_COUNTDOWN_S = 10;

interface UpNextProps {
  video: Video;
  /** Where focus goes when the card is dismissed. */
  returnFocusKey: string;
  onPlay: () => void;
  onDismiss: () => void;
}

/** "Next episode in 10", in the corner over the credits. OK plays it now, Back stays. */
export function UpNext({ video, returnFocusKey, onPlay, onDismiss }: UpNextProps) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(UP_NEXT_COUNTDOWN_S);
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-upnext',
    isFocusBoundary: true,
    preferredChildFocusKey: 'player-upnext-play',
  });
  const play = useRef(onPlay);
  useEffect(() => {
    play.current = onPlay;
  });

  useEffect(() => {
    void setFocus('player-upnext-play');
    const timer = window.setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => {
      window.clearInterval(timer);
      void setFocus(returnFocusKey);
    };
    // The countdown starts once, when the card appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (left === 0) play.current();
  }, [left]);

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
            label={t('player.playNextIn', { seconds: left })}
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
