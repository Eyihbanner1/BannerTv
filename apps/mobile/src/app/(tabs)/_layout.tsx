import { activeProfileId } from '@tv/data/profiles';
import { Tabs } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useAddonLinks } from '../../nav/use-addon-links';
import { useSportsShown } from '../../screens/sports/use-sports';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OutlineIcon, type OutlineName } from '../../ui/icons';
import { colors, font, touch } from '../../ui/theme';

/** The bar's height above the phone's gesture area. */
const BAR_HEIGHT = 64;

// The bar hands the active tab's tint; the active glyph is the brighter focus violet.
const icon =
  (name: OutlineName) =>
  ({ focused }: { focused: boolean }) => (
    <OutlineIcon name={name} size={24} color={focused ? colors.prismTop : colors.textMuted} />
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
  const insets = useSafeAreaInsets();
  // An addon link from outside the app opens Addons over the tabs, for a grown-up.
  useAddonLinks();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.sheet,
          borderTopColor: colors.raised,
          borderTopWidth: 1,
          height: BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
        },
        tabBarItemStyle: { minHeight: touch.min },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: font, fontWeight: '700', fontSize: 12 },
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
        options={{ title: t('phone.tabs.library'), tabBarIcon: icon('bookmark') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('phone.tabs.settings'), tabBarIcon: icon('person') }}
      />
    </Tabs>
  );
}
