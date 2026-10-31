import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './icons';
import { colors, radius, space, type } from './theme';

type Kind = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  icon,
  disabled = false,
  busy = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const textColour = kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.base,
        kind === 'primary' && styles.primary,
        kind === 'secondary' && styles.secondary,
        kind === 'quiet' && styles.quiet,
        kind === 'danger' && styles.secondary,
        pressed && (kind === 'primary' ? styles.primaryPressed : styles.pressed),
        (disabled || busy) && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : icon ? (
        <Icon name={icon} size={20} color={textColour} />
      ) : null}
      <Text style={[styles.label, { color: textColour }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A full-width row in a settings-style list. */
export function ListRow({
  title,
  detail,
  onPress,
  icon,
  right,
  disabled = false,
}: {
  title: string;
  detail?: string;
  onPress?: () => void;
  icon?: IconName;
  right?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={22} color={colors.accent} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={22} color={colors.textSubtle} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: space.l,
    borderRadius: radius.m,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
  },
  primary: { backgroundColor: colors.action },
  primaryPressed: { backgroundColor: colors.actionPressed },
  secondary: { backgroundColor: colors.surface3 },
  quiet: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  label: { ...type.label, fontSize: 15 },
  row: {
    minHeight: 56,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    backgroundColor: colors.surface1,
  },
  rowPressed: { backgroundColor: colors.surface2 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: colors.text, fontWeight: '600' },
  rowDetail: { ...type.small, color: colors.textMuted },
});
