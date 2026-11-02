import {
  DEFAULT_PREFERENCES,
  preferences,
  setPreference,
  setSubtitleStyle,
  type SubtitleStyle,
} from '@tv/data/preferences';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { colors, space, type } from '../ui/theme';

const CHOICES: { [K in keyof SubtitleStyle]: ReadonlyArray<SubtitleStyle[K]> } = {
  size: ['small', 'medium', 'large', 'huge'],
  colour: ['white', 'yellow', 'cyan', 'green'],
  background: ['outline', 'shadow', 'box', 'solid'],
  position: ['bottom', 'raised', 'top'],
};
const FIELDS: ReadonlyArray<keyof SubtitleStyle> = ['size', 'colour', 'background', 'position'];

/** The TV's sizes (40, 52, 64 and 80 on a 1080-high picture), for a phone held sideways. */
const SIZE: Record<SubtitleStyle['size'], number> = { small: 16, medium: 20, large: 24, huge: 30 };
const COLOUR: Record<SubtitleStyle['colour'], string> = {
  white: '#FFFFFF',
  yellow: '#FFE45C',
  cyan: '#6AE4FF',
  green: '#8CF59A',
};
const BACK: Record<SubtitleStyle['background'], TextStyle> = {
  outline: {
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  shadow: {
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  box: { backgroundColor: 'rgba(0,0,0,0.6)' },
  solid: { backgroundColor: '#000000' },
};

/** The profile's subtitle style, as it changes (shared with the TV's Settings). */
export function useSubtitleStyle(): SubtitleStyle {
  return useSyncExternalStore(preferences.subscribe, () => preferences.get().subtitleStyle);
}

/** How a subtitle line looks in this style. */
export function subtitleTextStyle(look: SubtitleStyle): TextStyle {
  const size = SIZE[look.size];
  return {
    fontSize: size,
    lineHeight: Math.round(size * 1.3),
    color: COLOUR[look.colour],
    ...BACK[look.background],
    ...(look.background === 'box' || look.background === 'solid'
      ? { paddingHorizontal: Math.round(size * 0.3) }
      : {}),
  };
}

/**
 * Subtitle size, colour, background and position, each a row of chips, with a sample line on
 * top. The player's panel and Settings both use it; changes show at once.
 */
export function SubtitleStyleChoices() {
  const { t } = useTranslation();
  const look = useSubtitleStyle();
  return (
    <ScrollView contentContainerStyle={styles.choices}>
      <View style={styles.sample} accessibilityElementsHidden importantForAccessibility="no">
        <Text style={[styles.sampleText, subtitleTextStyle(look)]}>{t('player.sampleLine')}</Text>
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
  sampleText: { fontWeight: '600', textAlign: 'center' },
  field: { gap: space.s },
  name: { ...type.overline, color: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  reset: { alignSelf: 'flex-start', paddingHorizontal: 0 },
});
