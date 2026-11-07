import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '../nav/routes';
import { Icon } from './icons';
import { colors, space, type } from './theme';

/** A pushed screen's top bar: Back and the title. */
export function ScreenHeader({
  title,
  right,
  onBack = goBack,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.s }]}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <Icon name="back" />
      </Pressable>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    paddingHorizontal: space.l,
    paddingBottom: space.m,
    backgroundColor: colors.bg,
  },
  title: { ...type.title, color: colors.text, flex: 1 },
});
