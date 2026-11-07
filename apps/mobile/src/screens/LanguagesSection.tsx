import { languageName } from '@bannertv/core';
import { baseLanguage, languageChoices, PICTURE_CHOICES } from '@tv/data/language-choices';
import { type MaxResolution, preferences, setPreference } from '@tv/data/preferences';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { ListRow } from '../ui/Button';
import { Sheet, SheetOption } from '../ui/Sheet';
import { colors, radius, space, type } from '../ui/theme';

type Open = 'audio' | 'subtitles' | 'when' | 'picture' | null;

/**
 * Settings > Languages and picture on the phone, as on the TV (improvements
 * list PL6): the audio and subtitles every title starts with unless one was
 * chosen for it, subtitles only when the audio is in another language, the
 * highest picture, HDR, and whether a choice in the player is for every title.
 */
export function LanguagesSection() {
  const { t } = useTranslation();
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  const [open, setOpen] = useState<Open>(null);

  const audio = prefs.audioLanguage
    ? languageName(baseLanguage(prefs.audioLanguage)!)
    : t('languages.original');
  const subtitles = prefs.subtitleLanguage
    ? languageName(baseLanguage(prefs.subtitleLanguage)!)
    : t('common.off');
  const close = () => setOpen(null);
  const toggle = (title: string, value: boolean, onChange: (next: boolean) => void) => (
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

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t('languages.title')}
      </Text>
      <View style={styles.sectionBody}>
        <ListRow title={t('languages.audioTitle')} value={audio} onPress={() => setOpen('audio')} />
        <ListRow
          title={t('languages.subtitlesTitle')}
          value={subtitles}
          onPress={() => setOpen('subtitles')}
        />
        {prefs.subtitleLanguage !== null ? (
          <ListRow
            title={t('languages.showSubtitlesTitle')}
            value={t(`languages.when.${prefs.subtitleWhen}`, { language: subtitles })}
            onPress={() => setOpen('when')}
          />
        ) : null}
        <ListRow
          title={t('languages.highestTitle')}
          value={t(`phone.picture.${prefs.maxResolution ?? 'any'}`)}
          onPress={() => setOpen('picture')}
        />
        {toggle(t('phone.avoidHdr'), prefs.avoidHdr, (next) => setPreference('avoidHdr', next))}
        {toggle(t('phone.learnLanguages'), prefs.learnLanguages, (next) =>
          setPreference('learnLanguages', next),
        )}
      </View>
      <Text style={styles.note}>
        {t(prefs.learnLanguages ? 'languages.learnOn' : 'languages.learnOff')}
      </Text>

      <Sheet visible={open === 'audio'} title={t('languages.audioTitle')} onClose={close}>
        {[null, ...languageChoices(prefs.audioLanguage)].map((code) => (
          <SheetOption
            key={code ?? 'original'}
            label={code ? languageName(code) : t('languages.original')}
            selected={baseLanguage(prefs.audioLanguage) === code}
            onPress={() => {
              setPreference('audioLanguage', code);
              close();
            }}
          />
        ))}
      </Sheet>
      <Sheet visible={open === 'subtitles'} title={t('languages.subtitlesTitle')} onClose={close}>
        {[null, ...languageChoices(prefs.subtitleLanguage)].map((code) => (
          <SheetOption
            key={code ?? 'off'}
            label={code ? languageName(code) : t('common.off')}
            selected={baseLanguage(prefs.subtitleLanguage) === code}
            onPress={() => {
              setPreference('subtitleLanguage', code);
              close();
            }}
          />
        ))}
      </Sheet>
      <Sheet visible={open === 'when'} title={t('languages.showSubtitlesTitle')} onClose={close}>
        {(['always', 'foreign'] as const).map((value) => (
          <SheetOption
            key={value}
            label={t(`languages.when.${value}`, { language: subtitles })}
            selected={prefs.subtitleWhen === value}
            onPress={() => {
              setPreference('subtitleWhen', value);
              close();
            }}
          />
        ))}
      </Sheet>
      <Sheet visible={open === 'picture'} title={t('languages.highestTitle')} onClose={close}>
        {PICTURE_CHOICES.map((value) => (
          <SheetOption
            key={value}
            label={t(`phone.picture.${value}`)}
            selected={(prefs.maxResolution ?? 'any') === value}
            onPress={() => {
              setPreference('maxResolution', value === 'any' ? null : (value as MaxResolution));
              close();
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.s },
  sectionTitle: { ...type.overline, color: colors.accent },
  // The 1-unit gaps show the raised colour behind the rows: the dividers.
  sectionBody: {
    borderRadius: radius.l,
    overflow: 'hidden',
    gap: 1,
    backgroundColor: colors.raised,
  },
  note: { ...type.small, color: colors.textSubtle, paddingHorizontal: space.m },
});
