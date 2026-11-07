import { MAIN_PROFILE_ID } from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import lockupUrl from '../../../../../brand/logo/bannertv-lockup-horizontal.svg';
import { openSection, push } from '../../app/router';
import { Button } from '../../components/Button';
import { activeProfileId } from '../../data/profiles';
import { accountSection, accountState, checkAccountSection, openAccount } from '../../data/sync';
import { syncOn } from '../../data/sync-clock';
import { finishWelcome } from '../../data/welcome';
import { requestInstallDialog } from '../addons/install-request';
import styles from './WelcomeScreen.module.css';

/** Leaves the welcome for Settings > BannerTV account: on Create, or on typing a code. */
function toAccount(join: boolean): void {
  openSection('settings');
  push({ name: 'account', join }, 'settings-account');
  finishWelcome();
}

/**
 * First run: what BannerTV is, the notice the LG store asks for (BannerTV
 * hosts nothing beyond its Demo addon's Creative Commons films; the user picks
 * the addons), and a way into Home or straight into adding an addon. Beside
 * them, the BannerTV account is offered (Create an account, Join with a code)
 * where Settings would offer it: on Main, once its service has answered, and
 * only on a screen the engine has found signed out. Start browsing keeps focus, since the
 * account is optional (ADR 0006). Back here leaves the app, like Back on Home.
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'welcome',
    isFocusBoundary: true,
  });
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  // Only once the engine has read what it kept, opened here as the account screen opens
  // it: a screen whose localStorage lost the welcome may still be in an account, or part
  // way into one.
  const account = useSyncExternalStore(accountState.subscribe, accountState.get);
  const isMain = activeProfileId.get() === MAIN_PROFILE_ID;
  const offerAccount =
    isMain &&
    section.shown &&
    !syncOn() &&
    account.engine === 'running' &&
    account.status.state === 'off';

  useEffect(() => {
    void setFocus('welcome-start');
    if (isMain) {
      checkAccountSection();
      openAccount();
    }
  }, [isMain]);

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
        {offerAccount && (
          <section className={styles.account} aria-label={t('welcome.accountTitle')}>
            <h2 className={styles.accountTitle}>{t('welcome.accountTitle')}</h2>
            <p className={styles.accountLead}>{t('welcome.accountLead')}</p>
            {section.canCreate && (
              <Button
                block
                focusKey="welcome-account-create"
                label={t('account.create')}
                onPress={() => toAccount(false)}
              />
            )}
            <Button
              block
              focusKey="welcome-account-join"
              label={t('welcome.join')}
              onPress={() => toAccount(true)}
            />
          </section>
        )}
      </div>
    </FocusContext.Provider>
  );
}
