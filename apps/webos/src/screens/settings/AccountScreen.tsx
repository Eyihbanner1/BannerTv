import {
  formatAccountCode,
  type JoinMode,
  MAIN_PROFILE_ID,
  MAX_PROFILES,
  readAccountCode,
  SyncSetupError,
  type SyncStatus,
} from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import type { TFunction } from 'i18next';
import {
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PinPad } from '../../components/PinPad';
import { TextField } from '../../components/TextField';
import { useBack } from '../../navigation/use-back';
import { asideDate, asideLines, asideRestarts } from '../../data/account-aside';
import { pinGuard, profiles } from '../../data/profiles';
import {
  accountCode,
  type AccountProfile,
  accountSection,
  type AccountState,
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
} from '../../data/sync';
import { syncOn } from '../../data/sync-clock';
import screen from '../Screen.module.css';
import styles from './AccountScreen.module.css';

/** One part of the screen at a time; the menu shows what the account's status allows. */
type Step =
  | { name: 'menu' }
  /**
   * `held`: Back waits for it to finish. A create, a confirm, a join, a
   * leave or a delete left half way would be offered again while it still
   * runs.
   */
  | { name: 'busy'; text: string; held: boolean }
  /** The service's setup key, typed before a new account is made. */
  | { name: 'key' }
  /** The new account's code, to write down. */
  | { name: 'code'; code: string }
  /** Its last four characters typed back, so the person knows they have it. */
  | { name: 'check'; code: string }
  /** Typing an account code to join. */
  | { name: 'join' }
  /** Bring or Use, for a screen with profiles of its own. */
  | { name: 'choose'; code: string; account: AccountProfile[] }
  /** Show account code, once signed in. */
  | { name: 'show'; code: string };

/** What Main's PIN is asked for first. */
type Guarded = 'create' | 'show' | 'delete';

type Dialog =
  | { kind: 'pin'; then: Guarded }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | { kind: 'use'; code: string }
  /** Bringing back what Use set aside: into the account, or onto this screen alone. */
  | { kind: 'back'; signedIn: boolean; restarts: boolean };

const MINUTE_MS = 60 * 1000;

/** This screen's clock, ticking every half minute for "In sync 2 minutes ago". */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function statusLine(t: TFunction, status: SyncStatus, now: number): string {
  if (status.state === 'syncing') return t('account.status.syncing');
  if (status.state === 'waiting') return t('account.status.waiting');
  if (status.state === 'paused') return t(`account.status.paused.${status.reason ?? 'offline'}`);
  if (status.lastSync === undefined) return t('account.status.idle');
  const minutes = Math.floor(Math.max(0, now - status.lastSync) / MINUTE_MS);
  if (minutes < 1) return t('account.status.justNow');
  if (minutes < 60) return t('account.status.minutes', { count: minutes });
  if (minutes < 24 * 60) return t('account.status.hours', { count: Math.floor(minutes / 60) });
  return t('account.status.days', { count: Math.floor(minutes / (24 * 60)) });
}

/** What happens to each profile, here and in the account, when joining one way or the other. */
export function joinPlan(
  t: TFunction,
  mode: JoinMode,
  here: readonly AccountProfile[],
  account: readonly AccountProfile[],
): string[] {
  const lines: string[] = [];
  for (const profile of here) {
    const there = account.filter((other) => other.id === profile.id)[0];
    if (mode === 'bring') {
      lines.push(
        there
          ? t('account.planJoins', { name: profile.name, other: there.name })
          : t('account.planAdded', { name: profile.name }),
      );
    } else {
      lines.push(
        there
          ? t('account.planReplaced', { name: profile.name, other: there.name })
          : t('account.planRemoved', { name: profile.name }),
      );
    }
  }
  for (const profile of account) {
    if (!here.some((other) => other.id === profile.id)) {
      lines.push(t('account.planArrives', { name: profile.name }));
    }
  }
  return lines;
}

/** How many profiles bringing this screen's would make. */
function profilesAfterBring(
  here: readonly AccountProfile[],
  account: readonly AccountProfile[],
): number {
  return account.length + here.filter((p) => !account.some((a) => a.id === p.id)).length;
}

function problemOf(error: unknown): string {
  return error instanceof SyncSetupError ? error.problem : 'failed';
}

/** Where focus goes when the screen shows `step` with the account as `state`. */
function focusFor(step: Step, state: AccountState, canCreate: boolean): string | undefined {
  switch (step.name) {
    case 'code':
      return 'account-code-saved';
    case 'check':
      return 'account-check-field';
    case 'join':
      return 'account-code-field';
    case 'key':
      return 'account-key-field';
    case 'choose':
      return 'account-use';
    case 'show':
      return 'account-hide-code';
    case 'busy':
      return undefined;
  }
  if (state.engine !== 'running') return undefined;
  switch (state.status.state) {
    case 'off':
      return canCreate ? 'account-create' : 'account-join';
    case 'setup':
      return state.setup === 'creating' ? 'account-setup-show' : 'account-try';
    case 'gone':
      return 'account-leave';
    default:
      return 'account-sync';
  }
}

/** Names the view, so focus moves only when the buttons on show change. */
function viewOf(step: Step, state: AccountState): string {
  if (step.name !== 'menu') return step.name;
  if (state.engine !== 'running') return state.engine;
  const group = state.status.state;
  if (group === 'setup') return `setup-${state.setup ?? ''}`;
  return group === 'off' || group === 'gone' ? group : 'signed-in';
}

/**
 * Settings > BannerTV account (ADR 0006, decision 12), Main's only. Signed
 * out it creates an account or joins one by its code; signed in it shows
 * how syncing is going, syncs now, shows the code, leaves, and deletes.
 * Main's PIN, when it has one, comes before the code is shown and before
 * the account is created or deleted, and a service that needs its setup key
 * asks for it before a new account is made. Back goes back a step, then to
 * Settings, but waits while a create, a confirm, a join, a leave or a
 * delete runs. The welcome's Join with a code opens it on the code (`startOnJoin`);
 * its Create an account opens the menu, on Create. While the copy a join
 * with Use kept lasts, the menu says what it holds and offers to bring it
 * back, signed in or out.
 */
export function AccountScreen({ startOnJoin = false }: { startOnJoin?: boolean }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(accountState.subscribe, accountState.get);
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  const copy = useSyncExternalStore(asideCopy.subscribe, asideCopy.get);
  const now = useNow();
  const [step, setStep] = useState<Step>(() =>
    startOnJoin && !syncOn() ? { name: 'join' } : { name: 'menu' },
  );
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pinMessage, setPinMessage] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState('');
  // Each action takes a number; an answer for an older one, or after leaving the screen, is dropped.
  const action = useRef(0);
  useEffect(() => {
    openAccount();
    checkAsideCopy();
    return () => {
      action.current += 1;
    };
  }, []);

  const target = focusFor(step, state, section.canCreate);
  useScreenFocus(target, state.engine !== 'starting');
  const view = viewOf(step, state);
  const shownView = useRef(view);
  // Where a closing dialog sends focus: what the screen shows once it has closed.
  const latestTarget = useRef(target);
  // Where the PIN pad sends focus when it closes without the PIN: the button that opened it.
  const pinOpener = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    latestTarget.current = target;
  });
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    if (target) void setFocus(target);
  }, [view, target]);

  const toMenu = (message: string | null = null) => {
    action.current += 1;
    setStep({ name: 'menu' });
    setNote(message);
    setTyped('');
  };

  useBack(
    'screen',
    () => {
      if (step.name !== 'busy' || !step.held) toMenu();
      return true;
    },
    step.name !== 'menu',
  );

  /**
   * Runs `work` as a busy step; `done` and `failed` only if nothing else
   * happened meanwhile. A `held` one stays on screen until it settles.
   */
  function busy<T>(
    text: string,
    work: () => Promise<T>,
    done: (value: T) => void,
    failed: (error: unknown) => void,
    held = false,
  ): void {
    const mine = ++action.current;
    setNote(null);
    setStep({ name: 'busy', text, held });
    work().then(
      (value) => {
        if (action.current === mine) done(value);
      },
      (error: unknown) => {
        if (action.current === mine) failed(error);
      },
    );
  }

  const main = profiles.get().profiles.filter((p) => p.id === MAIN_PROFILE_ID)[0]!;
  const lockedMessage = () =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(MAIN_PROFILE_ID) / 1000) });

  /** Makes the account, or carries on making it; `key` is the service's setup key, when typed. */
  const startCreate = (key?: string) =>
    busy(
      t('account.creating'),
      () => createAccount(key),
      (code) => {
        setTyped('');
        setStep({ name: 'code', code });
      },
      (error) => {
        const problem = problemOf(error);
        if (problem === 'key') {
          // The service needs its setup key: asked for, or asked for again.
          setStep({ name: 'key' });
          setNote(key === undefined ? null : t('account.key'));
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
      true,
    );

  const sendKey = () => {
    if (typed.trim() === '') {
      setNote(t('account.keyMissing'));
      void setFocus('account-key-field');
      return;
    }
    startCreate(typed);
  };

  const proceed = (then: Guarded) => {
    if (then === 'create') {
      // A new account on a service that needs its setup key asks for it first. One carried
      // on sends the key it was given before.
      if (section.needsKey && state.engine === 'running' && state.status.state === 'off') {
        setTyped('');
        setNote(null);
        setStep({ name: 'key' });
      } else startCreate();
    } else if (then === 'delete') setDialog({ kind: 'delete' });
    else {
      const code = accountCode();
      if (code) {
        setNote(null);
        setStep({ name: 'show', code });
      }
    }
  };

  /** Main's PIN first, when it has one. `from` is the button pressed, where Back returns. */
  const guarded = (then: Guarded, from: string) => {
    if (!main.pin) {
      proceed(then);
      return;
    }
    pinOpener.current = from;
    setPinMessage(pinGuard.waitMs(MAIN_PROFILE_ID) > 0 ? lockedMessage() : undefined);
    setDialog({ kind: 'pin', then });
  };

  const check = (code: string) => {
    const last = typed.toUpperCase().replace(/[\s-]+/g, '');
    if (last !== code.slice(-4)) {
      setNote(t('account.checkWrong'));
      void setFocus('account-check-field');
      return;
    }
    busy(
      t('account.sending'),
      confirmAccount,
      () => toMenu(t('account.created')),
      () => toMenu(t('account.offline')),
      true,
    );
  };

  const join = (code: string, mode: JoinMode) =>
    busy(
      t('account.joining'),
      () => joinAccount(code, mode),
      // The app starts again as one of the account's screens.
      () => undefined,
      (error) => {
        const problem = problemOf(error);
        if (problem === 'offline') toMenu(t('account.joinOffline'));
        else if (problem === 'profiles' || problem === 'unknown' || problem === 'invalid') {
          toMenu(t(`account.${problem}`));
        } else toMenu(t('account.failed'));
      },
      true,
    );

  const bringBack = () =>
    busy(
      t('account.aside.bringing'),
      bringBackAside,
      // When profiles came back, the app starts again instead.
      () => toMenu(t('account.aside.done')),
      (error) => {
        const problem = problemOf(error);
        if (problem === 'profiles' || problem === 'none') toMenu(t(`account.aside.${problem}`));
        else if (problem === 'offline') toMenu(t('account.offline'));
        else toMenu(t('account.failed'));
      },
      true,
    );

  const lookUp = () => {
    const code = readAccountCode(typed);
    if (!code) {
      setNote(t('account.invalid'));
      void setFocus('account-code-field');
      return;
    }
    busy(
      t('account.checking'),
      async () => {
        const preview = await previewAccount(code);
        return { preview, own: preview.result === 'ok' ? await hasOwnData() : false };
      },
      ({ preview, own }) => {
        if (preview.result !== 'ok') {
          setStep({ name: 'join' });
          setNote(t(`account.${preview.result}`));
          return;
        }
        // Nothing of its own here: the screen simply becomes the account's.
        if (!own) join(code, 'use');
        else setStep({ name: 'choose', code, account: preview.profiles });
      },
      () => {
        setStep({ name: 'join' });
        setNote(t('account.offline'));
      },
    );
  };

  const here: AccountProfile[] = profiles.get().profiles.map((p) => ({ id: p.id, name: p.name }));

  let body: ReactNode;
  if (step.name === 'busy') {
    body = (
      <p className={styles.line} role="status">
        {step.text}
      </p>
    );
  } else if (step.name === 'code' || step.name === 'show') {
    body = (
      <>
        <section className={styles.codePanel} aria-label={t('account.codeTitle')}>
          <h2 className={styles.heading}>{t('account.codeTitle')}</h2>
          <p className={styles.code} data-account-code={step.code}>
            {formatAccountCode(step.code)
              .split(' ')
              .map((group, index) => (
                <span key={index} className={styles.group}>
                  {group}
                </span>
              ))}
          </p>
          <p className={styles.help}>
            {step.name === 'code' ? t('account.codeHelp') : t('account.showCodeHelp')}
          </p>
        </section>
        <div className={screen.column}>
          {step.name === 'code' ? (
            <Button
              block
              variant="primary"
              focusKey="account-code-saved"
              label={t('account.codeSaved')}
              onPress={() => {
                setTyped('');
                setNote(null);
                setStep({ name: 'check', code: step.code });
              }}
            />
          ) : (
            <Button
              block
              focusKey="account-hide-code"
              label={t('account.hideCode')}
              onPress={() => toMenu()}
            />
          )}
        </div>
      </>
    );
  } else if (step.name === 'check') {
    body = (
      <div className={styles.wide}>
        <p className={styles.help}>{t('account.checkHelp')}</p>
        <TextField
          focusKey="account-check-field"
          label={t('account.checkLabel')}
          placeholder={t('account.checkPlaceholder')}
          value={typed}
          onChange={(value) => {
            setNote(null);
            setTyped(value.slice(0, 8));
          }}
          onSubmit={() => check(step.code)}
        />
        <div className={styles.actions}>
          <Button
            block
            variant="primary"
            focusKey="account-check"
            label={t('account.check')}
            onPress={() => check(step.code)}
          />
          <Button
            block
            focusKey="account-show-again"
            label={t('account.showAgain')}
            onPress={() => {
              setNote(null);
              setStep({ name: 'code', code: step.code });
            }}
          />
        </div>
      </div>
    );
  } else if (step.name === 'join') {
    body = (
      <div className={styles.wide}>
        <p className={styles.help}>{t('account.joinHelp')}</p>
        <TextField
          focusKey="account-code-field"
          label={t('account.codeLabel')}
          placeholder={t('account.codePlaceholder')}
          value={typed}
          onChange={(value) => {
            setNote(null);
            setTyped(value.slice(0, 40));
          }}
          onSubmit={lookUp}
        />
        <div className={styles.actions}>
          <Button
            block
            variant="primary"
            focusKey="account-join-continue"
            label={t('account.continue')}
            onPress={lookUp}
          />
        </div>
      </div>
    );
  } else if (step.name === 'key') {
    body = (
      <div className={styles.wide}>
        <h2 className={styles.heading}>{t('account.keyTitle')}</h2>
        <p className={styles.help}>{t('account.keyHelp')}</p>
        <TextField
          focusKey="account-key-field"
          label={t('account.keyLabel')}
          placeholder={t('account.keyPlaceholder')}
          value={typed}
          onChange={(value) => {
            setNote(null);
            setTyped(value.slice(0, 256));
          }}
          onSubmit={sendKey}
        />
        <div className={styles.actions}>
          <Button
            block
            variant="primary"
            focusKey="account-key-continue"
            label={t('account.continue')}
            onPress={sendKey}
          />
        </div>
      </div>
    );
  } else if (step.name === 'choose') {
    const total = profilesAfterBring(here, step.account);
    const fits = total <= MAX_PROFILES;
    body = (
      <div>
        <h2 className={styles.heading}>{t('account.chooseTitle')}</h2>
        <p className={styles.help}>{t('account.chooseLead')}</p>
        <div className={styles.option}>
          {fits ? (
            <Button
              block
              focusKey="account-bring"
              label={t('account.bring')}
              onPress={() => join(step.code, 'bring')}
            />
          ) : (
            <p className={styles.line}>
              {t('account.bringFull', {
                account: step.account.length,
                more: total - step.account.length,
              })}
            </p>
          )}
          {fits && (
            <ul className={styles.plan}>
              {joinPlan(t, 'bring', here, step.account).map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>{t('account.bringHelp')}</li>
            </ul>
          )}
        </div>
        <div className={styles.option}>
          <Button
            block
            focusKey="account-use"
            label={t('account.use')}
            onPress={() => setDialog({ kind: 'use', code: step.code })}
          />
          <ul className={styles.plan}>
            {joinPlan(t, 'use', here, step.account).map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>{t('account.useHelp')}</li>
          </ul>
        </div>
        <div className={screen.column}>
          <Button
            block
            focusKey="account-choose-cancel"
            label={t('common.cancel')}
            onPress={() => toMenu()}
          />
        </div>
      </div>
    );
  } else if (state.engine === 'starting') {
    body = <p className={styles.line}>{t('account.loading')}</p>;
  } else if (state.engine === 'broken') {
    body = <p className={styles.line}>{t('account.broken')}</p>;
  } else {
    body = renderMenu();
  }

  /** What the copy a join with Use kept holds, and the button that brings it back, while it lasts. */
  function renderAside(signedIn: boolean): ReactNode {
    if (!copy) return null;
    return (
      <section className={styles.aside} aria-label={t('account.aside.title')}>
        <h2 className={styles.heading}>{t('account.aside.title')}</h2>
        <p className={styles.help}>{t('account.aside.lead', { date: asideDate(copy.until) })}</p>
        <ul className={styles.plan}>
          {asideLines(t, copy).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className={styles.actions}>
          <Button
            block
            focusKey="account-bring-back"
            label={t('account.aside.bring')}
            onPress={() =>
              setDialog({ kind: 'back', signedIn, restarts: asideRestarts(copy, here) })
            }
          />
        </div>
      </section>
    );
  }

  function renderMenu(): ReactNode {
    const status = state.status;
    if (status.state === 'off') {
      return (
        <>
          <p className={styles.help}>{t('account.private')}</p>
          <div className={screen.column}>
            {section.canCreate ? (
              <Button
                block
                variant="primary"
                focusKey="account-create"
                label={t('account.create')}
                onPress={() => guarded('create', 'account-create')}
              />
            ) : (
              <p className={styles.line}>{t('account.closed')}</p>
            )}
            <Button
              block
              focusKey="account-join"
              label={t('account.join')}
              onPress={() => {
                setTyped('');
                setNote(null);
                setStep({ name: 'join' });
              }}
            />
          </div>
          {renderAside(false)}
        </>
      );
    }
    if (status.state === 'gone') {
      return (
        <>
          <p className={styles.line}>{t('account.gone')}</p>
          <div className={screen.column}>
            <Button
              block
              focusKey="account-leave"
              label={t('account.leave')}
              onPress={() =>
                busy(
                  t('account.leave'),
                  leaveAccount,
                  () => toMenu(t('account.left')),
                  () => toMenu(t('account.failed')),
                  true,
                )
              }
            />
          </div>
        </>
      );
    }
    if (status.state === 'setup') {
      if (state.setup === 'creating') {
        return (
          <>
            <p className={styles.line}>{t('account.setupCreating')}</p>
            <div className={screen.column}>
              <Button
                block
                variant="primary"
                focusKey="account-setup-show"
                label={t('account.setupShow')}
                onPress={() => guarded('create', 'account-setup-show')}
              />
              <Button
                block
                focusKey="account-setup-cancel"
                label={t('account.setupCancel')}
                onPress={() =>
                  busy(
                    t('account.deleting'),
                    deleteAccount,
                    () => toMenu(),
                    () => toMenu(t('account.deleteOffline')),
                    true,
                  )
                }
              />
            </div>
          </>
        );
      }
      const joining = state.setup === 'joining';
      return (
        <>
          <p className={styles.line}>
            {joining ? t('account.setupJoining') : t('account.setupConfirmed')}
          </p>
          <div className={screen.column}>
            <Button
              block
              variant="primary"
              focusKey="account-try"
              label={t('account.tryNow')}
              onPress={() => {
                const code = accountCode();
                if (joining && code) join(code, state.mode ?? 'bring');
                else void syncAccountNow();
              }}
            />
            {joining ? (
              <Button
                block
                focusKey="account-leave"
                label={t('account.leave')}
                onPress={() => setDialog({ kind: 'leave' })}
              />
            ) : (
              <Button
                block
                focusKey="account-delete"
                label={t('account.delete')}
                onPress={() => guarded('delete', 'account-delete')}
              />
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <p className={styles.status} role="status">
          {statusLine(t, status, now)}
        </p>
        <div className={screen.column}>
          <Button
            block
            variant="primary"
            focusKey="account-sync"
            label={t('account.syncNow')}
            onPress={() => {
              setNote(null);
              void syncAccountNow();
            }}
          />
          <Button
            block
            focusKey="account-show-code"
            label={t('account.showCode')}
            onPress={() => guarded('show', 'account-show-code')}
          />
          <Button
            block
            focusKey="account-leave"
            label={t('account.leave')}
            onPress={() => setDialog({ kind: 'leave' })}
          />
          <Button
            block
            focusKey="account-delete"
            label={t('account.delete')}
            onPress={() => guarded('delete', 'account-delete')}
          />
        </div>
        {renderAside(true)}
      </>
    );
  }

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('account.title')}</h1>
      <p className={screen.lead}>{t('account.lead')}</p>
      {/* Keyed by what it shows: a button reused under another focus key would keep the old one. */}
      <Fragment key={view}>{body}</Fragment>
      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
      {dialog?.kind === 'pin' && (
        <PinPad
          focusKey="account-pin"
          title={t('pin.enterFor', { name: main.name })}
          message={pinMessage}
          returnFocusKey={() => pinOpener.current ?? latestTarget.current ?? 'account-pin'}
          onPin={(digits) => {
            const result = pinGuard.attempt(main, digits);
            if (result !== 'ok') {
              setPinMessage(result === 'locked' ? lockedMessage() : t('pin.wrong'));
              return;
            }
            // Right: focus goes where the next view says.
            pinOpener.current = undefined;
            const then = dialog.then;
            setDialog(null);
            proceed(then);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'leave' && (
        <ConfirmDialog
          focusKey="account-leave-dialog"
          title={t('account.leaveTitle')}
          message={t('account.leaveMessage')}
          confirmLabel={t('account.leaveConfirm')}
          cancelLabel={t('common.cancel')}
          returnFocusKey="account-leave"
          onConfirm={() => {
            setDialog(null);
            busy(
              t('account.leave'),
              leaveAccount,
              () => toMenu(t('account.left')),
              () => toMenu(t('account.failed')),
              true,
            );
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          focusKey="account-delete-dialog"
          title={t('account.deleteTitle')}
          message={t('account.deleteMessage')}
          confirmLabel={t('account.deleteConfirm')}
          cancelLabel={t('common.cancel')}
          returnFocusKey="account-delete"
          onConfirm={() => {
            setDialog(null);
            busy(
              t('account.deleting'),
              deleteAccount,
              () => toMenu(t('account.deleted')),
              () => toMenu(t('account.deleteOffline')),
              true,
            );
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'use' && (
        <ConfirmDialog
          focusKey="account-use-dialog"
          title={t('account.useTitle')}
          message={t('account.useMessage')}
          confirmLabel={t('account.use')}
          cancelLabel={t('common.cancel')}
          returnFocusKey="account-use"
          onConfirm={() => {
            const code = dialog.code;
            setDialog(null);
            join(code, 'use');
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'back' && (
        <ConfirmDialog
          focusKey="account-back-dialog"
          title={t('account.aside.confirmTitle')}
          message={[
            t(dialog.signedIn ? 'account.aside.intoAccount' : 'account.aside.onScreen'),
            ...(dialog.restarts ? [t('account.aside.restarts')] : []),
          ].join(' ')}
          confirmLabel={t('account.aside.confirm')}
          cancelLabel={t('common.cancel')}
          returnFocusKey="account-bring-back"
          onConfirm={() => {
            setDialog(null);
            bringBack();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
