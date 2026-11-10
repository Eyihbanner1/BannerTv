import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, space, type } from '../ui/theme';
import { PanelOption } from './SidePanel';
import { chosenSpeed, PHONE_SPEEDS } from './speed-choices';

type Translate = ReturnType<typeof useTranslation>['t'];

/** "Normal", "1.25×", as the TV's Speed tab names them. */
function speedName(t: Translate, rate: number): string {
  return rate === 1 ? t('player.speed.normal') : t('player.speed.rate', { rate });
}

/** More's Speed row, with the speed playing. */
export function SpeedRow({
  rate,
  disabled,
  onPress,
}: {
  rate: number;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const label = t('player.speed.title');
  const value = speedName(t, chosenSpeed(rate));
  return (
    <PanelOption
      label={label}
      detail={value}
      accessibilityLabel={`${label}, ${value}`}
      disabled={disabled}
      wrap
      onPress={onPress}
    />
  );
}

/** The speeds (speed-choices.ts), the one playing ticked, and that the next stream is at Normal. */
export function SpeedPanel({ rate, onChoose }: { rate: number; onChoose: (rate: number) => void }) {
  const { t } = useTranslation();
  const chosen = chosenSpeed(rate);
  return (
    <ScrollView>
      <Text style={styles.note}>{t('phone.speedNote')}</Text>
      {PHONE_SPEEDS.map((choice) => (
        <PanelOption
          key={choice}
          label={speedName(t, choice)}
          selected={choice === chosen}
          wrap
          onPress={() => onChoose(choice)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: { ...type.small, color: colors.textMuted, paddingHorizontal: space.m, paddingBottom: 6 },
});
