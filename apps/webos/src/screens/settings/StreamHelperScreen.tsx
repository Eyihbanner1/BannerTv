import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { streamHelper } from '../../data/helper';
import { createPairing, PAIR_SERVICE } from '../../data/pairing';
import { formatHelperAddress, type PairResult, readHelperOffer } from '../../data/stream-helper';
import {
  type AndroidHelperState,
  androidHelperState,
  isAndroid,
  sendHelperCommand,
} from '../../platform/android';
import screen from '../Screen.module.css';
import styles from './StreamHelperScreen.module.css';

/** How often the phone's screen reads the helper again: its code changes once a TV pairs. */
const POLL_MS = 2000;

/** On Android: run the helper, and show the address and code to type on the TV. */
function RunHelper() {
  const { t } = useTranslation();
  const [state, setState] = useState<AndroidHelperState | null>(androidHelperState);
  useEffect(() => {
    const timer = setInterval(() => setState(androidHelperState()), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  useScreenFocus('helper-switch');

  if (!state) {
    return <p className={styles.note}>{t('streamHelper.updateApp')}</p>;
  }
  const command = (name: 'start' | 'stop' | 'forget') => {
    sendHelperCommand(name);
    // The service starts or stops a moment later.
    setTimeout(() => setState(androidHelperState()), 500);
  };
  const address =
    state.address && state.port
      ? formatHelperAddress({ host: state.address, port: state.port })
      : null;

  return (
    <>
      <div className={`${screen.column} ${styles.actions}`}>
        <Button
          block
          variant="primary"
          focusKey="helper-switch"
          label={t(state.on ? 'streamHelper.turnOff' : 'streamHelper.turnOn')}
          onPress={() => command(state.on ? 'stop' : 'start')}
        />
        {state.paired > 0 && (
          <Button
            block
            focusKey="helper-forget"
            label={t('streamHelper.forget', { count: state.paired })}
            onPress={() => {
              command('forget');
              void setFocus('helper-switch');
            }}
          />
        )}
        <p className={styles.note}>
          {t(state.on ? 'streamHelper.onNote' : 'streamHelper.offNote')}
        </p>
      </div>
      {state.on && (
        <section className={styles.pairing} aria-live="polite">
          {address ? (
            <>
              <p className={styles.note}>{t('streamHelper.typeOnTv')}</p>
              <p className={styles.label}>{t('streamHelper.address')}</p>
              <p className={styles.value}>{address}</p>
              <p className={styles.label}>{t('streamHelper.code')}</p>
              <p className={styles.value}>{state.code}</p>
            </>
          ) : (
            <p className={styles.note}>{t('streamHelper.noWifi')}</p>
          )}
        </section>
      )}
    </>
  );
}

/** Spaced in threes, which is easier to read across a room. */
function spaced(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/**
 * "Pair from your phone": a short code for the pairing relay (services/pair).
 * The phone types it and sends its helper's address and code (helperOffer),
 * so nothing is typed with the remote. The TV then pairs as if they were typed.
 */
function PairFromPhone({ onOffer }: { onOffer: (link: string) => void }) {
  const { t } = useTranslation();
  const [pairing] = useState(() => createPairing({ service: PAIR_SERVICE }));
  const state = useSyncExternalStore(pairing.subscribe, pairing.get);
  useEffect(() => pairing.onAddress(onOffer), [pairing, onOffer]);
  useEffect(() => {
    pairing.start();
    return () => pairing.stop();
  }, [pairing]);

  let body;
  if (state.status === 'waiting') {
    body = (
      <>
        <p className={styles.note}>{t('streamHelper.fromPhoneSteps')}</p>
        <p className={styles.phoneCode}>{spaced(state.session.code)}</p>
      </>
    );
  } else if (state.status === 'opening') {
    body = <p className={styles.note}>{t('addons.phone.opening')}</p>;
  } else {
    const expired = state.status === 'expired';
    body = (
      <>
        <p className={styles.note}>
          {expired ? t('addons.phone.expired') : t('addons.phone.unavailable')}
        </p>
        <Button
          focusKey="helper-phone-retry"
          label={expired ? t('addons.phone.newCode') : t('addons.phone.retry')}
          onPress={() => pairing.start()}
        />
      </>
    );
  }
  return (
    <section className={styles.fromPhone} aria-live="polite">
      <h2 className={styles.heading}>{t('streamHelper.fromPhone')}</h2>
      {body}
    </section>
  );
}

/** On the LG: pair with a helper once, then see whether it answers. */
function PairWithHelper() {
  const { t } = useTranslation();
  const pairing = useSyncExternalStore(streamHelper.subscribe, streamHelper.get);
  const reachability = useSyncExternalStore(
    streamHelper.reachability.subscribe,
    streamHelper.reachability.get,
  );
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // A pairing the phone started and one typed here never run at once.
  const busyRef = useRef(false);
  const [result, setResult] = useState<PairResult | null>(null);
  const [fromPhone, setFromPhone] = useState<'pairing' | 'notOffer' | null>(null);

  useEffect(() => {
    void streamHelper.load().then(() => streamHelper.reachable(true));
  }, []);
  useScreenFocus(pairing ? 'helper-check' : 'helper-address');

  // Only setters and the module's helper store, so the relay's handler can keep it.
  const pairWith = useCallback((to: string, digits: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setResult(null);
    void streamHelper.pair(to, digits).then((answer) => {
      busyRef.current = false;
      setBusy(false);
      setResult(answer);
      setFromPhone(null);
      if (answer === 'paired') void setFocus('helper-check');
    });
  }, []);
  const pair = () => pairWith(address, code);
  const onOffer = useCallback(
    (link: string) => {
      const offer = readHelperOffer(link);
      if (!offer) {
        setFromPhone('notOffer');
        return;
      }
      setFromPhone('pairing');
      pairWith(offer.address, offer.code);
    },
    [pairWith],
  );

  if (pairing) {
    const status =
      reachability === 'on'
        ? t('streamHelper.reachable')
        : reachability === 'off'
          ? t('streamHelper.unreachable')
          : t('streamHelper.checking');
    return (
      <div className={`${screen.column} ${styles.actions}`}>
        <p className={styles.note}>
          {t('streamHelper.pairedWith', { address: formatHelperAddress(pairing) })}
        </p>
        <Button
          block
          variant="primary"
          focusKey="helper-check"
          label={t('streamHelper.checkAgain')}
          onPress={() => void streamHelper.reachable(true)}
        />
        <Button
          block
          focusKey="helper-unpair"
          label={t('streamHelper.unpair')}
          onPress={() => {
            void streamHelper.unpair().then(() => setFocus('helper-address'));
          }}
        />
        <p className={styles.note} role="status">
          {status}
        </p>
      </div>
    );
  }

  return (
    <div className={`${screen.column} ${styles.actions}`}>
      {PAIR_SERVICE ? <PairFromPhone onOffer={onOffer} /> : null}
      {fromPhone && (
        <p className={styles.note} role="status">
          {t(fromPhone === 'pairing' ? 'streamHelper.pairingFromPhone' : 'streamHelper.notOffer')}
        </p>
      )}
      {PAIR_SERVICE ? <h2 className={styles.heading}>{t('streamHelper.orType')}</h2> : null}
      <TextField
        focusKey="helper-address"
        label={t('streamHelper.address')}
        placeholder={t('streamHelper.addressPlaceholder')}
        value={address}
        onChange={setAddress}
        onSubmit={() => void setFocus('helper-code')}
      />
      <TextField
        focusKey="helper-code"
        label={t('streamHelper.code')}
        placeholder={t('streamHelper.codePlaceholder')}
        value={code}
        onChange={setCode}
        onSubmit={pair}
      />
      <Button
        block
        variant="primary"
        focusKey="helper-pair"
        label={t(busy ? 'streamHelper.pairing' : 'streamHelper.pair')}
        onPress={pair}
      />
      {result && result !== 'paired' && (
        <p className={styles.note} role="status">
          {t(`streamHelper.failed.${result}`)}
        </p>
      )}
    </div>
  );
}

/**
 * Settings > Stream helper. Some addon streams need request headers that the
 * LG's player can't send. BannerTV on an Android phone or box can fetch them
 * for the TV over Wi-Fi: on Android this screen runs that helper, and on the
 * LG it pairs with one.
 */
export function StreamHelperScreen() {
  const { t } = useTranslation();
  const android = isAndroid();
  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('streamHelper.title')}</h1>
      <p className={screen.lead}>
        {t(android ? 'streamHelper.leadAndroid' : 'streamHelper.leadTv')}
      </p>
      {android ? <RunHelper /> : <PairWithHelper />}
    </div>
  );
}
