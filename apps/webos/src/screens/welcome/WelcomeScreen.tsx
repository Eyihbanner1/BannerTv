import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import lockupUrl from '../../../../../brand/logo/bannertv-lockup-horizontal.svg';
import { openSection } from '../../app/router';
import { Button } from '../../components/Button';
import { finishWelcome } from '../../data/welcome';
import { requestInstallDialog } from '../addons/install-request';
import styles from './WelcomeScreen.module.css';

/**
 * First run: what BannerTV is, the notice the LG store asks for (BannerTV
 * hosts nothing beyond its Demo addon's Creative Commons films; the user picks
 * the addons), and a way into Home or straight into adding an addon. Back here
 * leaves the app, like Back on Home.
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'welcome',
    isFocusBoundary: true,
  });

  useEffect(() => {
    void setFocus('welcome-start');
  }, []);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.welcome} role="dialog" aria-label={t('welcome.title')}>
        <div className={styles.glow} />
        <div className={styles.body}>
          <img className={styles.lockup} src={lockupUrl} alt="BannerTV" />
          <h1 className={styles.title}>{t('welcome.title')}</h1>
          <p className={styles.lead}>{t('welcome.lead')}</p>
          <p className={styles.ready}>{t('welcome.ready')}</p>
          <div className={styles.notice}>
            <h2 className={styles.noticeTitle}>{t('welcome.noticeTitle')}</h2>
            <p>{t('welcome.notice')}</p>
          </div>
          <div className={styles.actions}>
            <Button
              variant="primary"
              focusKey="welcome-start"
              label={t('welcome.start')}
              onPress={finishWelcome}
            />
            <Button
              focusKey="welcome-add"
              label={t('welcome.addAddon')}
              onPress={() => {
                requestInstallDialog();
                openSection('addons');
                finishWelcome();
              }}
            />
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
