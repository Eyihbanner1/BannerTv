import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { QrCode } from '../../components/QrCode';
import { createPairing, PAIR_SERVICE } from '../../data/pairing';
import styles from './AddonsScreen.module.css';

interface PhonePanelProps {
  /** Called with each address the phone sends. */
  onAddress: (url: string) => void;
  /**
   * An addon's settings page, for the phone page to link to. It rides in the
   * QR code's fragment, so it goes from the TV to the phone and no further.
   */
  configureUrl?: string;
  title: string;
  /** Where focus goes when the retry button disappears. */
  focusAfterRetry: string;
}

/** Spaced in threes, which is easier to read across a room. */
function spaced(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** A host name that may wrap after its dots, never inside a word. */
function breakable(host: string) {
  return host.split('.').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && '.'}
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}

/** "Or send it from your phone": a QR code and a short code for the pairing relay. */
export function PhonePanel({ onAddress, configureUrl, title, focusAfterRetry }: PhonePanelProps) {
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
    const qrText = configureUrl
      ? `${pageUrl}&configure=${encodeURIComponent(configureUrl)}`
      : pageUrl;
    body = (
      <>
        <QrCode className={styles.qr} text={qrText} size={configureUrl ? 280 : 240} />
        <p className={styles.pairCode}>
          {t('addons.phone.code')}
          <strong>{spaced(code)}</strong>
        </p>
        <p className={styles.phoneHelp}>{t('addons.phone.scan')}</p>
        <p className={styles.pairHost}>{breakable(new URL(pageUrl).host)}</p>
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
      <h3 className={styles.phoneTitle}>{title}</h3>
      {body}
    </section>
  );
}
