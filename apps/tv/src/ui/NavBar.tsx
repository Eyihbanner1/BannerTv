import { activeProfile } from '@tv/data/profiles';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { open, openSection, type Section } from '../nav/routes';
import { Avatar } from './Avatar';
import { Focusable } from './Focusable';
import { Icon } from './icons';
import { color, layout, px, radii, spacing, type } from './theme';

const SECTIONS: { section: Section; label: string }[] = [
  { section: 'home', label: 'tv.nav.home' },
  { section: 'search', label: 'tv.nav.search' },
  { section: 'discover', label: 'tv.nav.discover' },
  { section: 'sports', label: 'tv.nav.sports' },
  { section: 'library', label: 'tv.nav.myList' },
];

/** Where on the nav row focus goes back to when its screen is on top again. */
export type NavTarget = 'current' | 'settings' | 'profile';

/**
 * The row along the top: the wordmark, the places, Settings and who is watching.
 * `focus` names the item that takes focus while the screen is `active`, so coming back from
 * Settings lands on the gear and choosing a place lands on its tab. `onLeave` says which item
 * opened another screen, for the screen to pass back as `focus`.
 */
export function NavBar({
  current,
  active = false,
  focus = null,
  onLeave,
}: {
  current: Section;
  active?: boolean;
  focus?: NavTarget | null;
  onLeave?: (target: NavTarget) => void;
}) {
  const { t } = useTranslation();
  const profile = activeProfile();
  const preferred = (target: NavTarget) => (active && focus === target ? { preferred: true } : {});
  return (
    <View style={styles.bar}>
      <Text style={styles.wordmark}>
        Banner<Text style={styles.tv}>TV</Text>
      </Text>
      <View style={styles.places}>
        {SECTIONS.map(({ section, label }) => (
          <Focusable
            key={section}
            radius={radii.pill}
            onPress={() => openSection(section)}
            {...(section === current ? preferred('current') : {})}
            accessibilityLabel={t(label)}
          >
            {(focused) => (
              <View
                style={[
                  styles.pill,
                  section === current && styles.current,
                  focused && styles.focused,
                ]}
              >
                <Text
                  style={[
                    styles.label,
                    section === current && styles.currentLabel,
                    focused && styles.focusedLabel,
                  ]}
                >
                  {t(label)}
                </Text>
              </View>
            )}
          </Focusable>
        ))}
      </View>
      <View style={styles.end}>
        <Focusable
          radius={px(32)}
          // A fixed box, so the ring hugs the round button rather than the bar's height.
          style={styles.roundBox}
          onPress={() => {
            onLeave?.('settings');
            open({ name: 'settings' });
          }}
          {...preferred('settings')}
          accessibilityLabel={t('tv.nav.settings')}
        >
          {(focused) => (
            <View style={[styles.round, focused && styles.focused]}>
              <Icon
                name="settings"
                size={px(36)}
                tint={focused ? color.onFocus : color.textMuted}
              />
            </View>
          )}
        </Focusable>
        {profile ? (
          <Focusable
            radius={px(32)}
            style={styles.roundBox}
            onPress={() => {
              onLeave?.('profile');
              open({ name: 'profiles' });
            }}
            {...preferred('profile')}
            accessibilityLabel={t('tv.nav.profile', { name: profile.name })}
          >
            <Avatar profile={profile} size={px(64)} />
          </Focusable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: layout.navHeight,
    paddingHorizontal: layout.heroLeft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxl,
  },
  wordmark: { ...type.heading, color: color.text },
  tv: { color: color.accent },
  places: { flexDirection: 'row', gap: spacing.sm, flex: 1 },
  pill: {
    paddingHorizontal: spacing.lg,
    height: px(60),
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  current: { backgroundColor: color.raised },
  focused: { backgroundColor: color.focusFill },
  label: { ...type.label, color: color.textMuted },
  currentLabel: { color: color.text },
  focusedLabel: { color: color.onFocus },
  end: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  roundBox: { width: px(64), height: px(64) },
  round: {
    width: px(64),
    height: px(64),
    borderRadius: px(32),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
