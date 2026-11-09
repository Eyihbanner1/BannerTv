import { activeProfileId } from '@tv/data/profiles';
import { Tabs } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { type ColorValue, StyleSheet, Text } from 'react-native';
import { useEpisodeAlerts } from '../../data/episode-alerts';
import { useMatchReminders } from '../../data/match-reminders';
import { useAddonLinks } from '../../nav/use-addon-links';
import { useSportsShown } from '../../screens/sports/use-sports';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OutlineIcon, type OutlineName } from '../../ui/icons';
import { colors, font, touch } from '../../ui/theme';

/** The bar's height above the phone's gesture area. */
const BAR_HEIGHT = 64;
/**
 * How far the phone's text size may grow the labels. Past this "Settings" ran out of room as
 * "Settin…" across five tabs on a 360-wide phone, and the label began to leave the bar.
 */
const MAX_LABEL_SCALE = 1.3;

// The bar hands the active tab's tint; the active glyph is the brighter focus violet.
const icon =
  (name: OutlineName) =>
  ({ focused }: { focused: boolean }) => (
    <OutlineIcon name={name} size={24} color={focused ? colors.prismTop : colors.textMuted} />
  );

// The bar's own label grows with the phone's text size however large it is (its style cannot
// cap that), so the label is drawn here, capped.
const label = ({
  color,
  position,
  children,
}: {
  color: ColorValue;
  position: string;
  children: string;
}) => (
  <Text
    style={[styles.label, position === 'beside-icon' && styles.beside, { color }]}
    numberOfLines={1}
    maxFontSizeMultiplier={MAX_LABEL_SCALE}
  >
    {children}
  </Text>
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
  // Match reminders' notifications, and a tapped one opening its match.
  useMatchReminders();
  // New-episode alerts' notifications, and a tapped one opening its series.
  useEpisodeAlerts();
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
        tabBarLabel: label,
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

const styles = StyleSheet.create({
  label: {
    fontFamily: font,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    backgroundColor: 'transparent',
  },
  // A wide screen puts the label beside the icon, spaced as the bar's own label.
  beside: { marginStart: 5 },
});
