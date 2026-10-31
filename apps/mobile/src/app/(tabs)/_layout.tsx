import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../../ui/icons';
import { colors, font } from '../../ui/theme';

const icon =
  (name: IconName) =>
  ({ color }: { color: unknown }) => (
    <Icon name={name} size={24} color={typeof color === 'string' ? color : colors.textSubtle} />
  );

/** Home, Search, My List and Settings along the bottom. */
export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface1, borderTopColor: colors.surface2 },
        tabBarActiveTintColor: colors.prismTop,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarLabelStyle: { fontFamily: font, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('phone.tabs.home'), tabBarIcon: icon('home') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: t('phone.tabs.search'), tabBarIcon: icon('search') }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: t('phone.tabs.library'), tabBarIcon: icon('list') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('phone.tabs.settings'), tabBarIcon: icon('settings') }}
      />
    </Tabs>
  );
}
