import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, type } from './theme';

/** A panel that slides up from the bottom; tapping outside or Back closes it. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  scroll = true,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.panel, { paddingBottom: insets.bottom + space.l }]}>
        <View style={styles.handle} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {scroll ? <ScrollView style={styles.scroll}>{children}</ScrollView> : children}
      </View>
    </Modal>
  );
}

/** One choice in a sheet. */
export function SheetOption({
  label,
  detail,
  selected = false,
  onPress,
  disabled = false,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
        disabled && styles.optionDisabled,
      ]}
    >
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
      {detail ? <Text style={styles.optionDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim },
  panel: {
    maxHeight: '80%',
    backgroundColor: colors.surface2,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    paddingTop: space.s,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
    marginBottom: space.s,
  },
  title: {
    ...type.heading,
    color: colors.text,
    paddingHorizontal: space.l,
    paddingBottom: space.s,
  },
  scroll: { flexGrow: 0 },
  option: { paddingHorizontal: space.l, paddingVertical: space.m, gap: 2 },
  optionSelected: { backgroundColor: colors.surface3 },
  optionPressed: { opacity: 0.7 },
  optionDisabled: { opacity: 0.45 },
  optionLabel: { ...type.body, color: colors.text },
  optionLabelSelected: { color: colors.prismTop, fontWeight: '700' },
  optionDetail: { ...type.small, color: colors.textMuted },
});
