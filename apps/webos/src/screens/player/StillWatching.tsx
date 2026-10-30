import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import styles from './PlayerScreen.module.css';

/**
 * "Still watching?", over the end of an episode, in place of the next one
 * starting by itself: the third in a row with nothing pressed, or after 90
 * minutes without a key. Back, as Stop, goes back to the series.
 */
export function StillWatching({
  title,
  onPlay,
  onStop,
}: {
  title: string;
  onPlay: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Overlay
      focusKey="player-still"
      label={t('player.stillWatching.title')}
      defaultFocusKey="player-still-play"
      returnFocusKey="player-surface"
      onClose={onStop}
      placement="center"
      closeOnOutsideClick={false}
    >
      <h2 className={styles.problemTitle}>{t('player.stillWatching.title')}</h2>
      <p className={styles.problemMessage}>{t('player.stillWatching.message', { title })}</p>
      <div className={styles.problemActions}>
        <Button
          focusKey="player-still-play"
          variant="primary"
          label={t('player.stillWatching.play')}
          onPress={onPlay}
        />
        <Button
          focusKey="player-still-stop"
          label={t('player.stillWatching.stop')}
          onPress={onStop}
        />
      </div>
    </Overlay>
  );
}
