import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import appinfo from '../../webos-meta/appinfo.json';
import { push } from '../app/router';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import { Menu } from '../components/Menu';
import { type Preferences, preferences, setPreference } from '../data/preferences';
import { SubtitleStylePanel } from './player/SubtitleStylePanel';
import styles from './Screen.module.css';

const STREAM_CHOICES: ReadonlyArray<Preferences['streamChoice']> = ['quality', 'fast'];
const PROBING: ReadonlyArray<Preferences['probing']> = ['auto', 'on', 'off'];

type Open = 'streamChoice' | 'probing' | 'style' | null;

export function SettingsScreen() {
  const { t } = useTranslation();
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  const [open, setOpen] = useState<Open>(null);
  useScreenFocus('settings-stream-choice');

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('rail.settings')}</h1>
      <p className={styles.lead}>{t('settings.lead')}</p>
      <div className={styles.column}>
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
      </div>
      <p className={styles.muted}>
        {t('settings.about', { title: appinfo.title, version: appinfo.version, id: appinfo.id })}
      </p>
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
