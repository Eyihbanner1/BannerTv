import { StyleSheet, View } from 'react-native';
import { Focusable } from './Focusable';
import { Icon, type IconName } from './icons';
import { color, controls } from './theme';

/** The player's round controls: quiet glass, and white when focused (Play/Pause is always white). */
export function RoundButton({
  icon,
  label,
  onPress,
  bright = false,
  preferred,
  onFocus,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  bright?: boolean;
  preferred?: boolean;
  onFocus?: () => void;
}) {
  const size = controls.button;
  return (
    <Focusable
      onPress={onPress}
      {...(onFocus ? { onFocus } : {})}
      radius={size / 2}
      {...(preferred ? { preferred } : {})}
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      {(focused) => (
        <View
          style={[
            styles.circle,
            { width: size, height: size, borderRadius: size / 2 },
            bright || focused ? styles.bright : styles.idle,
          ]}
        >
          <Icon
            name={icon}
            size={Math.round(size * 0.46)}
            tint={bright || focused ? color.onFocus : color.text}
          />
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  idle: { backgroundColor: color.controlIdle },
  bright: { backgroundColor: color.focusFill },
});
