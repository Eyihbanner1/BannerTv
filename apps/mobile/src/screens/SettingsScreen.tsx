import { MAIN_PROFILE_ID } from '@bannertv/core';
import { serviceStatus } from '@tv/data/api';
import { preferences, setPreference, type Preferences } from '@tv/data/preferences';
import { activeProfile, activeProfileId, isKidsProfile, profiles } from '@tv/data/profiles';
import { accountSection, accountState, checkAccountSection } from '@tv/data/sync';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { statusLine } from '../data/account-text';
import { Avatar } from '../ui/Avatar';
import { ListRow } from '../ui/Button';
import { Sheet, SheetOption } from '../ui/Sheet';
import { colors, radius, space, type } from '../ui/theme';

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
  const [choosing, setChoosing] = useState<Choice | null>(null);
  const kids = isKidsProfile();
  const isMain = activeProfileId.get() === MAIN_PROFILE_ID;
  const profile = activeProfile();

  const [now, setNow] = useState(() => Date.now());
  // Each visit, as the TV's Settings mounts on each: a failed check offline tries again later.
  useFocusEffect(
    useCallback(() => {
      if (isMain) checkAccountSection();
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
        ? t('account.join')
        : account.status.state === 'setup' || account.status.state === 'gone'
          ? undefined
          : statusLine(t, account.status, now);
  const version = Constants.expoConfig?.version ?? '';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.l }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('phone.tabs.settings')}
      </Text>

      {profile ? (
        <Section>
          <ListRow
            title={profile.name}
            detail={list.length > 1 ? t('phone.switchProfile') : t('phone.profile')}
            right={<Avatar profile={profile} size={40} />}
            {...(list.length > 1 ? { onPress: () => router.push('/profiles') } : {})}
          />
        </Section>
      ) : null}

      {kids ? (
        <Text style={styles.lead}>{t('settings.kidsLead')}</Text>
      ) : (
        <>
          {isMain && section.shown ? (
            <Section>
              <ListRow
                title={t('phone.account')}
                icon="cloud"
                {...(accountDetail ? { detail: accountDetail } : {})}
                onPress={() => router.push('/account')}
              />
            </Section>
          ) : null}

          <Section>
            <ListRow
              title={t('phone.addons')}
              detail={t('phone.addonsLead')}
              icon="layers"
              onPress={() => router.push('/addons')}
            />
          </Section>

          <Section title={t('phone.playback')}>
            <ListRow
              title={t('settings.streamChoiceTitle')}
              detail={valueOf('streamChoice', prefs.streamChoice)}
              onPress={() => setChoosing('streamChoice')}
            />
            <Toggle
              title={t('phone.stillWatchingSetting')}
              value={prefs.stillWatching}
              onChange={(next) => setPreference('stillWatching', next)}
            />
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
  content: { paddingHorizontal: space.l, paddingBottom: space.xxl * 2, gap: space.l },
  title: { ...type.display, color: colors.text },
  lead: { ...type.body, color: colors.textMuted },
  section: { gap: space.s },
  sectionTitle: { ...type.label, color: colors.textMuted, textTransform: 'uppercase' },
  sectionBody: { borderRadius: radius.l, overflow: 'hidden', gap: 1 },
  credit: { ...type.small, color: colors.textSubtle, padding: space.m },
  about: { ...type.small, color: colors.textSubtle, textAlign: 'center' },
});
