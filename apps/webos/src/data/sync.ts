import {
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
import { addonCollection } from './addons';
import { homeLayout, library, subtitleOffsets, trackMemory } from './library';
import { playedVideos, progress } from './playback';
import { preferences, profilePreferences } from './preferences';
import { deleteProfile } from './profile-delete';
import {
  activeProfileId,
  forgetHeldDeletion,
  heldDeletions,
  holdKidsChange,
  holdProfileDeletion,
  MAIN_NAME,
  profilePrefix,
  profiles,
} from './profiles';
import { browserTimers, sportsChoices } from './sports';
import { storage } from './storage';
import { accountClock, setSyncOn, storeNow, syncOn } from './sync-clock';
import { preferencesPart, profilesPart, sportsPart } from './sync-parts';
import { createSyncTransport, SYNC_SERVICE } from './sync-service';

/**
 * The BannerTV account on this screen (ADR 0006): the core's sync engine
 * over the app's stores, and what Settings > BannerTV account asks of it.
 *
 * Without an account nothing here runs at launch: no store is watched, the
 * stores keep their own clocks, and the service hears nothing until
 * Settings is opened, which asks it once a day whether it is there.
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
  /** When a sync last finished, for the status line before the first one of a launch. */
  lastSync?: number;
}

function readSavedStatus(): SavedStatus {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value !== 'object' || value === null) return {};
    const { at, create, lastSync } = value as Record<string, unknown>;
    const saved: SavedStatus = {};
    if (typeof at === 'number') saved.at = at;
    if (typeof create === 'boolean') saved.create = create;
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
}

/** Whether Settings offers the account. A signed-in screen always does. */
export const accountSection = createStore<AccountSection>({
  shown: !!SYNC_SERVICE && syncOn(),
  canCreate: readSavedStatus().create !== false,
});

function showSection(shown: boolean, canCreate = accountSection.get().canCreate): void {
  const current = accountSection.get();
  if (current.shown !== shown || current.canCreate !== canCreate) {
    accountSection.set({ shown, canCreate });
  }
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
        showSection(true, saved.create !== false);
        return;
      }
      const status = await checkSyncService(transport);
      if (!status) {
        showSection(false);
        return;
      }
      saveStatus({ at: Date.now(), create: status.create });
      showSection(true, status.create);
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
  setSyncOn(status.state !== 'off');
  if (status.state !== 'off') showSection(true);
  if (status.lastSync !== undefined && status.lastSync !== readSavedStatus().lastSync) {
    saveStatus({ lastSync: status.lastSync });
  }
  const current = accountState.get();
  if (status.state !== 'setup') {
    setState({ engine: 'running', status });
    return;
  }
  setState({ engine: 'running', status, setup: current.setup, mode: current.mode });
  void loadSyncState(storage.kv).then((saved) => {
    if (!saved || made.status() !== status) return;
    const setup: SetupStage =
      saved.phase === 'joining' ? 'joining' : saved.step === 1 ? 'confirmed' : 'creating';
    setState({ engine: 'running', status, setup, mode: saved.mode });
  });
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
      holdKids: holdKidsChange,
    }),
    collectionPart(addonCollection),
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
    // A join carried on at this launch finished: start again as the account's screen.
    onJoined: () => window.location.reload(),
  });
  engine = made;
  if (typeof document !== 'undefined' && document.hidden) made.hide();
  made.subscribe(() => follow(made));
  await made.start({ id, parts: activeParts(id) });
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

/**
 * Starts the account at launch. A signed-in screen watches its stores from
 * the moment a profile is chosen and pulls two seconds later; one without
 * an account does nothing until Settings > BannerTV account is opened.
 */
export function startSync(): void {
  void profilePrefix.then(deleteHeldProfiles);
  if (!SYNC_SERVICE) return;
  // Hidden: everything waiting is pushed and pulls stop. Back after two minutes or more: a pull.
  document.addEventListener('visibilitychange', () => {
    if (!engine) return;
    if (document.hidden) engine.hide();
    else engine.show();
  });
  window.addEventListener('pagehide', () => engine?.hide());
  if (syncOn()) {
    void openEngine();
    return;
  }
  // The flag is a copy, for the first paint, of what the engine keeps in IndexedDB. Where
  // localStorage lost it, the engine's own state still says this screen is in an account.
  void loadSyncState(storage.kv).then(
    (saved) => {
      if (saved) void openEngine();
    },
    () => undefined,
  );
}

/** The account screen opened: the engine reads what it kept, without asking the service anything. */
export function openAccount(): void {
  void openEngine();
}

/** Makes the account, or carries on making it, and returns its code. Nothing is sent yet. */
export async function createAccount(): Promise<string> {
  return (await running()).create();
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

/** Whether this screen has profiles or data of its own, which makes joining ask Bring or Use. */
export async function hasOwnData(): Promise<boolean> {
  return (await running()).hasLocalData();
}

/** Joins the account, then starts the app again as one of its screens. */
export async function joinAccount(input: string, mode: JoinMode): Promise<void> {
  await (await running()).join(input, mode);
  window.location.reload();
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
