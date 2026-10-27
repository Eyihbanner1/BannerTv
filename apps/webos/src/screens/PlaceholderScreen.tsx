import { useTranslation } from 'react-i18next';
import type { Section } from '../app/router';
import { useScreenFocus } from '../app/use-screen-focus';
import styles from './Screen.module.css';

/** Sections that arrive in later phases. Nothing to focus, so focus stays in the rail. */
export function PlaceholderScreen({ section }: { section: Extract<Section, 'library'> }) {
  const { t } = useTranslation();
  useScreenFocus();
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t(`rail.${section}`)}</h1>
      <p className={styles.lead}>{t(`placeholder.${section}`)}</p>
    </div>
  );
}
