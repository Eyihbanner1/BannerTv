import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './icons';
import { colors, space, touch, type } from './theme';

/** `play` is the light fill the design keeps for Play and Resume; `primary` is the brand violet. */
type Kind = 'play' | 'primary' | 'secondary' | 'quiet' | 'danger';

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
  const textColour =
    kind === 'danger' ? colors.danger : kind === 'play' ? colors.onPlay : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.base,
        kind === 'play' && styles.play,
        kind === 'primary' && styles.primary,
        kind === 'secondary' && styles.secondary,
        kind === 'quiet' && styles.quiet,
        kind === 'danger' && styles.secondary,
        pressed &&
          (kind === 'primary'
            ? styles.primaryPressed
            : kind === 'play'
              ? styles.playPressed
              : styles.pressed),
        (disabled || busy) && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColour} size="small" />
      ) : icon ? (
        <Icon name={icon} size={20} color={textColour} />
      ) : null}
      <Text style={[styles.label, { color: textColour }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A full-width row in a settings-style list: the title, a line under it, or a value on the right. */
export function ListRow({
  title,
  detail,
  value,
  onPress,
  icon,
  right,
  disabled = false,
}: {
  title: string;
  detail?: string;
  /** A short current value shown before the chevron, as "English ›". */
  value?: string;
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
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <Icon name="chevron" size={20} color={colors.textMuted} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min,
    paddingHorizontal: space.l,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
  },
  play: { backgroundColor: colors.playFill },
  playPressed: { backgroundColor: colors.textSoft },
  primary: { backgroundColor: colors.action },
  primaryPressed: { backgroundColor: colors.actionPressed },
  secondary: { backgroundColor: colors.surface3 },
  quiet: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  label: { ...type.label, fontSize: 16 },
  row: {
    minHeight: touch.row,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    backgroundColor: colors.surface2,
  },
  rowPressed: { backgroundColor: colors.raised },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: colors.text },
  rowDetail: { ...type.meta, color: colors.textMuted },
  rowValue: { ...type.label, fontWeight: '500', color: colors.textMuted, flexShrink: 1 },
});
