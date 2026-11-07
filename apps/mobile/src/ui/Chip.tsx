import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, space, touch, type } from './theme';

/** A filter pill: light when chosen, as the design's All / Films / Series. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      // 40 high on screen, 48 to the finger.
      hitSlop={(touch.min - touch.chip) / 2}
      style={({ pressed }) => [styles.chip, on && styles.on, pressed && !on && styles.pressed]}
    >
      <Text style={[styles.text, on && styles.textOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.chip,
    justifyContent: 'center',
    paddingHorizontal: space.l,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  on: { backgroundColor: colors.playFill },
  pressed: { backgroundColor: colors.raised },
  text: { ...type.meta, fontWeight: '700', color: colors.textSoft },
  textOn: { color: colors.onPlay, fontWeight: '800' },
});
