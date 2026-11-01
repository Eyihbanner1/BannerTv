import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Focusable } from '../../ui/Focusable';
import { color, layout, px, radii, spacing, type } from '../../ui/theme';

/** A row of Settings: what it is on the left, its value or switch on the right. */
export function SettingRow({
  title,
  detail,
  value,
  toggle,
  onPress,
  preferred,
}: {
  title: string;
  detail?: string;
  /** Shown on the right; OK moves to the next choice. */
  value?: string;
  /** A switch on the right, on or off. */
  toggle?: boolean;
  onPress?: () => void;
  preferred?: boolean;
}) {
  const label = [title, value ?? (toggle === undefined ? '' : toggle ? 'on' : 'off'), detail]
    .filter(Boolean)
    .join(', ');
  return (
    <Focusable
      radius={radii.lg}
      {...(onPress ? { onPress } : {})}
      {...(preferred ? { preferred } : {})}
      disabled={!onPress}
      accessibilityLabel={label}
    >
      {(focused) => (
        <View style={[styles.row, focused && styles.focused]}>
          <View style={styles.words}>
            <Text style={[styles.title, focused && styles.onFocus]}>{title}</Text>
            {detail ? (
              <Text style={[styles.detail, focused && styles.onFocusSoft]}>{detail}</Text>
            ) : null}
          </View>
          {value !== undefined ? (
            <Text style={[styles.value, focused && styles.onFocus]}>{value}</Text>
          ) : null}
          {toggle !== undefined ? <Toggle on={toggle} /> : null}
        </View>
      )}
    </Focusable>
  );
}

function Toggle({ on }: { on: boolean }) {
  const width = layout.toggleW;
  const height = layout.toggleH;
  const knob = height - px(10);
  return (
    <View
      style={[
        styles.toggle,
        { width, height, borderRadius: height / 2 },
        on ? styles.toggleOn : styles.toggleOff,
      ]}
    >
      <View
        style={[
          styles.knob,
          { width: knob, height: knob, borderRadius: knob / 2 },
          on ? { marginLeft: width - knob - px(5) } : { marginLeft: px(5) },
        ]}
      />
    </View>
  );
}

/** Words in a section, with no action: a note, or a fact read from elsewhere. */
export function SettingNote({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.settingsRowH,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: color.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  focused: { backgroundColor: color.focusFill },
  words: { flex: 1, gap: px(4) },
  title: { ...type.label, color: color.text },
  detail: { ...type.small, color: color.textMuted },
  value: { ...type.label, color: color.accent },
  onFocus: { color: color.onFocus },
  onFocusSoft: { color: color.raised },
  toggle: { justifyContent: 'center' },
  toggleOn: { backgroundColor: color.brand },
  toggleOff: { backgroundColor: color.track },
  knob: { backgroundColor: color.text },
  note: { ...type.body, color: color.textMuted },
});
