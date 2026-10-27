import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { QrCode } from '../../components/QrCode';
import { createPairing, PAIR_SERVICE } from '../../data/pairing';
import styles from './AddonsScreen.module.css';

interface PhonePanelProps {
  /** Called with each address the phone sends. */
  onAddress: (url: string) => void;
  /** Where focus goes when the retry button disappears. */
  focusAfterRetry: string;
}

/** Spaced in threes, which is easier to read across a room. */
function spaced(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** "Or send it from your phone": a QR code and a short code for the pairing relay. */
export function PhonePanel({ onAddress, focusAfterRetry }: PhonePanelProps) {
  const { t } = useTranslation();
  const [pairing] = useState(() => createPairing({ service: PAIR_SERVICE }));
  const state = useSyncExternalStore(pairing.subscribe, pairing.get);
  useEffect(() => pairing.onAddress(onAddress), [pairing, onAddress]);
  useEffect(() => {
    pairing.start();
    return () => pairing.stop();
  }, [pairing]);

  const retry = () => {
    setFocus(focusAfterRetry);
    pairing.start();
  };

  let body;
  if (state.status === 'waiting') {
    const { code, pageUrl } = state.session;
    body = (
      <>
        <QrCode className={styles.qr} text={pageUrl} size={240} />
        <p className={styles.pairCode}>
          {t('addons.phone.code')}
          <strong>{spaced(code)}</strong>
        </p>
        <p className={styles.phoneHelp}>{t('addons.phone.scan')}</p>
        <p className={styles.pairHost}>{new URL(pageUrl).host}</p>
      </>
    );
  } else if (state.status === 'opening') {
    body = <p className={styles.qrPlaceholder}>{t('addons.phone.opening')}</p>;
  } else {
    const expired = state.status === 'expired';
    body = (
      <>
        <p className={styles.qrPlaceholder}>
          {expired ? t('addons.phone.expired') : t('addons.phone.unavailable')}
        </p>
        <Button
          focusKey="install-phone-retry"
          label={expired ? t('addons.phone.newCode') : t('addons.phone.retry')}
          onPress={retry}
        />
      </>
    );
  }

  return (
    <section className={styles.phone}>
      <h3 className={styles.phoneTitle}>{t('addons.phone.title')}</h3>
      {body}
    </section>
  );
}
