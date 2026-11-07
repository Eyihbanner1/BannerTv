import { TMDB_LOGO } from '@bannertv/core';
import { useTranslation } from 'react-i18next';
import styles from './SearchScreen.module.css';

/**
 * TMDB's logo after the title of a row TMDB supplied, as its terms ask:
 * unchanged, in its own colour, and smaller than BannerTV's logo in the menu.
 */
export function TmdbLogo() {
  const { t } = useTranslation();
  return (
    <svg
      className={styles.tmdb}
      viewBox={TMDB_LOGO.viewBox}
      role="img"
      aria-label={t('search.fromTmdb')}
      focusable="false"
    >
      <path fill={TMDB_LOGO.colour} d={TMDB_LOGO.path} />
    </svg>
  );
}
