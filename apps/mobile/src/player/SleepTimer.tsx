import { SLEEP_CHOICES, type SleepChoice, type SleepTimer } from '@bannertv/core';
import { formatClock } from '@tv/player/media';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { colors, radius, space, type } from '../ui/theme';
import { PanelOption } from './SidePanel';
import { sleepMinutesLeft } from './time-left';
import { useNow } from './use-now';

type Translate = ReturnType<typeof useTranslation>['t'];

/** How often More's row reads the minutes left again while it shows. */
const ROW_TICK_MS = 15 * 1000;

function choiceName(t: Translate, choice: SleepChoice, episode: boolean): string {
  if (choice === 'off') return t('player.sleep.off');
  if (choice === 'end') return t(episode ? 'player.sleep.endOfEpisode' : 'player.sleep.endOfFilm');
  return t('player.sleep.minutes', { count: choice });
}

/** "Off", "End of episode", "28 min left": what More's row says the timer is set to. */
function sleepLeftValue(t: Translate, timer: SleepTimer, episode: boolean, now: number): string {
  const minutes = sleepMinutesLeft(timer, now);
  return minutes === null
    ? choiceName(t, timer.choice, episode)
    : t('phone.sleepLeft', { count: minutes });
}

/** More's Sleep timer row: what it is set to, with the minutes left while minutes run. */
export function SleepRow({
  timer,
  episode,
  onPress,
}: {
  timer: SleepTimer;
  /** An episode plays, rather than a film: "End of episode". */
  episode: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const now = useNow(ROW_TICK_MS);
  const label = t('player.sleep.title');
  const value = sleepLeftValue(t, timer, episode, now);
  return (
    <PanelOption
      label={label}
      detail={value}
      accessibilityLabel={`${label}, ${value}`}
      wrap
      onPress={onPress}
    />
  );
}

/**
 * The sleep timer's choices, as the TV's: off, minutes, or the end of what plays (not on a
 * broadcast, whose end is not known), with what the one set does. Picking minutes again starts
 * them again.
 */
export function SleepPanel({
  timer,
  episode,
  live,
  onChoose,
}: {
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
    <ScrollView>
      <Text style={styles.note} accessibilityLiveRegion="polite">
        {note}
      </Text>
      {choices.map((choice) => (
        <PanelOption
          key={choice}
          label={choiceName(t, choice, episode)}
          selected={choice === timer.choice}
          wrap
          onPress={() => onChoose(choice)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * The last minute before the sleep timer pauses, in the corner as Up Next is, and only over the
 * picture alone. A minutes timer offers 15 minutes more; any timer can be turned off.
 */
export function SleepWarning({
  timer,
  episode,
  right,
  onAdd,
  onOff,
}: {
  timer: SleepTimer;
  episode: boolean;
  /** Its distance from the screen's right edge, clear of the camera cut-out. */
  right: number;
  onAdd: () => void;
  onOff: () => void;
}) {
  const { t } = useTranslation();
  const minutes = timer.choice !== 'end';
  const title = minutes
    ? t('player.sleep.pausingAt', { time: formatClock(timer.endsAt ?? 0) })
    : t(episode ? 'player.sleep.pausingEndOfEpisode' : 'player.sleep.pausingEndOfFilm');
  return (
    <View style={[styles.warning, { right }]} accessibilityLiveRegion="polite">
      <Text style={styles.kicker}>{t('player.sleep.title')}</Text>
      <Text style={styles.warningTitle}>{title}</Text>
      <View style={styles.buttons}>
        {minutes ? <Button kind="primary" label={t('player.sleep.add')} onPress={onAdd} /> : null}
        <Button
          kind={minutes ? 'secondary' : 'primary'}
          label={t('player.sleep.turnOff')}
          onPress={onOff}
        />
      </View>
    </View>
  );
}

/**
 * Paused by the sleep timer: the screen goes dark over the paused picture, as on the TV, and the
 * phone may lock as it does over any paused film. Carry on watching plays on from there; Back
 * leaves it paused.
 */
export function SleepScreen({
  visible,
  onWake,
}: {
  visible: boolean;
  onWake: (carryOn: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onWake(false)}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['landscape', 'portrait']}
    >
      <View style={styles.asleep} accessibilityViewIsModal>
        <Text style={styles.asleepTitle} accessibilityRole="header">
          {t('player.sleep.paused')}
        </Text>
        <Button kind="primary" label={t('player.sleep.wake')} onPress={() => onWake(true)} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  note: { ...type.small, color: colors.textMuted, paddingHorizontal: space.m, paddingBottom: 6 },
  // As the player's Up Next card.
  warning: {
    position: 'absolute',
    bottom: space.xl,
    width: 320,
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.xs,
  },
  kicker: { ...type.small, color: colors.accent },
  warningTitle: { ...type.label, color: colors.text },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  asleep: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    padding: space.xl,
  },
  asleepTitle: { ...type.heading, color: colors.textMuted, textAlign: 'center' },
});
