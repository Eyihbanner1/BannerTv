import { MAIN_PROFILE_ID, type Profile } from '@bannertv/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Overlay } from '../../components/Overlay';
import { PinPad } from '../../components/PinPad';
import { TextField } from '../../components/TextField';
import { pinGuard, profiles } from '../../data/profiles';
import {
  accountCodeHere,
  clearForgottenPin,
  isAccountCode,
  type PinRecovery,
  pinRecovery,
  resetThisScreen,
} from '../../data/profiles-recovery';
import styles from './ForgotPin.module.css';

interface ForgotPinProps {
  /** The profile whose PIN was forgotten. */
  profile: Profile;
  /** Where focus goes when it closes. */
  returnFocusKey: string | (() => string);
  /** The PIN is off: the caller carries on as if it had been entered. */
  onCleared: () => void;
  onClose: () => void;
}

/**
 * "Forgot PIN?" on a PIN pad: asks for what proves it is the owner (see
 * data/profiles-recovery.ts) and takes the PIN off, or, for Main on a TV
 * with no account, offers to reset BannerTV here.
 */
export function ForgotPin({ profile, returnFocusKey, onCleared, onClose }: ForgotPinProps) {
  const { t } = useTranslation();
  // Only Main's own PIN depends on the account, which takes a read to find out.
  const isMain = profile.id === MAIN_PROFILE_ID;
  const [inAccount, setInAccount] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!isMain) return;
    let live = true;
    void accountCodeHere().then((found) => {
      if (live) setInAccount(found);
    });
    return () => {
      live = false;
    };
  }, [isMain]);

  const how: PinRecovery | null =
    isMain && inAccount === null
      ? null
      : pinRecovery(profile, profiles.get().profiles, inAccount === true);

  const main = profiles.get().profiles.filter((p) => p.id === MAIN_PROFILE_ID)[0];
  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });
  const clear = () => {
    clearForgottenPin(profile.id);
    onCleared();
  };

  if (how === 'main-pin' && main) {
    return (
      <PinPad
        focusKey="forgot-pin-main"
        title={t('forgotPin.mainPinTitle', { main: main.name, name: profile.name })}
        message={message ?? (pinGuard.waitMs(main.id) > 0 ? lockedMessage(main.id) : undefined)}
        returnFocusKey={returnFocusKey}
        onPin={(digits) => {
          const result = pinGuard.attempt(main, digits);
          if (result === 'ok') clear();
          else setMessage(result === 'locked' ? lockedMessage(main.id) : t('pin.wrong'));
        }}
        onClose={onClose}
      />
    );
  }
  if (how === 'warn') {
    return (
      <ConfirmDialog
        focusKey="forgot-pin-warn"
        title={t('forgotPin.warnTitle', { name: profile.name })}
        message={t('forgotPin.warnMessage', { main: main?.name ?? '' })}
        confirmLabel={t('forgotPin.takeOff')}
        cancelLabel={t('common.cancel')}
        returnFocusKey={returnFocusKey}
        onConfirm={clear}
        onCancel={onClose}
      />
    );
  }
  if (how === 'reset') {
    return (
      <ConfirmDialog
        focusKey="forgot-pin-reset"
        title={t('forgotPin.resetTitle')}
        message={t('forgotPin.resetMessage', { name: profile.name })}
        confirmLabel={resetting ? t('forgotPin.resetting') : t('forgotPin.reset')}
        cancelLabel={t('common.cancel')}
        returnFocusKey={returnFocusKey}
        onConfirm={() => {
          if (resetting) return;
          setResetting(true);
          void resetThisScreen();
        }}
        onCancel={onClose}
      />
    );
  }
  if (how === 'account-code') {
    const check = () => {
      if (checking) return;
      setChecking(true);
      void isAccountCode(typed).then((right) => {
        setChecking(false);
        if (right) clear();
        else setMessage(t('forgotPin.wrongCode'));
      });
    };
    return (
      <Overlay
        focusKey="forgot-pin-code"
        label={t('forgotPin.codeTitle', { name: profile.name })}
        defaultFocusKey="forgot-pin-code-field"
        returnFocusKey={returnFocusKey}
        onClose={onClose}
        placement="center"
      >
        <h2 className={styles.title}>{t('forgotPin.codeTitle', { name: profile.name })}</h2>
        <p className={styles.help}>{t('forgotPin.codeHelp')}</p>
        <TextField
          focusKey="forgot-pin-code-field"
          label={t('account.codeLabel')}
          placeholder={t('account.codePlaceholder')}
          value={typed}
          onChange={(value) => {
            setMessage(undefined);
            setTyped(value.slice(0, 40));
          }}
          onSubmit={check}
        />
        <p className={styles.message} role="status">
          {message ?? ''}
        </p>
        <div className={styles.actions}>
          <Button
            variant="primary"
            focusKey="forgot-pin-code-check"
            label={checking ? t('forgotPin.checking') : t('forgotPin.takeOff')}
            onPress={check}
          />
          <Button focusKey="forgot-pin-code-cancel" label={t('common.cancel')} onPress={onClose} />
        </div>
      </Overlay>
    );
  }
  return null;
}
