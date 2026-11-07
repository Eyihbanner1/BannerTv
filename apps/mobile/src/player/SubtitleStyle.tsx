import {
  DEFAULT_PREFERENCES,
  preferences,
  setPreference,
  setSubtitleStyle,
  type SubtitleStyle,
} from '@tv/data/preferences';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { colors, font, space, type } from '../ui/theme';
import { subtitleLook } from './subtitle-look';

const CHOICES: { [K in keyof SubtitleStyle]: ReadonlyArray<SubtitleStyle[K]> } = {
  size: ['small', 'medium', 'large', 'huge'],
  colour: ['white', 'yellow', 'cyan', 'green'],
  background: ['outline', 'shadow', 'box', 'solid'],
  position: ['bottom', 'raised', 'top'],
};
const FIELDS: ReadonlyArray<keyof SubtitleStyle> = ['size', 'colour', 'background', 'position'];
/** The ends of the sample line inside its box, as the player pads each line. */
const PAD = '\u00a0';

/** The profile's subtitle style, as it changes (shared with the TV's Settings). */
export function useSubtitleStyle(): SubtitleStyle {
  return useSyncExternalStore(preferences.subscribe, () => preferences.get().subtitleStyle);
}

/**
 * Subtitle size, colour, background and position, each a row of chips, with a sample line on
 * top. The player's panel and Settings both use it; changes show at once.
 */
export function SubtitleStyleChoices() {
  const { t } = useTranslation();
  const look = useSubtitleStyle();
  const screen = useWindowDimensions();
  // Drawn as the player draws subtitles (subtitle-look.ts), at the size they have on this screen.
  const drawn = subtitleLook(look, screen, false);
  return (
    <ScrollView contentContainerStyle={styles.choices}>
      <View style={styles.sample} accessibilityElementsHidden importantForAccessibility="no">
        <Text style={[styles.sampleText, drawn.text]}>
          {drawn.back ? (
            <Text style={{ backgroundColor: drawn.back }}>
              {PAD}
              {t('player.sampleLine')}
              {PAD}
            </Text>
          ) : (
            t('player.sampleLine')
          )}
        </Text>
      </View>
      {FIELDS.map((field) => (
        <View key={field} style={styles.field}>
          <Text style={styles.name}>{t(`player.styleField.${field}`)}</Text>
          <View style={styles.chips}>
            {(CHOICES[field] as readonly string[]).map((value) => (
              <Chip
                key={value}
                label={t(`player.styleValue.${field}.${value}`)}
                on={look[field] === value}
                onPress={() => setSubtitleStyle(field, value as SubtitleStyle[typeof field])}
              />
            ))}
          </View>
        </View>
      ))}
      <Button
        kind="quiet"
        label={t('player.styleReset')}
        onPress={() => setPreference('subtitleStyle', DEFAULT_PREFERENCES.subtitleStyle)}
        style={styles.reset}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  choices: { gap: space.l, paddingBottom: space.l },
  sample: {
    minHeight: 72,
    borderRadius: 12,
    backgroundColor: '#2A2440',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.m,
  },
  sampleText: { fontFamily: font, fontWeight: '600', textAlign: 'center' },
  field: { gap: space.s },
  name: { ...type.overline, color: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  reset: { alignSelf: 'flex-start', paddingHorizontal: 0 },
});
