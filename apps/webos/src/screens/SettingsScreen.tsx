import { useTranslation } from 'react-i18next';
import appinfo from '../../webos-meta/appinfo.json';
import { push } from '../app/router';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import styles from './Screen.module.css';

export function SettingsScreen() {
  const { t } = useTranslation();
  useScreenFocus('settings-diagnostics');

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('rail.settings')}</h1>
      <p className={styles.lead}>{t('settings.lead')}</p>
      <div className={styles.column}>
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
    </div>
  );
}
