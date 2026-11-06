import {
  type AsideCopy,
  formatAccountCode,
  MAIN_PROFILE_ID,
  readAccountCode,
  SyncSetupError,
  type JoinMode,
} from '@bannertv/core';
import { asideDate, asideLines, asideRestarts } from '@tv/data/account-aside';
import { pinGuard, profiles } from '@tv/data/profiles';
import {
  accountCode,
  accountSection,
  accountState,
  asideCopy,
  bringBackAside,
  checkAsideCopy,
  confirmAccount,
  createAccount,
  deleteAccount,
  hasOwnData,
  joinAccount,
  leaveAccount,
  openAccount,
  previewAccount,
  syncAccountNow,
  type AccountProfile,
} from '@tv/data/sync';
import * as Clipboard from 'expo-clipboard';
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
import { bringTotal, joinPlan, matchesLastFour, statusLine } from '../data/account-text';
import { goBack } from '../nav/routes';
import { reportTyping } from '../runtime/whereabouts';
import { Button } from '../ui/Button';
import { PinPad } from '../ui/PinPad';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, radius, space, type } from '../ui/theme';

const STATUS_TICK_MS = 30_000;
const CODE_INPUT_MAX = 40;
const CHECK_INPUT_MAX = 8;
const KEY_INPUT_MAX = 256;

type Step =
  | { kind: 'menu' }
  /** `held`: Back waits for it, as a create, a confirm, a join, a leave or a delete must finish. */
  | { kind: 'busy'; text: string; held: boolean }
  /** The service's setup key, typed before a new account is made. */
  | { kind: 'key' }
  /** The new account's code, to write down. */
  | { kind: 'code'; code: string }
  /** Its last four characters typed back, so the person knows they have it. */
  | { kind: 'check'; code: string }
  | { kind: 'join' }
  | { kind: 'choose'; code: string; account: AccountProfile[] }
  | { kind: 'show'; code: string };

/** What Main's PIN is asked for first. */
type Guarded = 'create' | 'show' | 'delete';

function problemOf(error: unknown): string {
  return error instanceof SyncSetupError ? error.problem : 'failed';
}

function confirm(
  title: string,
  message: string,
  action: string,
  run: () => void,
  cancel: string,
  destructive = true,
) {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: run },
  ]);
}

/**
 * The BannerTV account on this phone (ADR 0006), for Main only, with the TV's steps. Signed out
 * it makes an account (its code shown to write down or copy, then its last four characters
 * typed back) or joins one by its code; signed in it syncs, shows the code, leaves and deletes.
 * Making the account, showing the code and deleting it ask for Main's PIN, and a service that
 * needs its setup key asks for it first. While the copy a join with Use kept lasts, the menu
 * says what it holds and offers to bring it back.
 */
export function AccountScreen({ startOnJoin = false }: { startOnJoin?: boolean }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(accountState.subscribe, accountState.get);
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  const copy = useSyncExternalStore(asideCopy.subscribe, asideCopy.get);
  const [step, setStep] = useState<Step>({ kind: startOnJoin ? 'join' : 'menu' });
  const [note, setNote] = useState<string | undefined>();
  const [typed, setTyped] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [guarding, setGuarding] = useState<Guarded | null>(null);
  const [pinMessage, setPinMessage] = useState<string | undefined>();
  const action = useRef(0);

  useEffect(() => {
    openAccount();
    checkAsideCopy();
  }, []);
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

  // Main's PIN guards making the account, showing the code and deleting the account.
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
    if (what === 'create') {
      // A new account on a service that needs its setup key asks for it first. One carried on
      // sends the key it was given before.
      if (section.needsKey && state.engine === 'running' && state.status.state === 'off') {
        setTyped('');
        setNote(undefined);
        setStep({ kind: 'key' });
      } else startCreate();
      return;
    }
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

  /** Makes the account, or carries on making it; `key` is the service's setup key, when typed. */
  const startCreate = (key?: string) =>
    run(
      t('account.creating'),
      true,
      () => createAccount(key),
      (code) => {
        setTyped('');
        setStep({ kind: 'code', code });
      },
      (problem) => {
        if (problem === 'key') {
          // The service needs its setup key: asked for, or asked for again.
          setStep({ kind: 'key' });
          if (key !== undefined) setNote(t('account.key'));
        } else if (problem === 'closed') {
          // createAccount has kept the answer, so the menu says so and offers only Join.
          toMenu();
        } else {
          toMenu(
            problem === 'exists' || problem === 'offline'
              ? t(`account.${problem}`)
              : t('account.failed'),
          );
        }
      },
    );

  const sendKey = () => {
    if (typed.trim() === '') {
      setNote(t('account.keyMissing'));
      return;
    }
    startCreate(typed);
  };

  // Nothing of the phone's is sent until the code is typed back.
  const check = (code: string) => {
    if (!matchesLastFour(typed, code)) {
      setNote(t('account.checkWrong'));
      return;
    }
    run(
      t('account.sending'),
      true,
      confirmAccount,
      () => toMenu(t('account.created')),
      () => toMenu(t('account.offline')),
    );
  };

  /** Brings back what Use set aside, after asking. When profiles come back, the app starts again. */
  const bringBack = (signedIn: boolean, kept: AsideCopy) => {
    const message = [t(signedIn ? 'account.aside.intoAccount' : 'account.aside.onScreen')];
    if (asideRestarts(kept, profiles.get().profiles)) message.push(t('account.aside.restarts'));
    const go = () =>
      run(
        t('account.aside.bringing'),
        true,
        bringBackAside,
        () => toMenu(t('account.aside.done')),
        (problem) => {
          if (problem === 'profiles' || problem === 'none') toMenu(t(`account.aside.${problem}`));
          else toMenu(problem === 'offline' ? t('account.offline') : t('account.failed'));
        },
      );
    confirm(
      t('account.aside.confirmTitle'),
      message.join(' '),
      t('account.aside.confirm'),
      go,
      t('common.cancel'),
      false,
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

    if (step.kind === 'key') {
      return (
        <View style={styles.group}>
          <Text style={styles.heading}>{t('account.keyTitle')}</Text>
          <Text style={styles.lead}>{t('account.keyHelp')}</Text>
          <Field
            label={t('account.keyLabel')}
            placeholder={t('account.keyPlaceholder')}
            value={typed}
            maxLength={KEY_INPUT_MAX}
            capitals="none"
            onChange={(text) => {
              setNote(undefined);
              setTyped(text);
            }}
            onSubmit={sendKey}
          />
          <Button label={t('account.continue')} kind="primary" onPress={sendKey} />
          <Button label={t('common.cancel')} kind="quiet" onPress={() => toMenu()} />
        </View>
      );
    }

    if (step.kind === 'code') {
      const { code } = step;
      return (
        <View style={styles.group}>
          <CodePanel code={code} help={t('account.codeHelp')} />
          <Button
            label={t('account.codeSaved')}
            kind="primary"
            onPress={() => {
              setTyped('');
              setNote(undefined);
              setStep({ kind: 'check', code });
            }}
          />
        </View>
      );
    }

    if (step.kind === 'check') {
      const { code } = step;
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('account.checkHelp')}</Text>
          <Field
            label={t('account.checkLabel')}
            placeholder={t('account.checkPlaceholder')}
            value={typed}
            maxLength={CHECK_INPUT_MAX}
            capitals="characters"
            onChange={(text) => {
              setNote(undefined);
              setTyped(text);
            }}
            onSubmit={() => check(code)}
          />
          <Button label={t('account.check')} kind="primary" onPress={() => check(code)} />
          <Button
            label={t('account.showAgain')}
            onPress={() => {
              setNote(undefined);
              setStep({ kind: 'code', code });
            }}
          />
        </View>
      );
    }

    if (step.kind === 'join') {
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('phone.accountJoinLead')}</Text>
          <Field
            label={t('account.codeLabel')}
            placeholder={t('account.codePlaceholder')}
            value={typed}
            maxLength={CODE_INPUT_MAX}
            capitals="characters"
            onChange={setTyped}
            onSubmit={checkCode}
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
          <CodePanel code={step.code} help={t('account.showCodeHelp')} />
          <Button label={t('account.hideCode')} onPress={() => toMenu()} />
        </View>
      );
    }

    // What the copy a join with Use kept holds, while it lasts.
    const aside = (signedIn: boolean) =>
      copy ? <AsideCard copy={copy} onBring={() => bringBack(signedIn, copy)} /> : null;

    // The menu, by where the account is.
    const status = state.status;
    if (status.state === 'off') {
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('phone.accountLead')}</Text>
          <Text style={styles.small}>{t('account.private')}</Text>
          {section.canCreate ? (
            <Button label={t('account.create')} kind="primary" onPress={() => guarded('create')} />
          ) : (
            <Text style={styles.lead}>{t('account.closed')}</Text>
          )}
          <Button
            label={t('account.join')}
            kind={section.canCreate ? 'secondary' : 'primary'}
            onPress={() => {
              setTyped('');
              setNote(undefined);
              setStep({ kind: 'join' });
            }}
          />
          {aside(false)}
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
      if (state.setup === 'creating') {
        // Made, but the code was never typed back: shown again behind Main's PIN, or given up.
        return (
          <View style={styles.group}>
            <Text style={styles.lead}>{t('account.setupCreating')}</Text>
            <Button
              label={t('account.setupShow')}
              kind="primary"
              onPress={() => guarded('create')}
            />
            <Button
              label={t('account.setupCancel')}
              onPress={() =>
                run(
                  t('account.deleting'),
                  true,
                  deleteAccount,
                  () => toMenu(),
                  () => toMenu(t('account.deleteOffline')),
                )
              }
            />
          </View>
        );
      }
      // The code was typed back, and the phone's data is still on its way.
      return (
        <View style={styles.group}>
          <Text style={styles.lead}>{t('account.setupConfirmed')}</Text>
          <Button
            label={t('account.tryNow')}
            kind="primary"
            onPress={() => void syncAccountNow()}
          />
          <Button label={t('account.delete')} kind="danger" onPress={() => guarded('delete')} />
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
        {aside(true)}
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

/** A text box for a code or a key, which tells the app that the keyboard is up. */
function Field({
  label,
  placeholder,
  value,
  maxLength,
  capitals,
  onChange,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  value: string;
  maxLength: number;
  capitals: 'characters' | 'none';
  onChange: (text: string) => void;
  onSubmit: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChange(text.slice(0, maxLength))}
      placeholder={placeholder}
      placeholderTextColor={colors.textSubtle}
      autoCapitalize={capitals}
      autoCorrect={false}
      autoFocus
      maxLength={maxLength}
      style={styles.input}
      onFocus={() => reportTyping(true)}
      onBlur={() => reportTyping(false)}
      onSubmitEditing={onSubmit}
      returnKeyType="go"
      accessibilityLabel={label}
    />
  );
}

/** The account code, large, with what to do with it and a button that copies it. */
function CodePanel({ code, help }: { code: string; help: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<boolean | undefined>();
  const copyCode = () => {
    Clipboard.setStringAsync(code).then(
      (done) => setCopied(done),
      () => setCopied(false),
    );
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{t('account.codeTitle')}</Text>
      <Text
        style={styles.code}
        selectable
        testID="account-code"
        accessibilityLabel={code.split('').join(' ')}
      >
        {formatAccountCode(code)}
      </Text>
      <Text style={styles.lead}>{help}</Text>
      <Button label={t('phone.copyCode')} onPress={copyCode} />
      {copied === undefined ? null : (
        <Text style={styles.small}>{t(copied ? 'phone.codeCopied' : 'phone.codeNotCopied')}</Text>
      )}
    </View>
  );
}

/** What the copy a join with Use kept holds, until when, and the button that brings it back. */
function AsideCard({ copy, onBring }: { copy: AsideCopy; onBring: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.card} accessibilityLabel={t('account.aside.title')}>
      <Text style={styles.heading}>{t('account.aside.title')}</Text>
      <Text style={styles.lead}>{t('account.aside.lead', { date: asideDate(copy.until) })}</Text>
      {asideLines(t, copy).map((line) => (
        <Text key={line} style={styles.plan}>
          {line}
        </Text>
      ))}
      <Button label={t('account.aside.bring')} onPress={onBring} />
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
