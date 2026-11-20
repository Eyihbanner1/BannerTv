import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { QrCode } from '../../components/QrCode';
import { TextField } from '../../components/TextField';
import { createPairing, PAIR_SERVICE } from '../../data/pairing';
import { createPhoneKeyLink, type PhoneKeyLink, type PhoneKeyState } from '../../data/phone-key';
import {
  removeSubdlKey,
  saveSubdlKey,
  setSubdlKeyState,
  subdl,
  SUBDL_KEY_PAGE,
  subdlKey,
  subdlResting,
  subdlUsage,
} from '../../data/subdl';
import { pageCrypto, webCryptoWorks } from '../../platform/web-crypto';
import screen from '../Screen.module.css';
import { createSubdlChecks } from './subdl-checks';
import { type SubdlNotice, subdlStatus, subdlStatusKey } from './subdl-status';
import styles from './SubdlScreen.module.css';

const restWhy = () => subdlResting()?.why ?? null;

/**
 * Sending the key from the phone, where this TV can: it needs the pairing
 * relay, and Web Crypto that passes its self-test to open what the phone
 * sealed. Elsewhere the screen shows the code that opens SubDL's API page, as
 * it always has.
 */
function createPhoneLink(): PhoneKeyLink | null {
  if (!PAIR_SERVICE) return null;
  const crypto = pageCrypto();
  if (!crypto) return null;
  return createPhoneKeyLink(
    createPairing({ service: PAIR_SERVICE, kind: 'subdl-key' }),
    crypto,
    webCryptoWorks,
  );
}

const createChecks = () =>
  createSubdlChecks({
    checkKey: (key) => subdl.checkKey(key),
    save: saveSubdlKey,
    saved: () => subdlKey.get()?.key,
    setState: setSubdlKeyState,
    remove: removeSubdlKey,
  });

const OFF: PhoneKeyState = { status: 'off' };
const noPhone = () => OFF;
const noChanges = () => () => undefined;

/**
 * Settings > SubDL subtitles: the profile's own free SubDL key, typed here or
 * sent from the phone. The field always starts empty and is emptied once the
 * key is saved, so the key is never shown; one check runs at a time.
 */
export function SubdlScreen() {
  const { t } = useTranslation();
  const record = useSyncExternalStore(subdlKey.subscribe, subdlKey.get);
  const rest = useSyncExternalStore(subdlUsage.subscribe, restWhy);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<SubdlNotice | null>(null);
  const [checks] = useState(createChecks);
  const [link] = useState(createPhoneLink);
  const phone = useSyncExternalStore(link ? link.subscribe : noChanges, link ? link.get : noPhone);
  useEffect(() => checks.onNotice(setNotice), [checks]);
  useScreenFocus('subdl-key');

  // The phone's session runs while the screen is open. A key still being opened
  // when it closes is saved all the same: the relay has already let it go.
  useEffect(() => {
    if (!link) return undefined;
    link.onKey((key) => (key === null ? checks.failed() : checks.receive(key)));
    link.start();
    return () => link.stop();
  }, [link, checks]);

  const save = () => {
    if (checks.save(text) === 'saved') setText('');
  };

  const retry = () => {
    void setFocus('subdl-key');
    link?.start();
  };

  const status = subdlStatus(notice, record?.state ?? null, rest);

  let side;
  if (!link || phone.status === 'off') {
    side = (
      <section className={styles.side}>
        <p className={styles.help}>{t('subdl.getKey')}</p>
        <div className={styles.qrBox} data-testid="subdl-page-qr">
          <QrCode className={styles.qr} text={SUBDL_KEY_PAGE} size={200} />
        </div>
      </section>
    );
  } else {
    let body;
    if (phone.status === 'waiting') {
      body = (
        <>
          <div className={styles.qrBox} data-testid="subdl-phone-qr">
            <QrCode className={styles.qr} text={phone.qrText} size={240} />
          </div>
          <p className={styles.phoneHelp}>{t('subdl.phone.scan')}</p>
          <p className={styles.host}>{phone.host}</p>
        </>
      );
    } else if (phone.status === 'opening') {
      body = <p className={styles.placeholder}>{t('subdl.phone.opening')}</p>;
    } else {
      const expired = phone.status === 'expired';
      body = (
        <>
          <p className={styles.placeholder}>
            {expired ? t('subdl.phone.expired') : t('subdl.phone.unavailable')}
          </p>
          <Button
            focusKey="subdl-phone-retry"
            label={expired ? t('subdl.phone.newCode') : t('subdl.phone.retry')}
            onPress={retry}
          />
        </>
      );
    }
    side = (
      <section className={styles.side}>
        <h2 className={styles.phoneTitle}>{t('subdl.phone.title')}</h2>
        {body}
      </section>
    );
  }

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('subdl.title')}</h1>
      <p className={screen.lead}>{t('subdl.lead')}</p>
      <div className={styles.body}>
        <div className={`${screen.column} ${styles.actions}`}>
          {record && <p className={styles.note}>{t('subdl.saved')}</p>}
          <TextField
            focusKey="subdl-key"
            label={t('subdl.key')}
            placeholder={t('subdl.placeholder')}
            value={text}
            type="text"
            onChange={setText}
            onSubmit={save}
          />
          <Button
            block
            variant="primary"
            focusKey="subdl-save"
            label={t('subdl.save')}
            onPress={save}
          />
          {notice === 'unreachable' && record && (
            <Button
              block
              focusKey="subdl-check-again"
              label={t('subdl.checkAgain')}
              onPress={() => checks.checkAgain()}
            />
          )}
          <p className={styles.status} aria-live="polite" data-testid="subdl-status">
            {status ? t(subdlStatusKey(status)) : ''}
          </p>
          {record && (
            <Button
              block
              focusKey="subdl-remove"
              label={t('subdl.remove')}
              onPress={() => {
                checks.remove();
                void setFocus('subdl-key');
              }}
            />
          )}
          <p className={styles.note}>{t('subdl.private')}</p>
        </div>
        {side}
      </div>
    </div>
  );
}
