import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Focusable } from './Focusable';
import { Icon, type IconName } from './icons';
import { color, px, radii, spacing, type } from './theme';

/**
 * A TV button. Focused, every button turns the same way: a light fill with dark words inside the
 * focus ring, so the one the remote is on is never in doubt. Unfocused, the main action is
 * violet and the others are quiet.
 */
export function Button({
  label,
  onPress,
  kind = 'secondary',
  icon,
  preferred,
  disabled,
  width,
  style,
  onFocus,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary';
  icon?: IconName;
  preferred?: boolean;
  disabled?: boolean;
  width?: number;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
}) {
  return (
    <Focusable
      onPress={onPress}
      {...(onFocus ? { onFocus } : {})}
      radius={radii.pill}
      {...(preferred ? { preferred } : {})}
      {...(disabled ? { disabled } : {})}
      accessibilityLabel={label}
      style={[width ? { width } : null, style]}
    >
      {(focused) => (
        <View
          style={[
            styles.button,
            kind === 'primary' ? styles.primary : styles.secondary,
            focused && styles.focused,
            disabled && styles.disabled,
          ]}
        >
          {icon ? (
            <Icon name={icon} size={px(36)} tint={focused ? color.onFocus : color.text} />
          ) : null}
          <Text style={[styles.label, focused && styles.focusedLabel]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: px(76),
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primary: { backgroundColor: color.brand },
  secondary: { backgroundColor: color.raised },
  focused: { backgroundColor: color.focusFill },
  disabled: { opacity: 0.5 },
  label: { ...type.label, color: color.text },
  focusedLabel: { color: color.onFocus },
});
