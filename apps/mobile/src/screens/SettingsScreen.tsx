import { MAIN_PROFILE_ID } from '@bannertv/core';
import { serviceStatus } from '@tv/data/api';
import { preferences, setPreference, type Preferences } from '@tv/data/preferences';
import { allAddons } from '@tv/data/addons';
import { activeProfile, activeProfileId, isKidsProfile, profiles } from '@tv/data/profiles';
import { accountSection, accountState, checkAccountSection, refreshAccount } from '@tv/data/sync';
import { traktAccount } from '@tv/data/trakt';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { statusLine } from '../data/account-text';
import { useAccountRefresh } from './profiles/refresh';
import { Avatar } from '../ui/Avatar';
import { ListRow } from '../ui/Button';
import { SubtitleStyleChoices, useSubtitleStyle } from '../player/SubtitleStyle';
import { Sheet, SheetOption } from '../ui/Sheet';
import { colors, gutter, radius, space, touch, type } from '../ui/theme';

// No "Test links before playing": the phone has no player of its own to test a link with, as
// the TV app on Android, where Automatic means off.
type Choice = 'streamChoice';
const CHOICES: { [K in Choice]: readonly Preferences[K][] } = {
  streamChoice: ['quality', 'fast'],
};

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Toggle({
  title,
  value,
  onChange,
}: {
  title: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <ListRow
      title={title}
      onPress={() => onChange(!value)}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: colors.action, false: colors.surface3 }}
          thumbColor={colors.text}
          accessibilityLabel={title}
        />
      }
    />
  );
}

/** Settings: who is watching, the account, addons, playback and the build. */
export function SettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  const services = useSyncExternalStore(serviceStatus.subscribe, serviceStatus.get);
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  const account = useSyncExternalStore(accountState.subscribe, accountState.get);
  const list = useSyncExternalStore(profiles.subscribe, profiles.get).profiles;
  // Every install, those switched off too: Addons lists them all.
  const addons = useSyncExternalStore(allAddons.subscribe, allAddons.get);
  const trakt = useSyncExternalStore(traktAccount.subscribe, traktAccount.get);
  const [choosing, setChoosing] = useState<Choice | null>(null);
  const [styling, setStyling] = useState(false);
  const look = useSubtitleStyle();
  const kids = isKidsProfile();
  const isMain = activeProfileId.get() === MAIN_PROFILE_ID;
  const profile = activeProfile();

  const [now, setNow] = useState(() => Date.now());
  const { refreshing, onRefresh } = useAccountRefresh();
  // Each visit, as the TV's Settings mounts on each: a failed check offline tries again later.
  // The profiles shown are the account's now, not as of the last sync (item A8).
  useFocusEffect(
    useCallback(() => {
      if (isMain) checkAccountSection();
      void refreshAccount();
    }, [isMain]),
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const valueOf = (_choice: Choice, value: string) => t(`settings.streamChoiceValue.${value}`);
  const accountDetail =
    account.engine !== 'running'
      ? undefined
      : account.status.state === 'off'
        ? // Signed out: what the account page offers, Join alone while new accounts are closed.
          section.canCreate
          ? t('phone.accountMakeOrJoin')
          : t('account.join')
        : account.status.state === 'setup' || account.status.state === 'gone'
          ? undefined
          : statusLine(t, account.status, now);
  const version = Constants.expoConfig?.version ?? '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.m }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.action]}
          progressViewOffset={insets.top}
        />
      }
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('phone.tabs.settings')}
      </Text>

      {profile ? (
        <View style={styles.profileCard}>
          <Avatar profile={profile} size={52} round />
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profile.name}
            </Text>
            <Text style={styles.profileDetail} numberOfLines={1}>
              {isMain && accountDetail ? accountDetail : t('phone.profile')}
            </Text>
          </View>
          {list.length > 1 ? (
            <Pressable
              onPress={() => router.push('/profiles')}
              accessibilityRole="button"
              accessibilityLabel={t('phone.switchProfile')}
              hitSlop={(touch.min - touch.chip) / 2}
              style={({ pressed }) => [styles.switch, pressed && styles.switchPressed]}
            >
              <Text style={styles.switchText}>{t('phone.switch')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {kids ? (
        <Text style={styles.lead}>{t('settings.kidsLead')}</Text>
      ) : (
        <>
          <Section title={t('phone.playback')}>
            <ListRow
              title={t('settings.streamChoiceTitle')}
              value={valueOf('streamChoice', prefs.streamChoice)}
              onPress={() => setChoosing('streamChoice')}
            />
            <ListRow
              title={t('phone.subtitleStyle')}
              value={t('player.styleSummary', {
                size: t(`player.styleValue.size.${look.size}`),
                colour: t(`player.styleColourInline.${look.colour}`),
              })}
              onPress={() => setStyling(true)}
            />
            <Toggle
              title={t('phone.stillWatchingSetting')}
              value={prefs.stillWatching}
              onChange={(next) => setPreference('stillWatching', next)}
            />
          </Section>

          <Section title={t('phone.libraryAndAccounts')}>
            <ListRow
              title={t('profiles.title')}
              value={t('phone.profilesCount', { count: list.length })}
              onPress={() => router.push('/manage-profiles')}
            />
            <ListRow
              title={t('phone.addons')}
              {...(addons.ready
                ? { value: t('phone.addonsCount', { count: addons.addons.length }) }
                : {})}
              onPress={() => router.push('/addons')}
            />
            {services.trakt ? (
              <ListRow
                title={t('phone.trakt')}
                {...(trakt.status === 'signedIn'
                  ? { value: trakt.username ?? t('trakt.signedIn') }
                  : {})}
                onPress={() => router.push('/trakt')}
              />
            ) : null}
            <ListRow title={t('homeRows.title')} onPress={() => router.push('/home-rows')} />
            {isMain && section.shown ? (
              <ListRow
                title={t('phone.account')}
                {...(accountDetail ? { value: accountDetail } : {})}
                onPress={() => router.push('/account')}
              />
            ) : null}
          </Section>

          {services.tmdb ? (
            <Section title={t('settings.services')}>
              <Toggle
                title={t('settings.tmdb', { value: prefs.tmdb ? t('common.on') : t('common.off') })}
                value={prefs.tmdb}
                onChange={(next) => setPreference('tmdb', next)}
              />
              {prefs.tmdb ? <Text style={styles.credit}>{t('settings.tmdbCredit')}</Text> : null}
            </Section>
          ) : null}
        </>
      )}

      <Text style={styles.about}>{t('phone.about', { version })}</Text>

      <Sheet
        visible={styling}
        title={t('phone.subtitleStyle')}
        onClose={() => setStyling(false)}
        scroll={false}
      >
        <SubtitleStyleChoices />
      </Sheet>

      <Sheet
        visible={choosing !== null}
        title={choosing === 'streamChoice' ? t('settings.streamChoiceTitle') : ''}
        onClose={() => setChoosing(null)}
      >
        {choosing
          ? CHOICES[choosing].map((value) => (
              <SheetOption
                key={value}
                label={valueOf(choosing, value)}
                selected={prefs[choosing] === value}
                onPress={() => {
                  setPreference('streamChoice', value);
                  setChoosing(null);
                }}
              />
            ))
          : null}
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl * 2, gap: 22 },
  title: { ...type.display, color: colors.text, marginBottom: -6 },
  lead: { ...type.body, color: colors.textMuted },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: space.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface2,
  },
  profileText: { flex: 1, gap: 2 },
  profileName: { ...type.heading, fontSize: 17, color: colors.text },
  profileDetail: { ...type.meta, color: colors.textMuted },
  switch: {
    minHeight: touch.chip,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  switchPressed: { backgroundColor: colors.surface3, opacity: 0.8 },
  switchText: { ...type.meta, fontWeight: '700', color: colors.text },
  section: { gap: space.s },
  sectionTitle: { ...type.overline, color: colors.accent },
  // The 1-unit gaps show the raised colour behind the rows: the dividers.
  sectionBody: {
    borderRadius: radius.l,
    overflow: 'hidden',
    gap: 1,
    backgroundColor: colors.raised,
  },
  credit: { ...type.small, color: colors.textSubtle, padding: space.m },
  about: { ...type.meta, color: colors.textMuted, textAlign: 'center' },
});
