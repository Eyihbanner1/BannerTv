import {
  addonSwitchesPart,
  checkSyncService,
  collectionPart,
  createProfileStores,
  createStore,
  createSyncEngine,
  deriveAccountKeys,
  isRemoval,
  itemAt,
  type Items,
  type JoinMode,
  loadBase,
  loadSyncState,
  MAIN_PROFILE_ID,
  openDocument,
  profileKeyPrefix,
  profileKeyValueStore,
  profileParts,
  readAccountCode,
  readPullAnswer,
  type SyncEngine,
  type SyncPart,
  SyncSetupError,
  type SyncStatus,
  wireName,
} from '@bannertv/core';
import { SPORTS_IN_BUILD } from '../app/features';
import { pageCrypto, webCryptoWorks } from '../platform/web-crypto';
import { addonSwitches, allAddons } from './addons';
import { homeLayout, library, subtitleOffsets, trackMemory } from './library';
import { playedVideos, progress } from './playback';
import { preferences, profilePreferences } from './preferences';
import { deleteProfile } from './profile-delete';
import {
  activeProfileId,
  confirmHeldKids,
  forgetHeldDeletion,
  heldDeletions,
  heldKidsChange,
  holdKidsChange,
  holdProfileAside,
  holdProfileDeletion,
  kidsHeldAtLaunch,
  launchSaved,
  MAIN_NAME,
  profilePrefix,
  profiles,
  restoreSaved,
  savedProfiles,
  setHiddenProfiles,
} from './profiles';
import { browserTimers, sportsChoices } from './sports';
import { storage } from './storage';
import { accountClock, setSyncOn, storeNow, syncOn } from './sync-clock';
import { markJoined, settleJoined } from './sync-joined';
import { preferencesPart, profilesPart, sportsPart } from './sync-parts';
import { reloadWhenSafe } from './sync-reload';
import { createSyncTransport, SYNC_SERVICE } from './sync-service';

/**
 * The BannerTV account on this screen (ADR 0006): the core's sync engine
 * over the app's stores, and what Settings > BannerTV account asks of it.
 *
 * Without an account nothing here runs at launch: no store is watched, the
 * stores keep their own clocks, and the service hears nothing until the
 * welcome or Settings shows on Main, which asks it once a day whether it is
 * there.
 */

// The last GET /v1/status answer and when it came, and when a sync last finished.
const STATUS_KEY = 'bannertv.syncStatus';
const DAY_MS = 24 * 60 * 60 * 1000;
const PROFILE_ID = /^[a-z0-9]{1,16}$/;

interface SavedStatus {
  /** When the service last answered GET /v1/status, by this screen's clock. */
  at?: number;
  /** Whether it said new accounts can be made. */
  create?: boolean;
  /** Whether it said making one needs its setup key. */
  key?: boolean;
  /** When a sync last finished, for the status line before the first one of a launch. */
  lastSync?: number;
}

function readSavedStatus(): SavedStatus {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value !== 'object' || value === null) return {};
    const { at, create, key, lastSync } = value as Record<string, unknown>;
    const saved: SavedStatus = {};
    if (typeof at === 'number') saved.at = at;
    if (typeof create === 'boolean') saved.create = create;
    if (typeof key === 'boolean') saved.key = key;
    if (typeof lastSync === 'number') saved.lastSync = lastSync;
    return saved;
  } catch {
    return {};
  }
}

function saveStatus(change: SavedStatus): void {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ ...readSavedStatus(), ...change }));
  } catch {
    // Then Settings asks the service again next time.
  }
}

const transport = createSyncTransport();

export interface AccountSection {
  /** Settings shows BannerTV account (to Main only: SettingsScreen checks who). */
  shown: boolean;
  /** The service last said new accounts can be made. */
  canCreate: boolean;
  /** The service last said making one needs its setup key, which createAccount then takes. */
  needsKey: boolean;
}

/** Whether Settings offers the account. A signed-in screen always does. */
export const accountSection = createStore<AccountSection>({
  shown: !!SYNC_SERVICE && syncOn(),
  canCreate: readSavedStatus().create !== false,
  needsKey: readSavedStatus().key === true,
});

function showSection(
  shown: boolean,
  canCreate = accountSection.get().canCreate,
  needsKey = accountSection.get().needsKey,
): void {
  const current = accountSection.get();
  if (current.shown !== shown || current.canCreate !== canCreate || current.needsKey !== needsKey) {
    accountSection.set({ shown, canCreate, needsKey });
  }
}

/**
 * The service answered a create with `closed`: no new accounts now. Kept
 * with its status, so the menu offers only Join, as when the status says
 * so, and asks again in a day. createAccount calls it itself.
 */
export function newAccountsClosed(): void {
  saveStatus({ at: Date.now(), create: false });
  showSection(true, false);
}

/** The service answered a create with `key`: making an account needs its setup key. */
function keyNeeded(): void {
  saveStatus({ key: true });
  showSection(true, accountSection.get().canCreate, true);
}

let checking = false;

/**
 * Settings was opened: the account shows on a signed-in screen, or where
 * the service is set, Web Crypto gets the known answers, IndexedDB is not
 * running from memory, and the service answered GET /v1/status within the
 * last day (ADR 0006, decision 13). The service is asked at most once a day.
 */
export function checkAccountSection(): void {
  if (!SYNC_SERVICE || checking) return;
  if (syncOn()) {
    showSection(true);
    return;
  }
  checking = true;
  void (async () => {
    try {
      if (!(await webCryptoWorks()) || !(await storage.persistent)) {
        showSection(false);
        return;
      }
      const saved = readSavedStatus();
      const age = saved.at === undefined ? -1 : Date.now() - saved.at;
      if (age >= 0 && age < DAY_MS) {
        showSection(true, saved.create !== false, saved.key === true);
        return;
      }
      const status = await checkSyncService(transport);
      if (!status) {
        showSection(false);
        return;
      }
      saveStatus({ at: Date.now(), create: status.create, key: status.key });
      showSection(true, status.create, status.key);
    } finally {
      checking = false;
    }
  })();
}

/** How far an unfinished create or join got. */
export type SetupStage = 'creating' | 'confirmed' | 'joining';

export interface AccountState {
  /** `starting` until the engine has read what it kept; `broken` where it cannot run here. */
  engine: 'starting' | 'running' | 'broken';
  status: SyncStatus;
  /**
   * With status `setup`: a create whose code still waits to be written down,
   * one written down and still sending, or a join being carried on.
   */
  setup?: SetupStage;
  /** A join's choice, to carry it on. */
  mode?: JoinMode;
}

/** The account as Settings > BannerTV account shows it. */
export const accountState = createStore<AccountState>({
  engine: 'starting',
  status: { state: 'off' },
});

let engine: SyncEngine | undefined;
let opening: Promise<SyncEngine | undefined> | undefined;
/** The engine once it has read what it kept: before that, `off` says nothing. */
let started: SyncEngine | undefined;

function setState(next: AccountState): void {
  const current = accountState.get();
  if (
    current.engine !== next.engine ||
    current.status !== next.status ||
    current.setup !== next.setup ||
    current.mode !== next.mode
  ) {
    accountState.set(next);
  }
}

/** Mirrors the engine's status for the screen, the stores' clock and the next launch. */
function follow(made: SyncEngine): void {
  const status = made.status();
  // A state the engine could not read is not "no account": the flag stays for the next launch.
  if (status.state === 'off' && started !== made) return;
  setSyncOn(status.state !== 'off');
  if (status.state !== 'off') showSection(true);
  else setHiddenProfiles(0);
  if (status.lastSync !== undefined && status.lastSync !== readSavedStatus().lastSync) {
    saveStatus({ lastSync: status.lastSync });
  }
  const current = accountState.get();
  if (status.state !== 'setup') {
    setState({ engine: 'running', status });
    return;
  }
  setState({ engine: 'running', status, setup: current.setup, mode: current.mode });
  void loadSyncState(storage.kv, browserTimers).then(
    (saved) => {
      if (!saved || made.status() !== status) return;
      const setup: SetupStage =
        saved.phase === 'joining' ? 'joining' : saved.step === 1 ? 'confirmed' : 'creating';
      setState({ engine: 'running', status, setup, mode: saved.mode });
    },
    // Unread, the screen says what it said before.
    () => undefined,
  );
}

/** The parts of the profile in use, over the stores the app already has open. */
function activeParts(profileId: string): SyncPart[] {
  return [
    ...profileParts(profileId, {
      library,
      progress,
      played: playedVideos,
      homeLayout,
      trackMemory,
      subtitleOffsets,
    }),
    preferencesPart(profileId, preferences),
  ];
}

/** The parts of a profile not in use, over stores of its own, as deleting a profile reaches it. */
function spareParts(profileId: string): SyncPart[] {
  const kv = profileKeyValueStore(storage.kv, Promise.resolve(profileKeyPrefix(profileId)));
  return [
    ...profileParts(profileId, createProfileStores(kv, storeNow)),
    preferencesPart(profileId, profilePreferences(profileId)),
  ];
}

function accountParts(): SyncPart[] {
  const parts: SyncPart[] = [
    profilesPart({
      profiles,
      activeId: () => activeProfileId.get(),
      mainName: MAIN_NAME,
      holdDeletion: holdProfileDeletion,
      holdAside: holdProfileAside,
      holdKids: holdKidsChange,
      heldKids: heldKidsChange,
      hidden: setHiddenProfiles,
    }),
    // Every install, those switched off too: their switches are a part of their own.
    collectionPart(allAddons),
    addonSwitchesPart(addonSwitches),
  ];
  // A build without Sports leaves the account's Sports settings as they are.
  if (SPORTS_IN_BUILD) parts.push(sportsPart(sportsChoices));
  return parts;
}

async function open(): Promise<SyncEngine | undefined> {
  const crypto = pageCrypto();
  // An empty IndexedDB in memory would read as a screen without an account.
  if (!SYNC_SERVICE || !crypto || !(await webCryptoWorks()) || !(await storage.persistent)) {
    return undefined;
  }
  await profilePrefix;
  const id = activeProfileId.get();
  if (id === null) return undefined;
  const made = createSyncEngine({
    crypto,
    transport,
    storage: storage.kv,
    clock: accountClock,
    timers: browserTimers,
    accountParts: accountParts(),
    profileParts: spareParts,
    lastSync: readSavedStatus().lastSync,
    // A join that carried on by itself finished: start again as the account's screen, once
    // that interrupts nothing.
    onJoined: () => reloadWhenSafe(() => void reloadJoined()),
  });
  engine = made;
  if (typeof document !== 'undefined' && document.hidden) made.hide();
  const off = made.subscribe(() => follow(made));
  try {
    await made.start({ id, parts: activeParts(id) });
  } catch (error) {
    // What the engine kept could not be read: nothing runs for this launch, and nothing is
    // taken for signed out.
    off();
    engine = undefined;
    throw error;
  }
  started = made;
  follow(made);
  return made;
}

/** Starts the engine once, for a signed-in screen at launch or when the account screen opens. */
function openEngine(): Promise<SyncEngine | undefined> {
  if (!opening) {
    opening = open().then(
      (made) => {
        if (!made) setState({ engine: 'broken', status: accountState.get().status });
        return made;
      },
      () => {
        setState({ engine: 'broken', status: accountState.get().status });
        return undefined;
      },
    );
  }
  return opening;
}

async function running(): Promise<SyncEngine> {
  const made = await openEngine();
  if (!made) throw new SyncSetupError('not-started');
  return made;
}

/** Deletes, once launched, the data of profiles the account deleted (ADR 0006, decision 6). */
async function deleteHeldProfiles(): Promise<void> {
  for (const id of heldDeletions()) {
    if (id === activeProfileId.get()) continue;
    await deleteProfile(id);
    forgetHeldDeletion(id);
  }
}

/** Starts the app again after a join, with a copy of what the join wrote that the reload cannot lose. */
async function reloadJoined(): Promise<void> {
  try {
    await markJoined(storage.kv, savedProfiles);
  } catch {
    // Without the copy the reload most often reads everything anyway.
  }
  window.location.reload();
}

/** The account's profiles as the engine last saved them, or undefined when they cannot be read. */
async function savedAccountProfiles(): Promise<Items | undefined> {
  try {
    return (await loadBase(storage.kv, 'profiles', browserTimers)).items;
  } catch {
    return undefined;
  }
}

/**
 * What the last launch left to check, before the profiles are used for
 * anything else: a join's reload that lost some of what it wrote, and kids
 * settings held for this launch that the account has changed back since.
 * Resolves false when the app starts again instead.
 */
async function settleLaunch(): Promise<boolean> {
  const settled = await settleJoined({
    kv: storage.kv,
    launch: launchSaved,
    restore: restoreSaved,
    signIn: () => setSyncOn(true),
    reload: () => window.location.reload(),
    timers: browserTimers,
  });
  if (!settled) return false;
  if (kidsHeldAtLaunch() && confirmHeldKids(await savedAccountProfiles())) {
    window.location.reload();
    return false;
  }
  return true;
}

/**
 * Starts the account at launch. A signed-in screen watches its stores from
 * the moment a profile is chosen and pulls two seconds later; one without
 * an account does nothing until Settings > BannerTV account is opened.
 */
export function startSync(): void {
  if (SYNC_SERVICE) {
    // Hidden: everything waiting is pushed and pulls stop. Back after two minutes or more: a pull.
    document.addEventListener('visibilitychange', () => {
      if (!engine) return;
      if (document.hidden) engine.hide();
      else engine.show();
    });
    window.addEventListener('pagehide', () => engine?.hide());
  }
  void settleLaunch().then(
    (go) => {
      if (go) startAccount();
    },
    // Left unchecked, the profiles are as this launch read them: the account starts all the same.
    () => startAccount(),
  );
}

function startAccount(): void {
  void profilePrefix.then(deleteHeldProfiles);
  if (!SYNC_SERVICE) return;
  if (syncOn()) {
    void openEngine();
    return;
  }
  // The flag is a copy, for the first paint, of what the engine keeps in IndexedDB. Where
  // localStorage lost it, the engine's own state still says this screen is in an account.
  // Where that cannot be read either, the engine is opened all the same: it then reads it
  // again, and without an account it does nothing.
  void loadSyncState(storage.kv, browserTimers).then(
    (saved) => {
      if (saved) void openEngine();
    },
    () => void openEngine(),
  );
}

/**
 * The account screen, or the welcome's offer of it, opened: the engine reads what it
 * kept, without asking the service anything.
 */
export function openAccount(): void {
  void openEngine();
}

/**
 * Makes the account, or carries on making it, and returns its code. Nothing
 * is sent yet. `key` is the service's setup key, when accountSection says it
 * needs one; a create carried on sends the one given before. A `closed` or
 * `key` answer is kept with the service's status (see newAccountsClosed).
 */
export async function createAccount(key?: string): Promise<string> {
  const made = await running();
  const typed = key === undefined ? '' : key.trim();
  try {
    return await made.create(typed === '' ? {} : { key: typed });
  } catch (error) {
    if (error instanceof SyncSetupError && error.problem === 'closed') newAccountsClosed();
    if (error instanceof SyncSetupError && error.problem === 'key') keyNeeded();
    throw error;
  }
}

/** The code has been written down: everything on this screen goes to the account. */
export async function confirmAccount(): Promise<void> {
  await (await running()).confirmCreate();
}

/** The account's code, for Show account code. Undefined while signed out. */
export function accountCode(): string | undefined {
  return engine?.code();
}

/** Pushes what waits and pulls, or carries on a create or join. Never rejects. */
export async function syncAccountNow(): Promise<void> {
  const made = await openEngine();
  if (made) await made.syncNow();
}

/**
 * Brings in what the account changed since the last sync, for a screen that
 * shows the account's profiles (item A8): "Who's watching?" from the rail
 * and Settings > Profiles. Respects the engine's backing off, unlike Sync
 * now. Nothing happens on a screen without an account. Never rejects.
 */
export async function refreshAccount(): Promise<void> {
  if (!syncOn()) return;
  const made = await openEngine();
  if (made) await made.pullNow();
}

/** Whether this screen has profiles or data of its own, which makes joining ask Bring or Use. */
export async function hasOwnData(): Promise<boolean> {
  return (await running()).hasLocalData();
}

/**
 * Joins the account, then starts the app again as one of its screens, at
 * once: the person is watching the join. One the service did not answer
 * rejects with `offline` and carries on by itself; the app then starts
 * again once that interrupts nothing.
 */
export async function joinAccount(input: string, mode: JoinMode): Promise<void> {
  await (await running()).join(input, mode);
  await reloadJoined();
}

/** Forgets the account here; the screen keeps everything it has. */
export async function leaveAccount(): Promise<void> {
  await (await running()).leave();
}

/** Deletes the account from the service, then leaves it here. Rejects when the service is out of reach. */
export async function deleteAccount(): Promise<void> {
  await (await running()).deleteAccount();
}

export interface AccountProfile {
  id: string;
  name: string;
}

/** What a typed code found: the account's profiles, so joining can say what happens to each. */
export type AccountPreview =
  { result: 'ok'; profiles: AccountProfile[] } | { result: 'invalid' | 'unknown' | 'offline' };

/** The account's live profiles, Main first and the rest oldest first. */
function profilesIn(items: Items | undefined): AccountProfile[] {
  const nameOf = (id: string): string | undefined => {
    const item = items && itemAt(items, `${id}/name`);
    return item && !isRemoval(item) && typeof item.v === 'string' && item.v !== ''
      ? item.v
      : undefined;
  };
  const found: Array<AccountProfile & { t: number }> = [];
  for (const key of items ? Object.keys(items) : []) {
    const item = itemAt(items!, key)!;
    if (key === MAIN_PROFILE_ID || !PROFILE_ID.test(key) || isRemoval(item)) continue;
    const name = nameOf(key);
    if (name !== undefined) found.push({ id: key, name, t: item.t });
  }
  found.sort((a, b) => a.t - b.t);
  return [{ id: MAIN_PROFILE_ID, name: nameOf(MAIN_PROFILE_ID) ?? MAIN_NAME }].concat(
    found.map(({ id, name }) => ({ id, name })),
  );
}

/**
 * Checks a typed code with the service and reads the account's profiles,
 * so the screen can say what joining does to each before anything changes.
 */
export async function previewAccount(input: string): Promise<AccountPreview> {
  const code = readAccountCode(input);
  if (!code) return { result: 'invalid' };
  const crypto = pageCrypto();
  if (!crypto) return { result: 'offline' };
  try {
    const keys = await deriveAccountKeys(crypto, code);
    const name = await wireName(crypto, keys, 'profiles');
    let answer;
    try {
      answer = await transport.post('/v1/pull', {
        account: keys.accountId,
        auth: keys.auth,
        have: {},
        want: [name],
      });
    } catch {
      return { result: 'offline' };
    }
    if (answer.status === 401) return { result: 'unknown' };
    const pulled = answer.status === 200 ? readPullAnswer(answer.body) : undefined;
    if (!pulled) return { result: 'offline' };
    const doc = pulled.docs.get(name);
    let items: Items | undefined;
    if (doc) {
      try {
        items = await openDocument(crypto, keys, 'profiles', doc.ver, doc.body);
      } catch {
        // Unreadable or newer: Main is all that can be said.
      }
    }
    return { result: 'ok', profiles: profilesIn(items) };
  } catch {
    return { result: 'offline' };
  }
}
