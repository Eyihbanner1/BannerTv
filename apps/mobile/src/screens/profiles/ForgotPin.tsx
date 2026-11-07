import { MAIN_PROFILE_ID, type Profile } from '@bannertv/core';
import { pinGuard, profiles } from '@tv/data/profiles';
import {
  accountCodeHere,
  clearForgottenPin,
  isAccountCode,
  type PinRecovery,
  pinRecovery,
  resetThisScreen,
} from '@tv/data/profiles-recovery';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { reportTyping } from '../../runtime/whereabouts';
import { Button } from '../../ui/Button';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { PinPad } from '../../ui/PinPad';
import { Sheet } from '../../ui/Sheet';
import { colors, radius, space, type } from '../../ui/theme';

const CODE_INPUT_MAX = 40;

/**
 * "Forgot PIN?" on a PIN pad, as on the TV (apps/webos ForgotPin): asks for what proves it is
 * the owner and takes the PIN off, or, for Main on a phone with no account, offers to reset
 * BannerTV here. The rules are in data/profiles-recovery.ts.
 */
export function ForgotPin({
  profile,
  onCleared,
  onClose,
}: {
  profile: Profile;
  /** The PIN is off: the caller carries on as if it had been entered. */
  onCleared: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Only Main's own PIN depends on the account, which takes a read to find out.
  const isMain = profile.id === MAIN_PROFILE_ID;
  const [inAccount, setInAccount] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | undefined>();
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

  const list = profiles.get().profiles;
  const how: PinRecovery | null =
    isMain && inAccount === null ? null : pinRecovery(profile, list, inAccount === true);
  const main = list.filter((p) => p.id === MAIN_PROFILE_ID)[0];
  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });
  const mainMessage =
    message ?? (main && pinGuard.waitMs(main.id) > 0 ? lockedMessage(main.id) : undefined);
  const clear = () => {
    clearForgottenPin(profile.id);
    onCleared();
  };
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
    <>
      <PinPad
        visible={how === 'main-pin' && !!main}
        title={main ? t('forgotPin.mainPinTitle', { main: main.name, name: profile.name }) : ''}
        {...(mainMessage ? { message: mainMessage } : {})}
        onPin={(digits) => {
          if (!main) return;
          const result = pinGuard.attempt(main, digits);
          if (result === 'ok') clear();
          else setMessage(result === 'locked' ? lockedMessage(main.id) : t('pin.wrong'));
        }}
        onCancel={onClose}
      />
      <ConfirmSheet
        visible={how === 'warn'}
        title={t('forgotPin.warnTitle', { name: profile.name })}
        message={t('forgotPin.warnMessage', { main: main?.name ?? '' })}
        confirmLabel={t('forgotPin.takeOff')}
        cancelLabel={t('common.cancel')}
        onConfirm={clear}
        onCancel={onClose}
      />
      <ConfirmSheet
        visible={how === 'reset'}
        title={t('forgotPin.resetTitle')}
        message={t('forgotPin.resetMessage', { name: profile.name })}
        confirmLabel={resetting ? t('forgotPin.resetting') : t('forgotPin.reset')}
        cancelLabel={t('common.cancel')}
        danger
        busy={resetting}
        onConfirm={() => {
          if (resetting) return;
          setResetting(true);
          void resetThisScreen();
        }}
        onCancel={onClose}
      />
      <Sheet
        visible={how === 'account-code'}
        title={t('forgotPin.codeTitle', { name: profile.name })}
        onClose={onClose}
      >
        <View style={styles.box}>
          <Text style={styles.help}>{t('forgotPin.codeHelp')}</Text>
          <TextInput
            value={typed}
            onChangeText={(text) => {
              setMessage(undefined);
              setTyped(text.slice(0, CODE_INPUT_MAX));
            }}
            placeholder={t('account.codePlaceholder')}
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={CODE_INPUT_MAX}
            style={styles.input}
            onFocus={() => reportTyping(true)}
            onBlur={() => reportTyping(false)}
            onSubmitEditing={check}
            returnKeyType="go"
            accessibilityLabel={t('account.codeLabel')}
          />
          {message ? (
            <Text style={styles.message} accessibilityRole="alert">
              {message}
            </Text>
          ) : null}
          <Button
            label={checking ? t('forgotPin.checking') : t('forgotPin.takeOff')}
            kind="primary"
            busy={checking}
            onPress={check}
          />
          <Button label={t('common.cancel')} kind="quiet" onPress={onClose} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.m, padding: space.l },
  help: { ...type.body, color: colors.textSoft },
  message: { ...type.body, color: colors.danger },
  input: {
    ...type.heading,
    color: colors.text,
    backgroundColor: colors.surface3,
    borderRadius: radius.m,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    letterSpacing: 2,
  },
});
