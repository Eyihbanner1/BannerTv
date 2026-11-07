import { TMDB_LOGO } from '@bannertv/core';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * TMDB's logo after the title of a row TMDB supplied, as its terms ask:
 * unchanged, in its own colour, and smaller than BannerTV's logo.
 */
export function TmdbLogo() {
  const { t } = useTranslation();
  return (
    <Svg
      width={22}
      height={22}
      viewBox={TMDB_LOGO.viewBox}
      style={styles.logo}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('search.fromTmdb')}
    >
      <Path fill={TMDB_LOGO.colour} d={TMDB_LOGO.path} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  logo: { alignSelf: 'center' },
});
