import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { QrCode } from '../../components/QrCode';
import { TextField } from '../../components/TextField';
import {
  removeSubdlKey,
  saveSubdlKey,
  setSubdlKeyState,
  subdl,
  SUBDL_KEY_PAGE,
  subdlKey,
  subdlUsage,
} from '../../data/subdl';
import screen from '../Screen.module.css';
import { type SubdlNotice, subdlStatus } from './subdl-status';
import styles from './SubdlScreen.module.css';

/** "Check again" is offered at most this often. */
const CHECK_AGAIN_MS = 10_000;

const restWhy = () => subdlUsage.resting()?.why ?? null;

/**
 * Settings > SubDL subtitles: the profile's own free SubDL key. The field
 * always starts empty and is emptied once the key is saved, so the key is
 * never shown; one check runs at a time.
 */
export function SubdlScreen() {
  const { t } = useTranslation();
  const record = useSyncExternalStore(subdlKey.subscribe, subdlKey.get);
  const rest = useSyncExternalStore(subdlUsage.subscribe, restWhy);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<SubdlNotice | null>(null);
  const checking = useRef(false);
  const lastCheck = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useScreenFocus('subdl-key');

  const check = async (key: string) => {
    if (checking.current) return;
    checking.current = true;
    lastCheck.current = Date.now();
    setNotice('checking');
    const answer = await subdl.checkKey(key);
    checking.current = false;
    if (answer !== 'unreachable') setSubdlKeyState(key, answer);
    if (mounted.current) setNotice(answer);
  };

  const save = () => {
    if (checking.current) return;
    if (saveSubdlKey(text) === 'bad') {
      setNotice('badFormat');
      return;
    }
    setText('');
    const key = subdlKey.get()?.key;
    if (key) void check(key);
  };

  const checkAgain = () => {
    const key = subdlKey.get()?.key;
    if (!key || Date.now() - lastCheck.current < CHECK_AGAIN_MS) return;
    void check(key);
  };

  const status = subdlStatus(notice, record?.state ?? null, rest);

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('subdl.title')}</h1>
      <p className={screen.lead}>{t('subdl.lead')}</p>
      <section className={styles.getKey}>
        <p className={styles.help}>{t('subdl.getKey')}</p>
        <QrCode className={styles.qr} text={SUBDL_KEY_PAGE} size={200} />
      </section>
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
            onPress={checkAgain}
          />
        )}
        <p className={styles.status} aria-live="polite" data-testid="subdl-status">
          {status ? t(`subdl.${status}`) : ''}
        </p>
        {record && (
          <Button
            block
            focusKey="subdl-remove"
            label={t('subdl.remove')}
            onPress={() => {
              removeSubdlKey();
              setNotice('removed');
              void setFocus('subdl-key');
            }}
          />
        )}
        <p className={styles.note}>{t('subdl.private')}</p>
      </div>
    </div>
  );
}
