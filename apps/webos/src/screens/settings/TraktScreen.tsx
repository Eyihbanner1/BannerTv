import type { DeviceSignInState } from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QrCode } from '../../components/QrCode';
import { lastSync, syncTrakt, traktAccount, traktDevice } from '../../data/trakt';
import screen from '../Screen.module.css';
import styles from './TraktScreen.module.css';

/** The address without its scheme, to type into a phone. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** How long the code on show has left, counting down. */
function MinutesLeft({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className={styles.help}>
      {t('trakt.codeLasts', { count: Math.max(1, Math.ceil((expiresAt - now) / 60000)) })}
    </p>
  );
}

function SignIn({ device, expired }: { device: DeviceSignInState; expired: boolean }) {
  const { t } = useTranslation();
  const waiting = device.status === 'waiting';

  let note: string | null = expired ? t('trakt.signInExpired') : null;
  let action = t('trakt.signIn');
  if (device.status === 'starting') note = t('trakt.starting');
  if (waiting || device.status === 'expired') action = t('trakt.newCode');
  if (device.status === 'expired') note = t('trakt.codeExpired');
  if (device.status === 'denied') note = t('trakt.denied');
  if (device.status === 'failed') note = t(`trakt.failed.${device.kind}`);
  if (device.status === 'denied' || device.status === 'failed') action = t('common.tryAgain');

  return (
    <>
      <div className={`${screen.column} ${styles.actions}`}>
        <Button
          block
          variant="primary"
          focusKey="trakt-sign-in"
          label={action}
          onPress={() => void traktDevice.start()}
        />
        {waiting && (
          <Button
            block
            focusKey="trakt-cancel"
            label={t('common.cancel')}
            onPress={() => {
              void setFocus('trakt-sign-in');
              traktDevice.stop();
            }}
          />
        )}
        {note && <p className={styles.note}>{note}</p>}
      </div>
      {waiting && (
        <section className={styles.code} aria-live="polite">
          <QrCode className={styles.qr} text={device.verificationUrl} size={240} />
          <div className={styles.codeText}>
            <p className={styles.help}>
              {t('trakt.goTo', { url: shortUrl(device.verificationUrl) })}
            </p>
            <p className={styles.userCode}>{device.userCode}</p>
            <MinutesLeft key={device.userCode} expiresAt={device.expiresAt} />
          </div>
        </section>
      )}
    </>
  );
}

function SignedIn({ username }: { username?: string }) {
  const { t } = useTranslation();
  const last = useSyncExternalStore(lastSync.subscribe, lastSync.get);
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  let status: string | null = null;
  if (syncing) status = t('trakt.syncing');
  else if (last?.result === 'done') status = t('trakt.synced', { time: clock(last.at) });
  else if (last?.result === 'failed') status = t('trakt.syncFailed');

  return (
    <div className={`${screen.column} ${styles.actions}`}>
      <p className={styles.account}>
        {username ? t('trakt.signedInAs', { name: username }) : t('trakt.signedIn')}
      </p>
      <Button
        block
        variant="primary"
        focusKey="trakt-sync"
        label={t('trakt.syncNow')}
        onPress={() => {
          if (syncing) return;
          setSyncing(true);
          void syncTrakt().then(() => {
            if (mounted.current) setSyncing(false);
          });
        }}
      />
      <Button
        block
        focusKey="trakt-sign-out"
        label={t('trakt.signOut')}
        onPress={() => setConfirming(true)}
      />
      {status && (
        <p className={styles.note} role="status">
          {status}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          focusKey="trakt-sign-out-dialog"
          title={t('trakt.signOutTitle')}
          message={t('trakt.signOutMessage')}
          confirmLabel={t('trakt.signOut')}
          cancelLabel={t('common.cancel')}
          returnFocusKey={() =>
            traktAccount.get().status === 'signedIn' ? 'trakt-sign-out' : 'trakt-sign-in'
          }
          onConfirm={() => {
            setConfirming(false);
            void traktAccount.signOut();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/**
 * Settings > Trakt: signing in with a code entered at trakt.tv, then syncing
 * now and signing out. Shown only when BannerTV's service has Trakt's keys,
 * and never to a kids profile.
 */
export function TraktScreen() {
  const { t } = useTranslation();
  const account = useSyncExternalStore(traktAccount.subscribe, traktAccount.get);
  const device = useSyncExternalStore(traktDevice.subscribe, traktDevice.get);
  useEffect(() => {
    void traktAccount.load();
    return () => traktDevice.stop();
  }, []);

  const signedIn = account.status === 'signedIn';
  useScreenFocus(signedIn ? 'trakt-sync' : 'trakt-sign-in', account.status !== 'loading');
  // Signing in or out swaps the buttons, so focus moves with them.
  const was = useRef(account.status);
  useEffect(() => {
    if (was.current !== 'loading' && was.current !== account.status) {
      void setFocus(signedIn ? 'trakt-sync' : 'trakt-sign-in');
    }
    was.current = account.status;
  }, [account.status, signedIn]);

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('trakt.title')}</h1>
      <p className={screen.lead}>{t('trakt.lead')}</p>
      {account.status === 'signedIn' && <SignedIn username={account.username} />}
      {account.status === 'signedOut' && (
        <SignIn device={device} expired={account.expired === true} />
      )}
    </div>
  );
}
