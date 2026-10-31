import { activeProfileId } from '@tv/data/profiles';
import { Tabs } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useSportsShown } from '../../screens/sports/use-sports';
import { Icon, type IconName } from '../../ui/icons';
import { colors, font } from '../../ui/theme';

const icon =
  (name: IconName) =>
  ({ color }: { color: unknown }) => (
    <Icon name={name} size={24} color={typeof color === 'string' ? color : colors.textSubtle} />
  );

/**
 * Home, Search, Sports, My List and Settings along the bottom. Sports shows only while an
 * installed addon has sports catalogs, and never for a kids profile, as in the TV's rail.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  // Read again when the profile is chosen at launch: kids have no Sports.
  useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const sportsShown = useSportsShown();
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
        name="sports"
        options={{
          title: t('phone.tabs.sports'),
          tabBarIcon: icon('sports'),
          ...(sportsShown ? {} : { href: null }),
        }}
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
