import { MAIN_PROFILE_ID } from '@bannertv/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import appinfo from '../../webos-meta/appinfo.json';
import { push } from '../app/router';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import { Menu } from '../components/Menu';
import { serviceStatus } from '../data/api';
import { type Preferences, preferences, setPreference } from '../data/preferences';
import { activeProfileId, isKidsProfile } from '../data/profiles';
import { accountSection, checkAccountSection } from '../data/sync';
import { SubtitleStylePanel } from './player/SubtitleStylePanel';
import styles from './Screen.module.css';
import settings from './SettingsScreen.module.css';

const STREAM_CHOICES: ReadonlyArray<Preferences['streamChoice']> = ['quality', 'fast'];
const PROBING: ReadonlyArray<Preferences['probing']> = ['auto', 'on', 'off'];

type Open = 'streamChoice' | 'probing' | 'style' | null;

/** A kids profile's Settings: only how subtitles look. */
function KidsSettings() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useScreenFocus('settings-subtitle-style');
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('rail.settings')}</h1>
      <p className={styles.lead}>{t('settings.kidsLead')}</p>
      <div className={styles.column}>
        <Button
          block
          focusKey="settings-subtitle-style"
          label={t('player.style')}
          onPress={() => setOpen(true)}
        />
      </div>
      <p className={styles.muted}>
        {t('settings.about', { title: appinfo.title, version: appinfo.version, id: appinfo.id })}
      </p>
      {open && (
        <SubtitleStylePanel
          returnFocusKey="settings-subtitle-style"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function SettingsScreen() {
  return isKidsProfile() ? <KidsSettings /> : <FullSettings />;
}

function FullSettings() {
  const { t } = useTranslation();
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  const service = useSyncExternalStore(serviceStatus.subscribe, serviceStatus.get);
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  const [open, setOpen] = useState<Open>(null);
  useScreenFocus('settings-stream-choice');
  // The account is Main's to manage: other profiles, kids or not, never see it (ADR 0006).
  const isMain = activeProfileId.get() === MAIN_PROFILE_ID;
  useEffect(() => {
    if (isMain) checkAccountSection();
  }, [isMain]);

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('rail.settings')}</h1>
      <p className={styles.lead}>{t('settings.lead')}</p>
      <div className={`${styles.column} ${settings.left}`}>
        <h2 className={settings.heading}>{t('settings.playback')}</h2>
        <Button
          block
          focusKey="settings-stream-choice"
          label={t('settings.streamChoice', {
            value: t(`settings.streamChoiceValue.${prefs.streamChoice}`),
          })}
          onPress={() => setOpen('streamChoice')}
        />
        <Button
          block
          focusKey="settings-probing"
          label={t('settings.probing', { value: t(`settings.probingValue.${prefs.probing}`) })}
          onPress={() => setOpen('probing')}
        />
        <Button
          block
          focusKey="settings-subtitle-style"
          label={t('player.style')}
          onPress={() => setOpen('style')}
        />
        <Button
          block
          focusKey="settings-still-watching"
          label={t('settings.stillWatching', {
            value: t(prefs.stillWatching ? 'common.on' : 'common.off'),
          })}
          onPress={() => setPreference('stillWatching', !prefs.stillWatching)}
        />
        <Button
          block
          focusKey="settings-diagnostics"
          label={t('settings.diagnostics')}
          onPress={() => push({ name: 'diagnostics' })}
        />
        <Button
          block
          focusKey="settings-lab"
          label={t('settings.lab')}
          onPress={() => push({ name: 'lab' })}
        />
        <Button
          block
          focusKey="settings-stream-helper"
          label={t('settings.streamHelper')}
          onPress={() => push({ name: 'stream-helper' })}
        />
        <Button
          block
          focusKey="settings-languages"
          label={t('languages.title')}
          onPress={() => push({ name: 'languages' })}
        />
      </div>
      <div className={`${styles.column} ${settings.right}`}>
        <h2 className={settings.heading}>{t('settings.people')}</h2>
        <Button
          block
          focusKey="settings-profiles"
          label={t('profiles.title')}
          onPress={() => push({ name: 'profiles' })}
        />
        <Button
          block
          focusKey="settings-home-rows"
          label={t('homeRows.title')}
          onPress={() => push({ name: 'home-rows' })}
        />
        {isMain && section.shown && (
          <Button
            block
            focusKey="settings-account"
            label={t('settings.account')}
            onPress={() => push({ name: 'account' })}
          />
        )}
        {(service.trakt || service.tmdb) && (
          <h2 className={`${settings.heading} ${settings.later}`}>{t('settings.services')}</h2>
        )}
        {service.trakt && (
          <Button
            block
            focusKey="settings-trakt"
            label={t('settings.trakt')}
            onPress={() => push({ name: 'trakt' })}
          />
        )}
        {service.tmdb && (
          <Button
            block
            focusKey="settings-tmdb"
            label={t('settings.tmdb', { value: t(prefs.tmdb ? 'common.on' : 'common.off') })}
            onPress={() => setPreference('tmdb', !prefs.tmdb)}
          />
        )}
      </div>
      <p className={styles.muted}>
        {t('settings.about', { title: appinfo.title, version: appinfo.version, id: appinfo.id })}
      </p>
      {service.tmdb && prefs.tmdb && <p className={styles.muted}>{t('settings.tmdbCredit')}</p>}
      {open === 'streamChoice' && (
        <Menu
          focusKey="settings-stream-choice-menu"
          title={t('settings.streamChoiceTitle')}
          options={STREAM_CHOICES.map((value) => ({
            value,
            label: t(`settings.streamChoiceValue.${value}`),
          }))}
          selected={prefs.streamChoice}
          returnFocusKey="settings-stream-choice"
          onSelect={(value) => {
            setPreference('streamChoice', value as Preferences['streamChoice']);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'probing' && (
        <Menu
          focusKey="settings-probing-menu"
          title={t('settings.probingTitle')}
          options={PROBING.map((value) => ({ value, label: t(`settings.probingValue.${value}`) }))}
          selected={prefs.probing}
          returnFocusKey="settings-probing"
          onSelect={(value) => {
            setPreference('probing', value as Preferences['probing']);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'style' && (
        <SubtitleStylePanel
          returnFocusKey="settings-subtitle-style"
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
