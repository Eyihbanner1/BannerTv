import { ease, motion, phone } from '@brand/tokens/design';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OutlineIcon } from '../ui/icons';
import { colors, radius, space, touch, type } from '../ui/theme';

/** How far the panel travels as it slides in from the right edge. */
const SLIDE_FROM = 48;

/**
 * The player's sheet, held sideways: a panel that slides in from the right over the dimmed
 * video, as the design's audio and subtitles sheet. Tapping the video side or Back closes it.
 * The slide runs on the native driver, so a busy JavaScript thread cannot make it stutter.
 */
export function SidePanel({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [slide] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    const animation = Animated.timing(slide, {
      toValue: 1,
      duration: motion.slide,
      easing: Easing.bezier(...ease.decelerate),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, slide]);

  const panelWidth = Math.min(phone.sideSheetW + insets.right, Math.round(width * 0.62));
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['landscape', 'portrait']}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('phone.close')}
        />
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              paddingRight: Math.max(insets.right, space.xl),
              paddingTop: Math.max(insets.top, 18),
              paddingBottom: Math.max(insets.bottom, 18),
              opacity: slide,
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [SLIDE_FROM, 0],
                  }),
                },
              ],
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('phone.close')}
              style={styles.close}
            >
              <OutlineIcon name="close" size={20} />
            </Pressable>
          </View>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A column in a panel, under small capitals: Audio, Subtitles. */
export function PanelColumn({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.column}>
      {title ? <Text style={styles.columnTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/**
 * One choice in a panel: the chosen one sits on a raised fill with a tick. A dimmed one (a
 * subtitle file that couldn't be read) can still be tapped, to try it again.
 */
export function PanelOption({
  label,
  detail,
  selected = false,
  onPress,
  disabled = false,
  dim = false,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  dim?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && !selected && styles.optionPressed,
        (disabled || dim) && styles.optionDisabled,
      ]}
    >
      <View style={styles.optionText}>
        <Text
          style={[styles.optionLabel, selected && styles.optionLabelSelected]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {detail ? (
          <Text style={styles.optionDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <OutlineIcon name="check" size={16} color={colors.prismTop} weight={2.8} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(5, 3, 10, 0.55)' },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.sheet,
    borderTopLeftRadius: phone.sideSheetRadius,
    borderBottomLeftRadius: phone.sideSheetRadius,
    paddingLeft: space.xl,
    gap: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.heading, fontWeight: '800', color: colors.text, flexShrink: 1 },
  close: {
    width: touch.min,
    height: touch.min,
    marginRight: -space.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  column: { flex: 1, gap: space.xs },
  columnTitle: { ...type.overline, color: colors.accent, marginBottom: space.xs },
  option: {
    minHeight: touch.min,
    paddingHorizontal: space.m,
    borderRadius: radius.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  optionSelected: { backgroundColor: colors.raised },
  optionPressed: { backgroundColor: colors.surface2 },
  optionDisabled: { opacity: 0.45 },
  optionText: { flex: 1, paddingVertical: space.xs },
  optionLabel: { ...type.label, fontWeight: '500', color: colors.textSoft },
  optionLabelSelected: { fontWeight: '700', color: colors.text },
  optionDetail: { ...type.small, color: colors.textMuted },
});
