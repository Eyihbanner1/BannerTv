import { languageName } from '@bannertv/core';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { Menu } from '../../components/Menu';
import { baseLanguage, languageChoices, PICTURE_CHOICES } from '../../data/language-choices';
import { type MaxResolution, preferences, setPreference } from '../../data/preferences';
import screen from '../Screen.module.css';

type Open = 'audio' | 'subtitles' | 'when' | 'picture' | null;

const base = baseLanguage;

/**
 * The profile's languages and picture (improvements list PL6): the audio and
 * subtitles every title starts with unless one was chosen for it, whether
 * subtitles show only when the audio is in another language, the highest
 * picture auto-play goes for, and HDR. Kept per profile.
 */
export function LanguagesScreen() {
  const { t } = useTranslation();
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  const [open, setOpen] = useState<Open>(null);
  useScreenFocus('languages-audio');

  const languageOptions = (current: string | null) =>
    languageChoices(current).map((code) => ({ value: code, label: languageName(code) }));
  const audio = prefs.audioLanguage
    ? languageName(base(prefs.audioLanguage)!)
    : t('languages.original');
  const subtitles = prefs.subtitleLanguage
    ? languageName(base(prefs.subtitleLanguage)!)
    : t('common.off');
  const when = t(`languages.when.${prefs.subtitleWhen}`, { language: subtitles });
  const picture = t(`languages.picture.${prefs.maxResolution ?? 'any'}`);

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('languages.title')}</h1>
      <p className={screen.lead}>{t('languages.lead')}</p>
      <div className={screen.column}>
        <Button
          block
          focusKey="languages-audio"
          label={t('languages.audio', { value: audio })}
          onPress={() => setOpen('audio')}
        />
        <Button
          block
          focusKey="languages-subtitles"
          label={t('languages.subtitles', { value: subtitles })}
          onPress={() => setOpen('subtitles')}
        />
        {prefs.subtitleLanguage !== null && (
          <Button
            block
            focusKey="languages-when"
            label={t('languages.showSubtitles', { value: when })}
            onPress={() => setOpen('when')}
          />
        )}
        <Button
          block
          focusKey="languages-picture"
          label={t('languages.highest', { value: picture })}
          onPress={() => setOpen('picture')}
        />
        <Button
          block
          focusKey="languages-hdr"
          label={t('languages.avoidHdr', { value: t(prefs.avoidHdr ? 'common.on' : 'common.off') })}
          onPress={() => setPreference('avoidHdr', !prefs.avoidHdr)}
        />
        <Button
          block
          focusKey="languages-learn"
          label={t('languages.learn', {
            value: t(prefs.learnLanguages ? 'common.on' : 'common.off'),
          })}
          onPress={() => setPreference('learnLanguages', !prefs.learnLanguages)}
        />
      </div>
      <p className={screen.muted}>
        {t(prefs.learnLanguages ? 'languages.learnOn' : 'languages.learnOff')}
      </p>
      {open === 'audio' && (
        <Menu
          focusKey="languages-audio-menu"
          title={t('languages.audioTitle')}
          options={[{ value: 'original', label: t('languages.original') }].concat(
            languageOptions(prefs.audioLanguage),
          )}
          selected={base(prefs.audioLanguage) ?? 'original'}
          returnFocusKey="languages-audio"
          onSelect={(value) => {
            setPreference('audioLanguage', value === 'original' ? null : value);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'subtitles' && (
        <Menu
          focusKey="languages-subtitles-menu"
          title={t('languages.subtitlesTitle')}
          options={[{ value: 'off', label: t('common.off') }].concat(
            languageOptions(prefs.subtitleLanguage),
          )}
          selected={base(prefs.subtitleLanguage) ?? 'off'}
          returnFocusKey="languages-subtitles"
          onSelect={(value) => {
            setPreference('subtitleLanguage', value === 'off' ? null : value);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'when' && (
        <Menu
          focusKey="languages-when-menu"
          title={t('languages.showSubtitlesTitle')}
          options={(['always', 'foreign'] as const).map((value) => ({
            value,
            label: t(`languages.when.${value}`, { language: subtitles }),
          }))}
          selected={prefs.subtitleWhen}
          returnFocusKey="languages-when"
          onSelect={(value) => {
            setPreference('subtitleWhen', value === 'foreign' ? 'foreign' : 'always');
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'picture' && (
        <Menu
          focusKey="languages-picture-menu"
          title={t('languages.highestTitle')}
          options={PICTURE_CHOICES.map((value) => ({
            value,
            label: t(`languages.picture.${value}`),
          }))}
          selected={prefs.maxResolution ?? 'any'}
          returnFocusKey="languages-picture"
          onSelect={(value) => {
            setPreference('maxResolution', value === 'any' ? null : (value as MaxResolution));
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
