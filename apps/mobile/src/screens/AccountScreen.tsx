import {
  formatAccountCode,
  MAIN_PROFILE_ID,
  readAccountCode,
  SyncSetupError,
  type JoinMode,
} from '@bannertv/core';
import { pinGuard, profiles } from '@tv/data/profiles';
import {
  accountCode,
  accountSection,
  accountState,
  deleteAccount,
  hasOwnData,
  joinAccount,
  leaveAccount,
  openAccount,
  previewAccount,
  syncAccountNow,
  type AccountProfile,
} from '@tv/data/sync';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { bringTotal, joinPlan, statusLine } from '../data/account-text';
import { goBack } from '../nav/routes';
import { reportTyping } from '../runtime/whereabouts';
import { Button } from '../ui/Button';
import { PinPad } from '../ui/PinPad';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, radius, space, type } from '../ui/theme';

const STATUS_TICK_MS = 30_000;
const CODE_INPUT_MAX = 40;

type Step =
  | { kind: 'menu' }
  | { kind: 'busy'; text: string; held: boolean }
  | { kind: 'join' }
  | { kind: 'choose'; code: string; account: AccountProfile[] }
  | { kind: 'show'; code: string };

type Guarded = 'show' | 'delete';

function problemOf(error: unknown): string {
  return error instanceof SyncSetupError ? error.problem : 'failed';
}

function confirm(title: string, message: string, action: string, run: () => void, cancel: string) {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel' },
    { text: action, style: 'destructive', onPress: run },
  ]);
}

/**
 * The BannerTV account on this phone (ADR 0006), for Main only. The first phone build joins an
 * account and keeps it in sync; making one stays on the TV for now. Showing the code and
 * deleting the account ask for Main's PIN, as on the TV.
 */
export function AccountScreen({ startOnJoin = false }: { startOnJoin?: boolean }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(accountState.subscribe, accountState.get);
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  const [step, setStep] = useState<Step>({ kind: startOnJoin ? 'join' : 'menu' });
  const [note, setNote] = useState<string | undefined>();
  const [typed, setTyped] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [guarding, setGuarding] = useState<Guarded | null>(null);
  const [pinMessage, setPinMessage] = useState<string | undefined>();
  const action = useRef(0);

  useEffect(() => openAccount(), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    // Leaving the screen drops the answer of anything still running.
    const counter = action;
    return () => {
      clearInterval(timer);
      counter.current++;
    };
  }, []);

  const toMenu = useCallback((message?: string) => {
    action.current++;
    setStep({ kind: 'menu' });
    setNote(message);
  }, []);

  // Back leaves a step for the menu, except while something that must finish is running.
  const held = step.kind === 'busy' && step.held;
  const back = useCallback(() => {
    if (held) return;
    if (step.kind === 'menu') goBack();
    else toMenu();
  }, [held, step.kind, toMenu]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [back]);

  /** Runs `work`, then `done` with its answer, unless the person has moved on meanwhile. */
  const run = <T,>(
    text: string,
    holdIt: boolean,
    work: () => Promise<T>,
    done: (value: T) => void,
    failed: (problem: string) => void,
  ) => {
    const mine = ++action.current;
    setNote(undefined);
    setStep({ kind: 'busy', text, held: holdIt });
    work().then(
      (value) => {
        if (action.current === mine) done(value);
      },
      (error: unknown) => {
        if (action.current === mine) failed(problemOf(error));
      },
    );
  };

  // Main's PIN guards showing the code and deleting the account.
  const main = profiles.get().profiles.find((profile) => profile.id === MAIN_PROFILE_ID);
  const lockedMessage = () =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(MAIN_PROFILE_ID) / 1000) });
  const guarded = (what: Guarded) => {
    if (!main?.pin) {
      proceed(what);
      return;
    }
    setPinMessage(pinGuard.waitMs(MAIN_PROFILE_ID) > 0 ? lockedMessage() : undefined);
    setGuarding(what);
  };
  const tryPin = (digits: string) => {
    if (!main || !guarding) return;
    const result = pinGuard.attempt(main, digits);
    if (result === 'ok') {
      const what = guarding;
      setGuarding(null);
      proceed(what);
    } else {
      setPinMessage(result === 'locked' ? lockedMessage() : t('pin.wrong'));
    }
  };
  const proceed = (what: Guarded) => {
    if (what === 'show') {
      const code = accountCode();
      if (code) setStep({ kind: 'show', code });
      return;
    }
    confirm(
      t('account.deleteTitle'),
      t('account.deleteMessage'),
      t('account.deleteConfirm'),
      () =>
        run(
          t('account.deleting'),
          true,
          deleteAccount,
          () => toMenu(t('account.deleted')),
          () => toMenu(t('account.deleteOffline')),
        ),
      t('common.cancel'),
    );
  };

  const leave = (ask: boolean) => {
    const go = () =>
      run(
        t('account.leave'),
        true,
        leaveAccount,
        () => toMenu(t('account.left')),
        () => toMenu(t('account.failed')),
      );
    if (!ask) {
      go();
      return;
    }
    confirm(
      t('account.leaveTitle'),
      t('account.leaveMessage'),
      t('account.leaveConfirm'),
      go,
      t('common.cancel'),
    );
  };

  const join = (code: string, mode: JoinMode) =>
    run(
      t('account.joining'),
      true,
      () => joinAccount(code, mode),
      // A join that worked starts the app again, so there is nothing to show.
      () => undefined,
      (problem) => {
        if (problem === 'offline') toMenu(t('account.joinOffline'));
        else if (problem === 'profiles' || problem === 'unknown' || problem === 'invalid') {
          setStep({ kind: 'join' });
          setNote(t(`account.${problem}`));
        } else toMenu(t('account.failed'));
      },
    );

  const checkCode = () => {
    const code = readAccountCode(typed);
    if (!code) {
      setNote(t('account.invalid'));
      return;
    }
    run(
      t('account.checking'),
      false,
      async () => {
        const preview = await previewAccount(code);
        const own = preview.result === 'ok' ? await hasOwnData() : false;
        return { preview, own };
      },
      ({ preview, own }) => {
        if (preview.result !== 'ok') {
          setStep({ kind: 'join' });
          setNote(t(`account.${preview.result}`));
        } else if (!own) {
          join(code, 'use');
        } else {
          setStep({ kind: 'choose', code, account: preview.profiles });
        }
      },
      () => {
        setStep({ kind: 'join' });
        setNote(t('account.offline'));
      },
    );
  };

  const body = () => {
    if (state.engine === 'starting') return <Text style={styles.lead}>{t('account.loading')}</Text>;
    if (state.engine === 'broken') return <Text style={styles.lead}>{t('account.broken')}</Text>;

    if (step.kind === 'busy') {
      return (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.lead}>{step.text}</Text>
        </View>
      );
    }

    if (step.kind === 'join') {
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('phone.accountJoinLead')}</Text>
          <TextInput
            value={typed}
            onChangeText={(text) => setTyped(text.slice(0, CODE_INPUT_MAX))}
            placeholder={t('account.codePlaceholder')}
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={CODE_INPUT_MAX}
            style={styles.input}
            onFocus={() => reportTyping(true)}
            onBlur={() => reportTyping(false)}
            onSubmitEditing={checkCode}
            returnKeyType="go"
            accessibilityLabel={t('account.codeLabel')}
          />
          <Button label={t('account.continue')} kind="primary" onPress={checkCode} />
          <Button label={t('common.cancel')} kind="quiet" onPress={() => toMenu()} />
        </View>
      );
    }

    if (step.kind === 'choose') {
      const here = profiles.get().profiles.map(({ id, name }) => ({ id, name }));
      const { total, tooMany } = bringTotal(here, step.account);
      return (
        <View style={styles.group}>
          <Text style={styles.heading}>{t('account.chooseTitle')}</Text>
          <Text style={styles.lead}>{t('account.chooseLead')}</Text>
          <View style={styles.card}>
            {tooMany ? (
              <Text style={styles.lead}>
                {t('account.bringFull', {
                  account: step.account.length,
                  more: total - step.account.length,
                })}
              </Text>
            ) : (
              <>
                {joinPlan(t, 'bring', here, step.account).map((line) => (
                  <Text key={line} style={styles.plan}>
                    {line}
                  </Text>
                ))}
                <Text style={styles.small}>{t('account.bringHelp')}</Text>
                <Button
                  label={t('account.bring')}
                  kind="primary"
                  onPress={() => join(step.code, 'bring')}
                />
              </>
            )}
          </View>
          <View style={styles.card}>
            {joinPlan(t, 'use', here, step.account).map((line) => (
              <Text key={line} style={styles.plan}>
                {line}
              </Text>
            ))}
            <Text style={styles.small}>{t('account.useHelp')}</Text>
            <Button
              label={t('account.use')}
              onPress={() =>
                confirm(
                  t('account.useTitle'),
                  t('account.useMessage'),
                  t('account.use'),
                  () => join(step.code, 'use'),
                  t('common.cancel'),
                )
              }
            />
          </View>
          <Button label={t('common.cancel')} kind="quiet" onPress={() => toMenu()} />
        </View>
      );
    }

    if (step.kind === 'show') {
      return (
        <View style={styles.group}>
          <Text style={styles.code} selectable accessibilityLabel={step.code.split('').join(' ')}>
            {formatAccountCode(step.code)}
          </Text>
          <Text style={styles.lead}>{t('account.showCodeHelp')}</Text>
          <Button label={t('account.hideCode')} onPress={() => toMenu()} />
        </View>
      );
    }

    // The menu, by where the account is.
    const status = state.status;
    if (status.state === 'off') {
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('phone.accountLead')}</Text>
          <Text style={styles.small}>{t('account.private')}</Text>
          <Button
            label={t('account.join')}
            kind="primary"
            onPress={() => {
              setTyped('');
              setNote(undefined);
              setStep({ kind: 'join' });
            }}
          />
          <Text style={styles.small}>
            {section.canCreate ? t('phone.accountCreateOnTv') : t('account.closed')}
          </Text>
        </View>
      );
    }
    if (status.state === 'setup') {
      if (state.setup === 'joining') {
        return (
          <View style={styles.group}>
            <Text style={styles.lead}>{t('account.setupJoining')}</Text>
            <Button
              label={t('account.tryNow')}
              kind="primary"
              onPress={() => {
                const code = accountCode();
                if (code) join(code, state.mode ?? 'bring');
              }}
            />
            <Button label={t('account.leave')} kind="danger" onPress={() => leave(true)} />
          </View>
        );
      }
      // Made on this phone's data before an earlier build, or mid-way on another screen.
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>
            {state.setup === 'confirmed' ? t('account.setupConfirmed') : t('account.setupCreating')}
          </Text>
          <Button label={t('account.tryNow')} onPress={() => void syncAccountNow()} />
        </View>
      );
    }
    if (status.state === 'gone') {
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('account.gone')}</Text>
          <Button label={t('account.leaveConfirm')} onPress={() => leave(false)} />
        </View>
      );
    }
    return (
      <View style={styles.group}>
        <View style={styles.status}>
          {status.state === 'syncing' ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : null}
          <Text style={styles.statusText}>{statusLine(t, status, now)}</Text>
        </View>
        <Button
          label={t('account.syncNow')}
          kind="primary"
          icon="cloud"
          onPress={() => void syncAccountNow()}
        />
        <Button label={t('account.showCode')} icon="lock" onPress={() => guarded('show')} />
        <Button label={t('account.leave')} onPress={() => leave(true)} />
        <Button label={t('account.delete')} kind="danger" onPress={() => guarded('delete')} />
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('account.title')} onBack={back} />
      <KeyboardAvoidingView behavior="height" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {body()}
        </ScrollView>
      </KeyboardAvoidingView>
      <PinPad
        visible={guarding !== null}
        title={main ? t('pin.enterFor', { name: main.name }) : ''}
        {...(pinMessage ? { message: pinMessage } : {})}
        onPin={tryPin}
        onCancel={() => setGuarding(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl * 2 },
  group: { gap: space.m },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.l },
  heading: { ...type.heading, color: colors.text },
  lead: { ...type.body, color: colors.textMuted },
  small: { ...type.small, color: colors.textSubtle },
  note: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    padding: space.m,
  },
  input: {
    ...type.heading,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    letterSpacing: 2,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.s,
  },
  plan: { ...type.body, color: colors.text },
  code: {
    ...type.display,
    color: colors.prismTop,
    textAlign: 'center',
    letterSpacing: 2,
    paddingVertical: space.l,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  statusText: { ...type.body, color: colors.text },
});
