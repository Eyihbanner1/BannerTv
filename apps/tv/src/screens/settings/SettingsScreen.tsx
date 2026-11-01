import { MAIN_PROFILE_ID } from '@bannertv/core';
import { statusLine } from '@phone/data/account-text';
import { addonCollection } from '@tv/data/addons';
import {
  preferences,
  setPreference,
  setSubtitleStyle,
  type SubtitleStyle,
} from '@tv/data/preferences';
import { activeProfile, activeProfileId, isKidsProfile, profiles } from '@tv/data/profiles';
import { accountState, checkAccountSection } from '@tv/data/sync';
import { traktAccount } from '@tv/data/trakt';
import { androidHostInfo } from '@tv/platform/android';
import Constants from 'expo-constants';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import { open } from '../../nav/routes';
import { Avatar } from '../../ui/Avatar';
import { Focusable } from '../../ui/Focusable';
import { useNow } from '../../ui/use-now';
import { color, layout, px, radii, spacing, type } from '../../ui/theme';
import { nextChoice } from './choices';
import { SettingNote, SettingRow } from './SettingRow';

type SectionKey =
  | 'profiles'
  | 'account'
  | 'addons'
  | 'playback'
  | 'subtitles'
  | 'trakt'
  | 'homeRows'
  | 'parental'
  | 'about';

const SECTIONS: readonly SectionKey[] = [
  'profiles',
  'account',
  'addons',
  'playback',
  'subtitles',
  'trakt',
  'homeRows',
  'parental',
  'about',
];
/** What a kids profile may change, as on the LG: how subtitles look, and who is watching. */
const KIDS_SECTIONS: readonly SectionKey[] = ['profiles', 'subtitles', 'about'];

const SIZES: readonly SubtitleStyle['size'][] = ['small', 'medium', 'large', 'huge'];
const COLOURS: readonly SubtitleStyle['colour'][] = ['white', 'yellow', 'cyan', 'green'];
const BACKGROUNDS: readonly SubtitleStyle['background'][] = ['outline', 'shadow', 'box', 'solid'];
const POSITIONS: readonly SubtitleStyle['position'][] = ['bottom', 'raised', 'top'];
const STREAM_CHOICES = ['quality', 'fast'] as const;

/** Settings: a rail of sections on the left, the chosen one on the right. */
export function SettingsScreen({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const kids = isKidsProfile();
  const sections = kids ? KIDS_SECTIONS : SECTIONS;
  const [section, setSection] = useState<SectionKey>(sections[0]!);
  return (
    <View style={styles.screen}>
      <TVFocusGuideView autoFocus style={styles.rail}>
        <Text style={styles.railTitle}>{t('tv.settings.title')}</Text>
        {sections.map((key, index) => (
          <Focusable
            key={key}
            radius={radii.lg}
            // Landing on a section shows it, so the arrows browse without pressing OK.
            onFocus={() => setSection(key)}
            onPress={() => setSection(key)}
            {...(index === 0 && active ? { preferred: true } : {})}
            accessibilityLabel={t(`tv.settings.${key}`)}
          >
            {(focused) => (
              <View
                style={[
                  styles.railItem,
                  key === section && styles.railItemOn,
                  focused && styles.railItemFocused,
                ]}
              >
                <Text
                  style={[
                    styles.railLabel,
                    key === section && styles.railLabelOn,
                    focused && styles.railLabelFocused,
                  ]}
                >
                  {t(`tv.settings.${key}`)}
                </Text>
              </View>
            )}
          </Focusable>
        ))}
      </TVFocusGuideView>
      <TVFocusGuideView autoFocus style={styles.panel}>
        <ScrollView contentContainerStyle={styles.panelContent}>
          <Text style={styles.panelTitle}>{t(`tv.settings.${section}`)}</Text>
          <SectionBody section={section} />
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
}

function SectionBody({ section }: { section: SectionKey }): ReactNode {
  switch (section) {
    case 'profiles':
      return <ProfilesSection />;
    case 'account':
      return <AccountSection />;
    case 'addons':
      return <AddonsSection />;
    case 'playback':
      return <PlaybackSection />;
    case 'subtitles':
      return <SubtitlesSection />;
    case 'trakt':
      return <TraktSection />;
    case 'about':
      return <AboutSection />;
    case 'homeRows':
    case 'parental':
      return <Elsewhere />;
  }
}

function Elsewhere() {
  const { t } = useTranslation();
  return <SettingNote>{t('tv.settings.elsewhere')}</SettingNote>;
}

function ProfilesSection() {
  const { t } = useTranslation();
  const list = useSyncExternalStore(profiles.subscribe, profiles.get).profiles;
  const profile = activeProfile();
  return (
    <>
      {profile ? (
        <View style={styles.person}>
          <Avatar profile={profile} size={px(96)} />
          <Text style={styles.personName}>{profile.name}</Text>
        </View>
      ) : null}
      {list.length > 1 ? (
        <SettingRow
          title={t('tv.settings.switchProfile')}
          detail={list.map((entry) => entry.name).join(', ')}
          onPress={() => open({ name: 'profiles' })}
        />
      ) : null}
      <Elsewhere />
    </>
  );
}

function AccountSection() {
  const { t } = useTranslation();
  const account = useSyncExternalStore(accountState.subscribe, accountState.get);
  const isMain = activeProfileId.get() === MAIN_PROFILE_ID;
  const now = useNow(30_000);
  useEffect(() => {
    if (isMain) checkAccountSection();
  }, [isMain]);
  const on = account.engine === 'running' && account.status.state !== 'off';
  return (
    <>
      <SettingRow
        title={t(on ? 'tv.settings.syncOn' : 'tv.settings.syncOff')}
        {...(on && account.status.state !== 'setup' && account.status.state !== 'gone'
          ? { detail: statusLine(t, account.status, now) }
          : {})}
      />
      <Elsewhere />
    </>
  );
}

function AddonsSection() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  return (
    <>
      <SettingNote>{t('tv.settings.addonCount', { count: collection.addons.length })}</SettingNote>
      {collection.addons.map((addon) => (
        <SettingRow
          key={addon.transportUrl}
          title={addon.manifest.name}
          {...(addon.manifest.description ? { detail: addon.manifest.description } : {})}
          value={addon.manifest.version}
        />
      ))}
      <Elsewhere />
    </>
  );
}

function PlaybackSection() {
  const { t } = useTranslation();
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  return (
    <>
      <SettingRow
        title={t('settings.streamChoiceTitle')}
        value={t(`settings.streamChoiceValue.${prefs.streamChoice}`)}
        onPress={() =>
          setPreference('streamChoice', nextChoice(STREAM_CHOICES, prefs.streamChoice))
        }
        preferred
      />
      <SettingRow
        title={t('player.stillWatching.title')}
        toggle={prefs.stillWatching}
        onPress={() => setPreference('stillWatching', !prefs.stillWatching)}
      />
      <SettingRow
        title={t('settings.tmdb', { value: '' }).replace(/:\s*$/, '')}
        detail={t('settings.tmdbCredit')}
        toggle={prefs.tmdb}
        onPress={() => setPreference('tmdb', !prefs.tmdb)}
      />
    </>
  );
}

function SubtitlesSection() {
  const { t } = useTranslation();
  const style = useSyncExternalStore(preferences.subscribe, preferences.get).subtitleStyle;
  const row = <K extends keyof SubtitleStyle>(
    key: K,
    options: readonly SubtitleStyle[K][],
    first = false,
  ) => (
    <SettingRow
      title={t(`player.styleField.${key}`)}
      value={t(`player.styleValue.${key}.${style[key]}`)}
      onPress={() => setSubtitleStyle(key, nextChoice(options, style[key]))}
      {...(first ? { preferred: true } : {})}
    />
  );
  return (
    <>
      {row('size', SIZES, true)}
      {row('colour', COLOURS)}
      {row('background', BACKGROUNDS)}
      {row('position', POSITIONS)}
      <SettingNote>{t('player.styleKept')}</SettingNote>
    </>
  );
}

function TraktSection() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(traktAccount.subscribe, traktAccount.get);
  return (
    <>
      <SettingRow
        title={t(state.status === 'signedIn' ? 'tv.settings.traktOn' : 'tv.settings.traktOff')}
        {...(state.status === 'signedIn' && state.username ? { value: state.username } : {})}
      />
      <Elsewhere />
    </>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  const host = androidHostInfo();
  const device = host
    ? [host.manufacturer, host.model, host.release && `Android ${host.release}`]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <>
      <SettingRow
        title={t('tv.settings.build')}
        value={Constants.expoConfig?.version ?? ''}
        detail={t('tv.settings.testBuild')}
      />
      {device ? <SettingRow title={t('tv.settings.device')} value={device} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: color.bg },
  rail: {
    width: layout.settingsRail,
    backgroundColor: color.rail,
    paddingTop: px(90),
    paddingHorizontal: px(48),
    gap: spacing.xs,
  },
  railTitle: { ...type.heading, color: color.text, marginBottom: spacing.xl },
  railItem: {
    height: px(72),
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  railItemOn: { backgroundColor: color.surface },
  railItemFocused: { backgroundColor: color.focusFill },
  railLabel: { ...type.label, color: color.textMuted },
  railLabelOn: { color: color.text },
  railLabelFocused: { color: color.onFocus },
  panel: { flex: 1 },
  panelContent: {
    paddingTop: px(90),
    paddingHorizontal: px(80),
    paddingBottom: px(160),
    gap: spacing.md,
    maxWidth: px(1200),
  },
  panelTitle: { ...type.heading, color: color.text, marginBottom: spacing.lg },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.md },
  personName: { ...type.rowTitle, color: color.text },
});
