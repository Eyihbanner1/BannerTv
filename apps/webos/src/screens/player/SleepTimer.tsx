import { SLEEP_CHOICES, type SleepChoice, type SleepTimer } from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Pressable } from '../../components/Pressable';
import { useBack } from '../../navigation/use-back';
import { formatClock } from '../../player/media';
import { Pane } from './SheetTabs';
import styles from './SleepTimer.module.css';
import playerStyles from './PlayerScreen.module.css';

type Translate = ReturnType<typeof useTranslation>['t'];

/** "Off", "Until 23:40", "End of episode": what the timer is set to. */
export function sleepValue(t: Translate, timer: SleepTimer, episode: boolean): string {
  if (timer.choice === 'off') return t('player.sleep.off');
  if (timer.choice === 'end')
    return t(episode ? 'player.sleep.endOfEpisode' : 'player.sleep.endOfFilm');
  return t('player.sleep.until', { time: formatClock(timer.endsAt ?? 0) });
}

function choiceName(t: Translate, choice: SleepChoice, episode: boolean): string {
  if (choice === 'off') return t('player.sleep.off');
  if (choice === 'end') return t(episode ? 'player.sleep.endOfEpisode' : 'player.sleep.endOfFilm');
  return t('player.sleep.minutes', { count: choice });
}

/**
 * The sleep timer's choices, in the Info sheet: off, minutes, or the end of
 * what is playing (not on live, whose end is not known). Picking minutes
 * again starts them again.
 */
export function SleepChoices({
  focusKey,
  timer,
  episode,
  live,
  onChoose,
}: {
  focusKey: string;
  timer: SleepTimer;
  episode: boolean;
  live: boolean;
  onChoose: (choice: SleepChoice) => void;
}) {
  const { t } = useTranslation();
  const choices = SLEEP_CHOICES.filter((choice) => !live || choice !== 'end');
  const note =
    timer.choice === 'off'
      ? t('player.sleep.offNote')
      : timer.choice === 'end'
        ? t(episode ? 'player.sleep.endOfEpisodeNote' : 'player.sleep.endOfFilmNote')
        : t('player.sleep.untilNote', { time: formatClock(timer.endsAt ?? 0) });
  return (
    <Pane focusKey={focusKey} preferred={`${focusKey}-${timer.choice}`} className={styles.content}>
      <div className={styles.steps}>
        {choices.map((choice) => {
          const name = choiceName(t, choice, episode);
          const chosen = choice === timer.choice;
          return (
            <Pressable
              key={choice}
              focusKey={`${focusKey}-${choice}`}
              label={chosen ? `${name}. ${t('player.sleep.chosen')}` : name}
              className={chosen ? `${styles.step} ${styles.chosen}` : styles.step}
              focusedClassName={styles.stepFocused}
              onPress={() => onChoose(choice)}
            >
              {name}
            </Pressable>
          );
        })}
      </div>
      <p className={styles.note} role="status">
        {note}
      </p>
    </Pane>
  );
}

/**
 * The last minute before the sleep timer pauses, in the corner as Up Next
 * is, and shown as it is: only over the picture alone. A minutes timer
 * offers 15 minutes more; any timer can be turned off. Back leaves it be.
 */
export function SleepWarning({
  timer,
  episode,
  onAdd,
  onOff,
  onDismiss,
}: {
  timer: SleepTimer;
  episode: boolean;
  onAdd: () => void;
  onOff: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const minutes = timer.choice !== 'end';
  const first = minutes ? 'player-sleepwarn-add' : 'player-sleepwarn-off';
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-sleepwarn',
    isFocusBoundary: true,
    preferredChildFocusKey: first,
  });
  useEffect(() => void setFocus(first), [first]);
  useBack('overlay', () => {
    onDismiss();
    return true;
  });
  const title = minutes
    ? t('player.sleep.pausingAt', { time: formatClock(timer.endsAt ?? 0) })
    : t(episode ? 'player.sleep.pausingEndOfEpisode' : 'player.sleep.pausingEndOfFilm');
  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className={playerStyles.upNext}
        role="dialog"
        aria-label={`${t('player.sleep.title')}. ${title}`}
      >
        <p className={playerStyles.upNextLabel}>{t('player.sleep.title')}</p>
        <p className={playerStyles.upNextTitle}>{title}</p>
        <div className={playerStyles.upNextButtons}>
          {minutes && (
            <Button
              focusKey="player-sleepwarn-add"
              variant="primary"
              label={t('player.sleep.add')}
              onPress={onAdd}
            />
          )}
          <Button
            focusKey="player-sleepwarn-off"
            variant={minutes ? 'secondary' : 'primary'}
            label={t('player.sleep.turnOff')}
            onPress={onOff}
          />
        </div>
      </div>
    </FocusContext.Provider>
  );
}

/**
 * Paused by the sleep timer: the screen goes dark over the paused picture,
 * and the TV's own screen saver can come over it. OK or Back wakes it.
 */
export function SleepScreen({ onWake }: { onWake: () => void }) {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-asleep',
    isFocusBoundary: true,
    preferredChildFocusKey: 'player-asleep-wake',
  });
  useEffect(() => void setFocus('player-asleep-wake'), []);
  useBack('overlay', () => {
    onWake();
    return true;
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.asleep} role="dialog" aria-label={t('player.sleep.paused')}>
        <p className={styles.asleepTitle}>{t('player.sleep.paused')}</p>
        <Button
          focusKey="player-asleep-wake"
          variant="primary"
          label={t('player.sleep.wake')}
          onPress={onWake}
        />
      </div>
    </FocusContext.Provider>
  );
}
