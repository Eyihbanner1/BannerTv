import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import { Focusable } from './Focusable';
import { Icon } from './icons';
import { color, layout, px, radii, spacing, type } from './theme';

/** A panel that rises from the bottom over the picture. Focus stays inside it until Back. */
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <TVFocusGuideView
      autoFocus
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
      style={styles.sheet}
    >
      {children}
    </TVFocusGuideView>
  );
}

/** One column of a sheet, with its heading. */
export function SheetColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <TVFocusGuideView autoFocus style={styles.column}>
      <Text style={styles.heading}>{title}</Text>
      <ScrollView contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </TVFocusGuideView>
  );
}

export function SheetOption({
  label,
  detail,
  selected,
  onPress,
  preferred,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  preferred?: boolean;
}) {
  return (
    <Focusable
      radius={radii.md}
      onPress={onPress}
      {...(preferred ? { preferred } : {})}
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
    >
      {(focused) => (
        <View style={[styles.option, focused && styles.optionFocused]}>
          <View style={styles.check}>
            {selected ? (
              <Icon name="check" size={px(32)} tint={focused ? color.onFocus : color.accent} />
            ) : null}
          </View>
          <View style={styles.words}>
            <Text style={[styles.label, focused && styles.onFocus]} numberOfLines={1}>
              {label}
            </Text>
            {detail ? (
              <Text style={[styles.detail, focused && styles.onFocusSoft]} numberOfLines={1}>
                {detail}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Focusable>
  );
}

export function SheetNote({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: layout.sheetH,
    backgroundColor: color.sheet,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: layout.heroLeft,
    paddingTop: spacing.xxl,
    flexDirection: 'row',
    gap: px(64),
  },
  column: { flex: 1 },
  heading: { ...type.rowTitle, color: color.text, marginBottom: spacing.lg },
  options: { gap: spacing.xs, paddingBottom: spacing.xxl },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: px(72),
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    gap: spacing.sm,
  },
  optionFocused: { backgroundColor: color.focusFill },
  check: { width: px(40), alignItems: 'center' },
  words: { flex: 1 },
  label: { ...type.label, color: color.text },
  detail: { ...type.small, color: color.textMuted },
  onFocus: { color: color.onFocus },
  onFocusSoft: { color: color.raised },
  note: { ...type.small, color: color.textMuted, paddingHorizontal: spacing.md },
});
