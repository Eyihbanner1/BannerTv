import { MAIN_PROFILE_ID, MAX_PROFILES } from '../profiles/profiles';
import type { KeyValueStore } from '../storage';
import { createStore, type Listener } from '../store';
import type { Timers } from '../timers';
import type { AccountClock } from './clock';
import { newAccountCode, readAccountCode } from './code';
import type { SyncCrypto } from './crypto';
import {
  canon,
  copyItems,
  hasItem,
  isRemoval,
  type Item,
  type Items,
  itemAt,
  type LiveItem,
} from './items';
import { type AccountKeys, deriveAccountKeys, wireName } from './keys';
import {
  ASIDE_KEY,
  asideUntil,
  deleteSyncKeys,
  type DocumentBase,
  expireAside,
  type JoinMode,
  loadBase,
  loadPending,
  loadSyncState,
  saveBase,
  savePending,
  saveSyncState,
  type SyncAside,
  SYNC_PREFIX,
  type SyncState,
} from './local';
import {
  ACCOUNT_DOCUMENTS,
  changesItem,
  clampItems,
  documentKind,
  documentProfile,
  mergeItem,
  mergeItems,
  profileDocuments,
  tidyItems,
} from './merge';
import { type PartChange, type PartItem, partOwns, type SyncPart } from './part';
import { openDocument, SealError, sealDocument } from './seal';
import {
  answerTime,
  checkSyncService,
  DEFAULT_PULL_MINUTES,
  readCreateAnswer,
  readPullAnswer,
  readPushAnswer,
  readRefusal,
  type SyncTransport,
  WIRE_LIMITS,
} from './wire';

/**
 * Why syncing is paused. It tries again by itself, except for `update`,
 * which waits for a newer build, a document too big for one body, which
 * waits until it changes, and one refused as `full`, which waits until it
 * changes or room may have been made: Sync now, the end of a hold on
 * pushes, or a pull that brought other screens' changes. `limit` (the
 * service's daily writes), `busy`, `too-big` (that document, or a request
 * the service refused for its size) and `full` (the account at its limit of
 * documents or size) stop only what this screen sends: the account's
 * changes still come.
 */
export type PauseReason = 'offline' | 'limit' | 'too-big' | 'full' | 'update' | 'busy';

export interface SyncStatus {
  /**
   * `off`: no account on this screen. `setup`: a create or join has not
   * finished. `syncing`: talking to the service. `waiting`: edits wait for
   * a push. `idle`: in sync. `paused`: see `reason`. `gone`: the account was
   * deleted, or deleted and made again, elsewhere; only leaving is left.
   */
  state: 'off' | 'setup' | 'idle' | 'syncing' | 'waiting' | 'paused' | 'gone';
  reason?: PauseReason;
  /** This screen's clock when a sync last finished, for "In sync 2 minutes ago". */
  lastSync?: number;
}

/**
 * Why a create or join stopped. `invalid`: not an account code. `unknown`:
 * no account has this code. `offline`: the service did not answer; trying
 * again carries on where it stopped. `closed`: no new accounts now.
 * `exists`: the new code was taken (try again). `key`: making an account
 * needs the service's setup key, and it was missing or wrong. `profiles`:
 * Bring would pass six profiles. `signed-in`: this screen already has an
 * account. `not-started`: start() has not run or could not read what the
 * engine kept, or confirmCreate() came before create().
 */
export type SetupProblem =
  | 'invalid'
  | 'unknown'
  | 'offline'
  | 'closed'
  | 'exists'
  | 'key'
  | 'profiles'
  | 'signed-in'
  | 'not-started';

export class SyncSetupError extends Error {
  readonly problem: SetupProblem;

  constructor(problem: SetupProblem) {
    super(`The BannerTV account could not be set up: ${problem}`);
    this.name = 'SyncSetupError';
    this.problem = problem;
  }
}

/** What checking a typed code with the service found. */
export type CodeCheck = 'ok' | 'invalid' | 'unknown' | 'offline';

/** What creating an account may need. */
export interface CreateOptions {
  /** The service's setup key, when its status says making an account needs one (`key`). */
  key?: string;
}

/** The profile in use and its parts: the core's (profileParts) and the app's preferences part. */
export interface ActiveProfile {
  id: string;
  parts: readonly SyncPart[];
}

export interface SyncEngineOptions {
  crypto: SyncCrypto;
  transport: SyncTransport;
  /** The device-wide key-value store, not a profile's: the engine keeps `sync/…` and `sync-aside` in it. */
  storage: KeyValueStore;
  clock: AccountClock;
  timers: Timers;
  /**
   * The parts of the account-wide documents: the app's profiles part (keys
   * `<id>` and `<id>/name|colour|kids|pin`), collectionPart, and the app's
   * Sports part (`s/<manifestId>`).
   */
  accountParts: readonly SyncPart[];
  /**
   * Parts for a profile not in use, over stores of its own:
   * profileParts(id, createProfileStores(profileKeyValueStore(kv,
   * Promise.resolve(profileKeyPrefix(id))))) with the app's preferences part.
   * Used to create, join, and to say whether this screen has data of its
   * own; never for the profile in use, whose stores are already open.
   */
  profileParts(profileId: string): readonly SyncPart[];
  /** When the last sync finished, as the app saved it, so the status line has it at launch. */
  lastSync?: number;
  /**
   * Called when a join that was interrupted finishes by itself, carried on
   * at a later launch or after the person's join could not reach the
   * service: the app reloads.
   */
  onJoined?: () => void;
}

export interface SyncEngine {
  status(): SyncStatus;
  subscribe(listener: Listener): () => void;
  /**
   * Call once a profile is chosen, signed in or not. Reads what the engine
   * kept; on a signed-in screen it then watches the stores, pulls two
   * seconds later and every `pullMinutes` after. Carries on a create or
   * join that was interrupted. Makes no request on a screen without an
   * account. Rejects when what the engine kept (its state, or a document's
   * edits or base) cannot be read even when tried again: nothing is then
   * watched or changed for this launch, the status stays `off` and code()
   * says nothing.
   */
  start(profile: ActiveProfile): Promise<void>;
  /** The app went off screen: everything pending is pushed and pulls stop. */
  hide(): void;
  /** Back on screen: pulls when it was away two minutes or more. */
  show(): void;
  /**
   * Pushes what waits, a document the full account refused included, then
   * pulls. Resolves when done, whatever the outcome (see status).
   */
  syncNow(): Promise<void>;
  /** Pushes what waits at once. */
  flush(): Promise<void>;
  /** Whether this screen has data of its own, which makes Join ask Bring or Use. */
  hasLocalData(): Promise<boolean>;
  /**
   * Makes the account (or carries on making it) and returns its code to
   * show. Nothing is sent until confirmCreate(). A setup key given here is
   * kept until the account exists, so carrying on sends it again. While a
   * create runs, another call gets the same promise. Create, confirm, join,
   * leave and delete run one at a time: each waits for another already
   * running, then looks at the state again.
   */
  create(options?: CreateOptions): Promise<string>;
  /**
   * The person has written the code down: everything on the screen is sent.
   * While it runs, another call gets the same promise.
   */
  confirmCreate(): Promise<void>;
  /** Checks a typed code with the service, without joining. */
  checkCode(input: string): Promise<CodeCheck>;
  /**
   * Joins the account, bringing this screen's data or using the account's.
   * The app then reloads. While a join runs, another call gets the same
   * promise. When the service could not be reached it rejects with
   * `offline` and carries on by itself, calling `onJoined` once it is done.
   * Resolves at once when a join carried on with this code has finished.
   */
  join(input: string, mode: JoinMode): Promise<void>;
  /** The account code, for Show account code. Undefined when signed out. */
  code(): string | undefined;
  /**
   * Forgets the account on this screen and keeps everything on it. While it
   * runs, another call gets the same promise.
   */
  leave(): Promise<void>;
  /**
   * Deletes the account from the service, then leaves. While it runs,
   * another call gets the same promise.
   */
  deleteAccount(): Promise<void>;
}

const PUSH_DELAY_MS = 3 * 1000;
/** Playback saves progress every 10 seconds, so this follows a pause or a stop. */
const WATCH_PUSH_DELAY_MS = 15 * 1000;
const FIRST_PULL_MS = 2 * 1000;
const AWAY_MS = 2 * 60 * 1000;
const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000];
/** Pushes again after a conflict at most this many times. */
const CONFLICT_ROUNDS = 3;
/** Pull answers cut short (`more`) are followed this many times in one sync at most. */
const MAX_PULL_PAGES = 20;

/** Steps of a create or join, saved as each is done. */
const CREATE_CONFIRMED = 1;
const JOIN_MARKED = 1;
const JOIN_ASIDE = 2;
const JOIN_APPLIED = 3;

/** A request that went wrong, and what to do about it. */
class Stop extends Error {
  readonly reason: PauseReason | 'gone' | 'denied';
  readonly retryAfterMs: number | undefined;
  readonly status: number | undefined;
  readonly error: string | undefined;

  constructor(
    reason: PauseReason | 'gone' | 'denied',
    details: { retryAfterMs?: number; status?: number; error?: string } = {},
  ) {
    super(reason);
    this.name = 'Stop';
    this.reason = reason;
    this.retryAfterMs = details.retryAfterMs;
    this.status = details.status;
    this.error = details.error;
  }
}

type TimerName = 'push' | 'watch' | 'pull' | 'first' | 'retry' | 'hold' | 'resume';

/** Why a document was not sent as it stands. */
type Refusal = 'too-big' | 'full';

/** Why every push waits for a while, the pulls going on. */
interface HeldPushes {
  reason: 'limit' | 'busy' | 'too-big';
  retryAfterMs: number | undefined;
}

interface Doc {
  name: string;
  base: DocumentBase;
  /** Edits not yet in `base`. */
  pend: Items;
  /** Written by a newer BannerTV: neither applied nor pushed over. */
  newer: boolean;
  /**
   * Refused with these edits over this version: too big for one body, or
   * the account is full. Not sealed or sent again until either changes, or,
   * when full, until room may have been made (retryFull).
   */
  refused?: { reason: Refusal; pend: Items; ver: number };
}

interface Watch {
  part: SyncPart;
  /** What the store held when last looked at, after the engine's own changes. */
  seen: Map<string, PartItem>;
  /** While adopt() runs, the store's changes are the engine's own, not edits. */
  adopting: number;
  /** Watched for edits, rather than only written to during a create or join. */
  live: boolean;
  off?: () => void;
}

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Times that are whole seconds: Trakt's always are, BannerTV's about once in a thousand. */
const wholeSecond = (time: number) => time % 1000 === 0;

/** A profile id that can name documents. */
const usableProfileId = (id: string) => documentKind(`p/${id}/list`) !== undefined;

function sameStatus(a: SyncStatus, b: SyncStatus): boolean {
  return a.state === b.state && a.reason === b.reason && a.lastSync === b.lastSync;
}

/**
 * The sync engine (ADR 0006). It turns store changes into items, keeps
 * them in `sync/pend` until a push carries them, pulls the account's
 * documents, merges, and makes the stores match through their parts.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { crypto, transport, storage, clock, timers, accountParts } = options;
  const status = createStore<SyncStatus>(
    options.lastSync === undefined
      ? { state: 'off' }
      : { state: 'off', lastSync: options.lastSync },
  );

  let state: SyncState | undefined;
  let keys: AccountKeys | undefined;
  let active: ActiveProfile | undefined;
  let starting: Promise<void> | undefined;
  const docs = new Map<string, Doc>();
  const docLoads = new Map<string, Promise<Doc>>();
  const spareParts = new Map<string, readonly SyncPart[]>();
  let watches: Watch[] = [];
  let watching = false;

  let lastSync = options.lastSync;
  let syncing = false;
  /** Why the last sync failed as a whole, until one gets through. */
  let paused: PauseReason | undefined;
  let failures = 0;
  /** Why pushes wait while pulls go on: the service's daily limit, `busy`, or a request it refused for its size. */
  let holding: PauseReason | undefined;
  let pushFailures = 0;
  let pullMinutes = DEFAULT_PULL_MINUTES;
  let serviceChecked = false;
  let visible = true;
  let hiddenAt: number | undefined;
  let closing = false;

  /** Timers running, each with what cancels it. */
  const timersOn = new Map<TimerName, () => void>();

  const writes = new Map<
    string,
    { write: () => Promise<void>; dirty: boolean; done?: Promise<void> }
  >();

  function persist(key: string, write: () => Promise<void>): Promise<void> {
    if (closing) return Promise.resolve();
    let entry = writes.get(key);
    if (!entry) {
      entry = { write, dirty: false };
      writes.set(key, entry);
    }
    entry.write = write;
    entry.dirty = true;
    if (entry.done) return entry.done;
    const own = entry;
    const done = (async () => {
      while (own.dirty) {
        own.dirty = false;
        try {
          await own.write();
        } catch {
          // A full disk: the value lives on in memory and the next change saves it again.
        }
      }
      own.done = undefined;
    })();
    own.done = done;
    return done;
  }

  const savePendLater = (doc: Doc) =>
    persist(`pend/${doc.name}`, () => savePending(storage, doc.name, copyItems(doc.pend)));
  const saveBaseLater = (doc: Doc) =>
    persist(`base/${doc.name}`, () => saveBase(storage, doc.name, doc.base));

  function allWritten(): Promise<void> {
    const pending: Array<Promise<void>> = [];
    writes.forEach((entry) => {
      if (entry.done) pending.push(entry.done);
    });
    return Promise.all(pending).then(() => undefined);
  }

  async function saveState(next: SyncState): Promise<void> {
    state = next;
    await saveSyncState(storage, next);
    updateStatus();
  }

  function ensureDoc(name: string): Promise<Doc> {
    let load = docLoads.get(name);
    if (!load) {
      const loading = Promise.all([
        loadBase(storage, name, timers),
        loadPending(storage, name, timers),
      ]).then(
        ([base, pend]) => {
          const doc: Doc = { name, base, pend, newer: false };
          docs.set(name, doc);
          return doc;
        },
        (error: unknown) => {
          // Read again when next needed: taken as empty, edits waiting would be lost.
          if (docLoads.get(name) === loading) docLoads.delete(name);
          throw error;
        },
      );
      load = loading;
      docLoads.set(name, load);
    }
    return load;
  }

  function viewItem(doc: Doc, key: string): Item | undefined {
    return mergeItem(doc.name, key, itemAt(doc.base.items, key), itemAt(doc.pend, key));
  }

  function viewTime(doc: Doc, key: string): number | undefined {
    return viewItem(doc, key)?.t;
  }

  /** Whether the profile a document belongs to was deleted in the account. */
  function profileRemoved(document: string): boolean {
    const id = documentProfile(document);
    if (id === undefined || id === MAIN_PROFILE_ID) return false;
    const profiles = docs.get('profiles');
    const item = profiles && viewItem(profiles, id);
    return item !== undefined && isRemoval(item);
  }

  function pendingCount(doc: Doc): number {
    return Object.keys(doc.pend).length;
  }

  /** Whether a document is still as it was when refused: the same edits over the same version. */
  function stillRefused(doc: Doc): boolean {
    const refused = doc.refused;
    if (!refused || refused.ver !== doc.base.ver) return false;
    const keys = Object.keys(doc.pend);
    return (
      keys.length === Object.keys(refused.pend).length &&
      keys.every((key) => itemAt(refused.pend, key) === doc.pend[key])
    );
  }

  /**
   * Lets what the full account refused go once more, as room may have been
   * made since: on Sync now, at the end of a hold on pushes, and after a
   * pull that brought other screens' changes. A document too big for one
   * body stays refused: it cannot shrink by itself. True when one waited.
   */
  function retryFull(): boolean {
    let waited = false;
    docs.forEach((doc) => {
      if (!doc.refused || doc.refused.reason !== 'full') return;
      if (stillRefused(doc)) waited = true;
      doc.refused = undefined;
    });
    return waited;
  }

  /** Drops edits the account already carries or has beaten. */
  function clearBeaten(doc: Doc): void {
    let cleared = false;
    for (const key of Object.keys(doc.pend)) {
      if (!changesItem(doc.name, key, itemAt(doc.base.items, key), doc.pend[key]!)) {
        delete doc.pend[key];
        cleared = true;
      }
    }
    if (cleared) void savePendLater(doc);
  }

  function localProfileIds(): string[] {
    const ids = active ? [active.id] : [];
    for (const part of accountParts) {
      if (part.document !== 'profiles') continue;
      part.snapshot().forEach((item, key) => {
        if (key.indexOf('/') === -1 && usableProfileId(key) && ids.indexOf(key) === -1) {
          ids.push(key);
        }
      });
    }
    return ids;
  }

  function partsOf(profileId: string): readonly SyncPart[] {
    if (active && profileId === active.id) return active.parts;
    let parts = spareParts.get(profileId);
    if (!parts) {
      parts = options.profileParts(profileId);
      spareParts.set(profileId, parts);
    }
    return parts;
  }

  function activeDocuments(): string[] {
    const documents = ACCOUNT_DOCUMENTS.slice();
    if (active && usableProfileId(active.id)) {
      const own = profileDocuments(active.id);
      if (!profileRemoved(own[0]!)) documents.push(...own);
    }
    return documents;
  }

  async function loadParts(parts: readonly SyncPart[]): Promise<void> {
    await Promise.all(parts.map((part) => part.load()));
    await Promise.all(parts.map((part) => ensureDoc(part.document)));
  }

  /** Every part on the screen: the account's, the profile in use's, and the others'. */
  async function everyPart(profileIds?: readonly string[]): Promise<SyncPart[]> {
    await loadParts(accountParts);
    const parts = accountParts.slice();
    for (const id of profileIds ?? localProfileIds()) {
      if (usableProfileId(id)) parts.push(...partsOf(id));
    }
    await loadParts(parts);
    return parts;
  }

  function sameValue(part: SyncPart, key: string, a: unknown, b: unknown): boolean {
    const compare = part.compare ? (value: unknown) => part.compare!(key, value) : undefined;
    return compare ? canon(compare(a)) === canon(compare(b)) : canon(a) === canon(b);
  }

  function sameItem(part: SyncPart, key: string, a: PartItem, b: PartItem): boolean {
    return a.t === b.t && sameValue(part, key, a.v, b.v);
  }

  /**
   * Turns what changed in a store since `watch.seen` into edits. Keys in
   * `touched` were just written by the engine and are taken as they are now;
   * anything that went away as the engine wrote was the store trimming
   * itself, not a removal.
   */
  function diff(watch: Watch, next: Map<string, PartItem>, touched?: Set<string>): void {
    const part = watch.part;
    const doc = docs.get(part.document);
    if (!doc || doc.newer || profileRemoved(doc.name)) return;
    const kind = documentKind(doc.name);
    let edited = false;
    let restamped = false;
    next.forEach((item, key) => {
      if ((touched && touched.has(key)) || !partOwns(part, key) || item.trakt) return;
      const old = watch.seen.get(key);
      if (old === item || (old && sameItem(part, key, old, item))) return;
      const current = viewItem(doc, key);
      let edit: LiveItem = {
        t: item.t !== undefined ? item.t : clock.stamp(current?.t),
        v: item.v,
      };
      if (!changesItem(doc.name, key, current, edit)) {
        // A value the store just gave a time of its own (a title added back, progress saved)
        // loses only on time to an account item stamped ahead of this screen's clock. It goes
        // just after that item instead, and the store is given the same time.
        if (touched || item.t === undefined || !current || (old && old.t === item.t)) return;
        if (!isRemoval(current) && sameValue(part, key, current.v, item.v)) return;
        edit = { t: Math.max(item.t, current.t + 1), v: item.v };
        if (!changesItem(doc.name, key, current, edit)) return;
        restamped = true;
      }
      doc.pend[key] = edit;
      edited = true;
    });
    // Continue Watching sends no removals: a cleared live stream stays elsewhere until it ages out.
    if (!touched && kind !== 'watch') {
      watch.seen.forEach((old, key) => {
        if (next.has(key) || !partOwns(part, key)) return;
        if (kind === 'profiles' && key === MAIN_PROFILE_ID) return;
        const current = viewItem(doc, key);
        // A Trakt title taken away is the person's doing only if the account has the title too.
        if (old.trakt && (!current || isRemoval(current))) return;
        const removal: Item = { t: clock.stamp(current?.t), x: 1 };
        if (!changesItem(doc.name, key, current, removal)) return;
        doc.pend[key] = removal;
        edited = true;
      });
    }
    if (!edited) return;
    void savePendLater(doc);
    schedulePush(kind === 'watch');
    updateStatus();
    if (restamped) {
      // After the store has told everyone of the change that is being looked at now.
      void Promise.resolve().then(() => {
        if (watches.indexOf(watch) !== -1) return apply(watch);
      });
    }
  }

  /**
   * Turns what changed in a store while the engine was not watching it (a
   * build without sync, the app closed before its push) into edits, by
   * diffing the store against what it held when it last matched the account.
   * A key the account has never had is the store's own and goes. A value the
   * account holds otherwise goes only when the store had taken every change
   * the account brought (base.apply not set): until then the account's is the
   * newer, and apply() brings it. Of what the store lacks, only an addon is
   * taken for a removal: elsewhere a store trims, or never had a key at all.
   */
  function catchUp(watch: Watch): void {
    const part = watch.part;
    const doc = docs.get(part.document);
    if (!doc) return;
    // Never pulled or pushed here, it says nothing of what the store matched. The account's own
    // documents exist from its create on, so are left; a profile's may never have been sent.
    const unknown = doc.base.ver === 0;
    if (unknown && documentProfile(doc.name) === undefined) return;
    const view = mergeItems(doc.name, doc.base.items, doc.pend);
    const taken = !unapplied(doc);
    const here = watch.seen;
    const was = new Map<string, PartItem>();
    here.forEach((item, key) => {
      // Then only a value with a time of its own goes: it merges by that time, which a
      // default stamped now would not.
      if (unknown && item.t === undefined) {
        was.set(key, item);
        return;
      }
      const current = itemAt(view, key);
      if (!current) return;
      const same = !isRemoval(current) && sameValue(part, key, current.v, item.v);
      // A value with a time of its own no newer than the account's is not a later edit.
      const older = item.t !== undefined && item.t <= current.t;
      if (same || older || !taken) was.set(key, item);
    });
    if (taken && doc.name === 'addons') {
      for (const key of Object.keys(view)) {
        const current = view[key]!;
        if (here.has(key) || isRemoval(current) || !partOwns(part, key)) continue;
        was.set(key, { t: current.t, v: current.v });
      }
    }
    watch.seen = was;
    diff(watch, here);
    watch.seen = here;
  }

  function capture(watch: Watch): void {
    if (watch.adopting > 0 || !watching || closing) return;
    const next = watch.part.snapshot();
    diff(watch, next);
    watch.seen = next;
  }

  /**
   * Makes a store match the account (ADR 0006, decision 6): present items
   * are written, removed ones deleted, and keys the account does not know
   * are left, unless `clear` (joining with Use) takes away everything of the
   * person's own that the account lacks. Trakt's items give way only to
   * newer account items. Resolves true once the store matches, or had
   * nothing to take; false when it could not take the change.
   */
  async function apply(watch: Watch, clear = false): Promise<boolean> {
    const part = watch.part;
    const doc = docs.get(part.document);
    if (!doc || doc.newer) return false;
    const view = mergeItems(doc.name, doc.base.items, doc.pend);
    const here = part.snapshot();
    const set = new Map<string, LiveItem>();
    const remove: string[] = [];
    for (const key of Object.keys(view)) {
      if (!partOwns(part, key)) continue;
      const item = view[key]!;
      const mine = here.get(key);
      if (mine && mine.trakt && mine.t !== undefined && item.t <= mine.t) continue;
      if (isRemoval(item)) {
        if (mine) remove.push(key);
        continue;
      }
      if (mine && (mine.t === undefined || mine.t === item.t) && canon(mine.v) === canon(item.v)) {
        continue;
      }
      set.set(key, item);
    }
    if (clear) {
      here.forEach((mine, key) => {
        if (!mine.trakt && !hasItem(view, key) && partOwns(part, key)) remove.push(key);
      });
    }
    if (set.size === 0 && remove.length === 0) return true;
    const change: PartChange = clear ? { set, remove, reset: true } : { set, remove };
    change.account = (key) => {
      const item = partOwns(part, key) ? itemAt(view, key) : undefined;
      return item && !isRemoval(item) ? item : undefined;
    };
    // A part makes its whole change before adopt() returns (SyncPart.adopt), so the store
    // as it is just after is what the engine wrote, trimming included. What changes while
    // the store then saves is the person's, and is an edit like any other.
    let adopted: Promise<void>;
    watch.adopting += 1;
    try {
      adopted = part.adopt(change);
    } catch (error) {
      adopted = Promise.reject(error);
    } finally {
      watch.adopting -= 1;
    }
    const next = part.snapshot();
    if (watch.live && watching) {
      const touched = new Set(remove);
      set.forEach((item, key) => touched.add(key));
      diff(watch, next, touched);
    }
    watch.seen = next;
    try {
      await adopted;
      return true;
    } catch {
      // A store that cannot take the change keeps what it had; the next sync tries again.
      return false;
    }
  }

  /** Not yet taken by every store: changed since the stores last matched it. */
  const unapplied = (doc: Doc) => doc.base.apply === true;

  /**
   * Makes the stores match the documents `only` picks, or all of them. A
   * document every store took is no longer marked; one a store could not
   * take stays marked, so the next sync tries again.
   */
  async function applyActive(only?: (doc: Doc) => boolean): Promise<void> {
    const results = new Map<Doc, { base: DocumentBase; taken: boolean }>();
    for (const watch of watches) {
      const doc = docs.get(watch.part.document);
      if (!doc || (only && !only(doc))) continue;
      let result = results.get(doc);
      if (!result) {
        result = { base: doc.base, taken: true };
        results.set(doc, result);
      }
      if (!(await apply(watch))) result.taken = false;
    }
    results.forEach((result, doc) => {
      if (!result.taken || doc.base !== result.base || !doc.base.apply) return;
      doc.base = { ver: doc.base.ver, at: doc.base.at, items: doc.base.items };
      void saveBaseLater(doc);
    });
  }

  async function markTrakt(parts: readonly SyncPart[]): Promise<void> {
    for (const part of parts) {
      if (!part.markTrakt) continue;
      const keys: string[] = [];
      part.snapshot().forEach((item, key) => {
        if (!item.trakt && item.t !== undefined && wholeSecond(item.t)) keys.push(key);
      });
      if (keys.length > 0) await part.markTrakt(keys);
    }
  }

  /**
   * Puts everything the parts hold into `sync/pend`, as at create or Bring.
   * `keep` says which items go: by default all of them.
   */
  async function seed(
    parts: readonly SyncPart[],
    keep: (doc: Doc, key: string, item: PartItem | undefined) => boolean = () => true,
  ): Promise<void> {
    const touched = new Set<Doc>();
    for (const part of parts) {
      const doc = await ensureDoc(part.document);
      const put = (key: string, edit: Item) => {
        if (!changesItem(doc.name, key, viewItem(doc, key), edit)) return;
        doc.pend[key] = edit;
        touched.add(doc);
      };
      part.snapshot().forEach((item, key) => {
        if (item.trakt || !partOwns(part, key) || !keep(doc, key, item)) return;
        put(key, { t: item.t !== undefined ? item.t : clock.stamp(viewTime(doc, key)), v: item.v });
      });
      // A default addon removed here stays removed on screens that join later.
      for (const key of part.removedDefaults ? part.removedDefaults() : []) {
        if (keep(doc, key, undefined)) put(key, { t: clock.stamp(viewTime(doc, key)), x: 1 });
      }
    }
    await Promise.all(Array.from(touched).map(savePendLater));
  }

  function signed(): { account: string; auth: string } {
    return { account: keys!.accountId, auth: keys!.auth };
  }

  async function send(path: string, body: unknown): Promise<unknown> {
    const sentAt = clock.local();
    let answer;
    try {
      answer = await transport.post(path, body);
    } catch {
      throw new Stop('offline');
    }
    const now = answerTime(answer.body);
    if (now !== undefined) clock.observe(now, sentAt);
    if (answer.status === 200 || answer.status === 201) return answer.body;
    const refusal = readRefusal(answer.body);
    const details = { status: answer.status, error: refusal.error };
    if (answer.status === 401) throw new Stop('denied', details);
    if (answer.status === 409 && refusal.error === 'epoch') throw new Stop('gone', details);
    if (answer.status === 413) throw new Stop('too-big', details);
    if (answer.status === 429) {
      throw new Stop('limit', { ...details, retryAfterMs: (refusal.retryAfter ?? 0) * 1000 });
    }
    throw new Stop('offline', details);
  }

  async function checkEpoch(epoch: string): Promise<void> {
    if (!state) throw new Stop('gone');
    if (state.epoch === undefined) await saveState({ ...state, epoch });
    else if (state.epoch !== epoch) throw new Stop('gone');
  }

  /** Takes a version of a document from a pull. True when it changed what this screen knows. */
  async function takeVersion(doc: Doc, wire: { ver: number; at: number; body: string }) {
    // Never back to a version older than one already seen.
    if (wire.ver <= doc.base.ver) return false;
    let items: Items;
    try {
      items = await openDocument(crypto, keys!, doc.name, wire.ver, wire.body);
    } catch (error) {
      if (error instanceof SealError && error.kind === 'newer') {
        doc.newer = true;
        return false;
      }
      // Nothing in it can be read, by this screen or any other: the next push writes over it.
      doc.base = { ...doc.base, ver: wire.ver, at: wire.at };
      void saveBaseLater(doc);
      return false;
    }
    doc.newer = false;
    const merged = mergeItems(doc.name, doc.base.items, clampItems(items, wire.at));
    doc.base = {
      ver: wire.ver,
      at: wire.at,
      items: tidyItems(doc.name, merged, clock.now()),
      apply: true,
    };
    void saveBaseLater(doc);
    return true;
  }

  /** Pulls documents and merges them into what this screen knows. Returns those that changed. */
  async function pull(documents: readonly string[]): Promise<Set<Doc>> {
    const changed = new Set<Doc>();
    const records = await Promise.all(documents.map(ensureDoc));
    const named = new Map<string, Doc>();
    const names = await Promise.all(records.map((doc) => wireName(crypto, keys!, doc.name)));
    records.forEach((doc, index) => named.set(names[index]!, doc));
    let want = names;
    for (let page = 0; page < MAX_PULL_PAGES && want.length > 0; page++) {
      const have: { [name: string]: number } = Object.create(null);
      for (const name of want) {
        const ver = named.get(name)!.base.ver;
        if (ver > 0) have[name] = ver;
      }
      const answer = readPullAnswer(
        await send('/v1/pull', { ...signed(), epoch: state!.epoch, have, want }),
      );
      if (!answer) throw new Stop('offline');
      await checkEpoch(answer.epoch);
      for (const name of want) {
        const doc = named.get(name)!;
        const wire = answer.docs.get(name);
        if (wire) {
          if (await takeVersion(doc, wire)) changed.add(doc);
        } else if (!answer.vers.has(name) && doc.base.ver > 0) {
          // No longer on the service: the next push starts it again.
          doc.base = { ...doc.base, ver: 0, at: 0 };
          void saveBaseLater(doc);
        }
      }
      if (!answer.more) break;
      want = want.filter((name) => {
        const ver = answer.vers.get(name);
        const doc = named.get(name)!;
        return !answer.docs.has(name) && !doc.newer && ver !== undefined && ver > doc.base.ver;
      });
    }
    records.forEach(clearBeaten);
    return changed;
  }

  interface Sealed {
    doc: Doc;
    name: string;
    base: number;
    body: string;
    items: Items;
    pend: Items;
  }

  function pushable(): Doc[] {
    const ready: Doc[] = [];
    docs.forEach((doc) => {
      if (pendingCount(doc) === 0 || doc.newer || profileRemoved(doc.name)) return;
      if (!stillRefused(doc)) ready.push(doc);
    });
    return ready;
  }

  /** Pushes each document once. Returns those someone else wrote first. */
  async function pushOnce(ready: Doc[]): Promise<Doc[]> {
    const now = clock.now();
    const sealed: Sealed[] = [];
    for (const doc of ready) {
      // Exactly the edits sealed here leave sync/pend once the push is done: one made while
      // sealing waits for the next push.
      const pend = copyItems(doc.pend);
      const base = doc.base.ver;
      const items = tidyItems(doc.name, mergeItems(doc.name, doc.base.items, pend), now);
      const body = await sealDocument(crypto, keys!, doc.name, base + 1, items);
      if (body.length > WIRE_LIMITS.bodyChars) {
        // The rest still go, and this one is not sealed again until it changes.
        doc.refused = { reason: 'too-big', pend, ver: base };
        continue;
      }
      const name = await wireName(crypto, keys!, doc.name);
      sealed.push({ doc, name, base, body, items, pend });
    }
    const batches: Sealed[][] = [];
    let batch: Sealed[] = [];
    let chars = 0;
    for (const item of sealed) {
      if (batch.length === WIRE_LIMITS.puts || chars + item.body.length > WIRE_LIMITS.bodyChars) {
        batches.push(batch);
        batch = [];
        chars = 0;
      }
      batch.push(item);
      chars += item.body.length;
    }
    if (batch.length > 0) batches.push(batch);
    const conflicted: Doc[] = [];
    for (const put of batches) {
      const answer = readPushAnswer(
        await send('/v1/push', {
          ...signed(),
          epoch: state!.epoch,
          put: put.map((item) => ({ name: item.name, base: item.base, body: item.body })),
        }),
      );
      if (!answer) throw new Stop('offline');
      await checkEpoch(answer.epoch);
      const sent = (name: string) => put.filter((candidate) => candidate.name === name)[0];
      for (const done of answer.done) {
        const item = sent(done.name);
        if (!item) continue;
        const doc = item.doc;
        doc.base = {
          ver: done.ver,
          at: done.at,
          items: clampItems(item.items, done.at),
          apply: true,
        };
        doc.refused = undefined;
        // Edits made while the push was out wait for the next one.
        for (const key of Object.keys(item.pend)) {
          if (itemAt(doc.pend, key) === item.pend[key]) delete doc.pend[key];
        }
        void saveBaseLater(doc);
        void savePendLater(doc);
      }
      for (const name of answer.conflicts) {
        const item = sent(name);
        if (item) conflicted.push(item.doc);
      }
      for (const name of answer.full) {
        const item = sent(name);
        // The account is at its limit: this one waits until it changes, and the rest still go.
        if (item) item.doc.refused = { reason: 'full', pend: item.pend, ver: item.base };
      }
    }
    return conflicted;
  }

  /** Pushes what waits; a conflict pulls, merges and pushes again, three rounds at most. */
  async function push(): Promise<void> {
    for (let round = 0; ; round++) {
      const ready = pushable();
      if (ready.length === 0) return;
      const conflicted = await pushOnce(ready);
      if (conflicted.length === 0) return;
      if (round === CONFLICT_ROUNDS) throw new Stop('busy');
      await pull(conflicted.map((doc) => doc.name));
    }
  }

  /** A refusal that concerns only what this screen sends: what other screens sent still comes. */
  function sendingOnly(error: unknown): HeldPushes | undefined {
    if (!(error instanceof Stop)) return undefined;
    const reason = error.reason;
    return reason === 'limit' || reason === 'busy' || reason === 'too-big'
      ? { reason, retryAfterMs: error.retryAfterMs }
      : undefined;
  }

  let wantPush = false;
  let wantPull = false;
  let running: Promise<void> | undefined;
  let appliedOnce = false;

  function canRun(): boolean {
    return !closing && watching && state !== undefined && state.phase === 'ready';
  }

  function request(push: boolean, pull: boolean): Promise<void> {
    if (!canRun()) return Promise.resolve();
    // While pushes wait, only pulls go.
    wantPush = wantPush || (push && !holding);
    wantPull = wantPull || pull;
    if (!wantPush && !wantPull) return running ?? Promise.resolve();
    if (!running) running = drain();
    return running;
  }

  async function drain(): Promise<void> {
    try {
      while ((wantPush || wantPull) && canRun()) {
        const pushing = wantPush;
        const pulling = wantPull;
        wantPush = false;
        wantPull = false;
        await runOnce(pushing, pulling);
      }
    } finally {
      running = undefined;
      wantPush = false;
      wantPull = false;
    }
  }

  async function runOnce(pushing: boolean, pulling: boolean): Promise<void> {
    syncing = true;
    updateStatus();
    try {
      if (!serviceChecked) {
        serviceChecked = true;
        const service = await checkSyncService(transport, clock);
        if (service && service.pullMinutes !== pullMinutes) {
          pullMinutes = service.pullMinutes;
          if (timersOn.has('pull')) startPulls();
        }
      }
      // What an earlier sync took in and a store did not, the sync failing or the store refusing.
      await applyActive(unapplied);
      let held: HeldPushes | undefined;
      if (pushing && !holding) {
        try {
          await push();
          pushFailures = 0;
        } catch (error) {
          held = sendingOnly(error);
          if (!held) throw error;
        }
      }
      // Pushes held back stop only what this screen sends: what other screens sent still comes.
      const pullNow = pulling || held !== undefined;
      const changed = pullNow ? await pull(activeDocuments()) : undefined;
      if (pullNow && !appliedOnce) {
        // The first pull of a launch makes the stores match all of it: a profile not in use then catches up.
        appliedOnce = true;
        await applyActive();
      } else {
        await applyActive(unapplied);
      }
      failures = 0;
      paused = undefined;
      lastSync = clock.local();
      cancel('retry');
      if (!timersOn.has('pull')) startPulls();
      if (held) holdPushes(held);
      // Other screens' changes may have made room: what the full account refused goes once more.
      else if (changed && changed.size > 0 && !holding && retryFull()) wantPush = true;
    } catch (error) {
      await failed(error);
    } finally {
      syncing = false;
      updateStatus();
    }
  }

  /** Pushes wait, the regular pulls going on: as long as the service asks, or backing off. */
  function holdPushes(held: HeldPushes): void {
    pushFailures += 1;
    holding = held.reason;
    const delay =
      held.reason === 'limit' && held.retryAfterMs
        ? Math.max(held.retryAfterMs, BACKOFF_MS[0]!)
        : BACKOFF_MS[Math.min(pushFailures, BACKOFF_MS.length) - 1]!;
    after('hold', delay, () => {
      holding = undefined;
      retryFull();
      updateStatus();
      void request(true, false);
    });
  }

  /** Pushes go again at once, except while the service asked for quiet. Ending a hold retries what was full. */
  function releasePushes(): void {
    if (holding === 'limit') return;
    if (holding) retryFull();
    holding = undefined;
    cancel('hold');
  }

  async function failed(error: unknown): Promise<void> {
    const stop = error instanceof Stop ? error : new Stop('offline');
    if (stop.reason === 'gone' || stop.reason === 'denied') {
      await becomeGone();
      return;
    }
    failures += 1;
    paused = stop.reason;
    // The retry pulls too; regular pulls start again once one gets through.
    cancel('pull');
    const delay =
      stop.reason === 'limit' && stop.retryAfterMs
        ? Math.max(stop.retryAfterMs, BACKOFF_MS[0]!)
        : BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!;
    after('retry', delay, () => void request(true, true));
  }

  async function becomeGone(): Promise<void> {
    stopWatching();
    if (state && state.phase !== 'gone') {
      try {
        await saveState({ v: 1, code: state.code, accountId: state.accountId, phase: 'gone' });
      } catch {
        // Found again at the next pull.
      }
    }
    updateStatus();
  }

  function cancel(name: TimerName): void {
    const stop = timersOn.get(name);
    if (!stop) return;
    stop();
    timersOn.delete(name);
  }

  function after(name: TimerName, ms: number, run: () => void): void {
    cancel(name);
    timersOn.set(
      name,
      timers.after(ms, () => {
        timersOn.delete(name);
        run();
      }),
    );
  }

  /** While backing off, the retry carries everything. */
  const backingOff = () => timersOn.has('retry');

  /** Three seconds after the last edit, or fifteen after the last progress save. */
  function schedulePush(watchEdit: boolean): void {
    after(watchEdit ? 'watch' : 'push', watchEdit ? WATCH_PUSH_DELAY_MS : PUSH_DELAY_MS, () => {
      if (!backingOff()) void request(true, false);
    });
  }

  function startPulls(): void {
    cancel('pull');
    if (!visible || !watching) return;
    timersOn.set(
      'pull',
      timers.every(pullMinutes * 60 * 1000, () => {
        if (!backingOff()) void request(false, true);
      }),
    );
  }

  function updateStatus(): void {
    let next: SyncStatus;
    if (!state) next = { state: 'off' };
    else if (state.phase === 'gone') next = { state: 'gone' };
    else if (state.phase !== 'ready') next = { state: 'setup' };
    else if (syncing) next = { state: 'syncing' };
    else if (paused) next = { state: 'paused', reason: paused };
    else if (holding) next = { state: 'paused', reason: holding };
    else {
      let newer = false;
      let refused: Refusal | undefined;
      let waiting = false;
      for (const doc of Array.from(docs.values())) {
        if (doc.newer) newer = true;
        else if (pendingCount(doc) === 0 || profileRemoved(doc.name)) continue;
        else if (stillRefused(doc)) refused = refused ?? doc.refused!.reason;
        else waiting = true;
      }
      next = newer
        ? { state: 'paused', reason: 'update' }
        : refused
          ? { state: 'paused', reason: refused }
          : waiting
            ? { state: 'waiting' }
            : { state: 'idle' };
    }
    if (lastSync !== undefined) next.lastSync = lastSync;
    if (!sameStatus(status.get(), next)) status.set(next);
  }

  /**
   * Watches the stores. `catchingUp` (a launch, not a create or join, which
   * send what the screen holds themselves) first turns what changed while
   * nothing watched into edits.
   */
  async function begin(catchingUp = false): Promise<void> {
    if (watching || !active) return;
    const parts = accountParts.concat(active.parts);
    await loadParts(parts);
    // What other profiles left waiting is pushed too.
    for (const id of localProfileIds()) {
      if (usableProfileId(id)) await Promise.all(profileDocuments(id).map(ensureDoc));
    }
    watches = parts.map((part) => {
      const watch: Watch = { part, seen: part.snapshot(), adopting: 0, live: true };
      watch.off = part.subscribe(() => capture(watch));
      return watch;
    });
    watching = true;
    if (catchingUp) watches.forEach(catchUp);
    startPulls();
    updateStatus();
  }

  function stopWatching(): void {
    watches.forEach((watch) => watch.off?.());
    watches = [];
    watching = false;
    holding = undefined;
    (['push', 'watch', 'pull', 'first', 'retry', 'hold'] as const).forEach(cancel);
  }

  function scheduleFirstPull(): void {
    after('first', FIRST_PULL_MS, () => void request(true, true));
  }

  function setupError(error: unknown): SyncSetupError {
    if (error instanceof SyncSetupError) return error;
    if (error instanceof Stop && error.reason === 'denied') return new SyncSetupError('unknown');
    return new SyncSetupError('offline');
  }

  /**
   * Forgets the account on this screen: its code, documents and edits not
   * yet sent. The stores keep everything, and so does `sync-aside`.
   */
  async function forget(): Promise<void> {
    stopWatching();
    resuming = undefined;
    cancel('resume');
    closing = true;
    try {
      if (running) await running;
      await allWritten();
      await deleteSyncKeys(storage, SYNC_PREFIX, Array.from(docs.keys()));
    } finally {
      closing = false;
      state = undefined;
      keys = undefined;
      docs.clear();
      docLoads.clear();
      paused = undefined;
      failures = 0;
      pushFailures = 0;
      appliedOnce = false;
      serviceChecked = false;
      // Signed out, the stores go back to this screen's own clock.
      clock.reset();
      updateStatus();
    }
  }

  async function finishCreate(): Promise<void> {
    const parts = await everyPart();
    await markTrakt(parts);
    await seed(parts);
    await saveState({
      v: 1,
      code: state!.code,
      accountId: state!.accountId,
      epoch: state!.epoch,
      phase: 'ready',
    });
    await begin();
    appliedOnce = true;
    await request(true, false);
  }

  function liveProfiles(items: Items): string[] {
    return Object.keys(items).filter(
      (key) => key.indexOf('/') === -1 && usableProfileId(key) && !isRemoval(items[key]!),
    );
  }

  /** Whether the account already has an addon at the address of `value`. */
  function addonAt(doc: Doc, value: unknown): boolean {
    if (!isObject(value) || typeof value.u !== 'string') return false;
    for (const key of Object.keys(doc.base.items)) {
      const item = doc.base.items[key]!;
      if (key.indexOf('a/') === 0 && !isRemoval(item) && isObject(item.v) && item.v.u === value.u) {
        return true;
      }
    }
    return false;
  }

  async function writeAside(parts: readonly SyncPart[]): Promise<void> {
    const at = clock.local();
    const aside: SyncAside = { v: 1, at, until: asideUntil(at), documents: {} };
    for (const part of parts) {
      const list = aside.documents[part.document] ?? (aside.documents[part.document] = []);
      part.snapshot().forEach((item, key) => {
        if (!partOwns(part, key)) return;
        const kept: { v: unknown; t?: number; trakt?: true } = { v: item.v };
        if (item.t !== undefined) kept.t = item.t;
        if (item.trakt) kept.trakt = true;
        list.push([key, kept]);
      });
    }
    await storage.set(ASIDE_KEY, aside);
  }

  async function finishJoin(): Promise<void> {
    const mode = state!.mode ?? 'bring';
    // How far the join got, as saved: read at each step, so no step runs twice for one join.
    const step = () => state!.step ?? 0;
    await loadParts(accountParts);
    await pull(ACCOUNT_DOCUMENTS);
    const accountIds = liveProfiles(docs.get('profiles')!.base.items);
    if (accountIds.indexOf(MAIN_PROFILE_ID) === -1) accountIds.push(MAIN_PROFILE_ID);
    const localIds = localProfileIds().filter(usableProfileId);
    if (mode === 'bring' && step() < JOIN_APPLIED) {
      const all = accountIds.slice();
      localIds.forEach((id) => {
        if (all.indexOf(id) === -1) all.push(id);
      });
      if (all.length > MAX_PROFILES) throw new SyncSetupError('profiles');
    }
    const kept =
      mode === 'bring' ? localIds : localIds.filter((id) => accountIds.indexOf(id) !== -1);
    const documents: string[] = [];
    kept.forEach((id) => documents.push(...profileDocuments(id)));
    if (documents.length > 0) await pull(documents);
    const everything = await everyPart(localIds);
    const parts = await everyPart(kept);
    if (step() < JOIN_MARKED) {
      await markTrakt(everything);
      await saveState({ ...state!, step: JOIN_MARKED });
    }
    // The copy is made once, before anything changes: never over the one this join already made.
    if (mode === 'use' && step() < JOIN_ASIDE) {
      await writeAside(everything);
      await saveState({ ...state!, step: JOIN_ASIDE });
    }
    if (step() < JOIN_APPLIED) {
      if (mode === 'bring') {
        // The account's settings win where both have one; My List and Continue Watching keep their own times.
        await seed(parts, (doc, key, item) => {
          if (item && item.t !== undefined) return true;
          if (hasItem(doc.base.items, key)) return false;
          return !(doc.name === 'addons' && item && addonAt(doc, item.v));
        });
      }
      for (const part of parts) {
        await apply({ part, seen: new Map(), adopting: 0, live: false }, mode === 'use');
      }
      await saveState({ ...state!, step: JOIN_APPLIED });
    }
    await saveState({
      v: 1,
      code: state!.code,
      accountId: state!.accountId,
      epoch: state!.epoch,
      phase: 'ready',
    });
    await begin();
    appliedOnce = true;
    await request(true, false);
  }

  /**
   * A create or join interrupted at an earlier launch, or a join the person
   * started that could not reach the service, carried on until it gets through.
   */
  let resuming: { task: () => Promise<void>; done?: () => void } | undefined;

  function resume(task: () => Promise<void>, done?: () => void): void {
    resuming = { task, done };
    void carryOn();
  }

  /** As resume(), after the first wait of the backoff. */
  function resumeLater(task: () => Promise<void>, done?: () => void): void {
    resuming = { task, done };
    failures += 1;
    after('resume', BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!, () => {
      void carryOn();
    });
  }

  let carrying: Promise<void> | undefined;

  function carryOn(): Promise<void> {
    if (!carrying) {
      carrying = carryOnce().then(
        () => {
          carrying = undefined;
        },
        () => {
          carrying = undefined;
        },
      );
    }
    return carrying;
  }

  async function carryOnce(): Promise<void> {
    cancel('resume');
    const job = resuming;
    if (!job) return;
    try {
      await job.task();
      resuming = undefined;
      failures = 0;
      job.done?.();
    } catch (error) {
      if (setupError(error).problem === 'offline') {
        failures += 1;
        after('resume', BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!, () => {
          void carryOn();
        });
        return;
      }
      // The code no longer works, or Bring no longer fits: this screen stays as it is, signed out.
      resuming = undefined;
      await forget();
    }
  }

  /**
   * A create, confirm, join, leave or delete the person started, while it
   * runs: a second call of the same gets the same promise.
   */
  interface Running<T> {
    promise?: Promise<T>;
  }
  const creating: Running<string> = {};
  const confirming: Running<void> = {};
  const joining: Running<void> = {};
  const leaving: Running<void> = {};
  const deleting: Running<void> = {};
  /** The last of them asked for, settled or not: they run one at a time, each after it. */
  let lastSetup: Promise<unknown> = Promise.resolve();

  function once<T>(slot: Running<T>, task: () => Promise<T>): Promise<T> {
    if (!slot.promise) {
      // Another one still running finishes first; this one then looks at the state it left.
      const promise = lastSetup.then(task).then(
        (value) => {
          slot.promise = undefined;
          return value;
        },
        (error: unknown) => {
          slot.promise = undefined;
          throw error;
        },
      );
      slot.promise = promise;
      lastSetup = promise.catch(() => undefined);
    }
    return slot.promise;
  }

  function flush(): Promise<void> {
    // A limit is the service asking for quiet: that wait is kept.
    if (paused !== 'limit') cancel('retry');
    releasePushes();
    cancel('push');
    cancel('watch');
    return backingOff() ? Promise.resolve() : request(true, false);
  }

  /**
   * Waits for the start, and for a create or join being carried on, which
   * the person now takes over.
   */
  async function started(): Promise<void> {
    if (!starting) throw new SyncSetupError('not-started');
    try {
      await starting;
    } catch {
      throw new SyncSetupError('not-started');
    }
    if (carrying) await carrying;
    resuming = undefined;
    cancel('resume');
  }

  return {
    status: status.get,
    subscribe: status.subscribe,

    start(profile) {
      if (starting) return starting;
      active = profile;
      starting = (async () => {
        await expireAside(storage, clock.local());
        try {
          // A read that failed is not "no account": the start fails, and nothing is watched or changed.
          state = await loadSyncState(storage, timers);
          if (state) keys = await deriveAccountKeys(crypto, state.code);
          if (state && state.phase === 'ready') await begin(true);
        } catch (error) {
          // A document's edits or base unread: the screen says what it says when the state
          // itself could not be read, rather than In sync while nothing is watched.
          stopWatching();
          state = undefined;
          keys = undefined;
          docs.clear();
          docLoads.clear();
          updateStatus();
          throw error;
        }
        updateStatus();
        if (!state) return;
        if (state.phase === 'ready') {
          scheduleFirstPull();
        } else if (state.phase === 'creating' && state.step === CREATE_CONFIRMED) {
          resume(finishCreate);
        } else if (state.phase === 'joining') {
          resume(finishJoin, options.onJoined);
        }
      })();
      return starting;
    },

    hide() {
      if (!visible) return;
      visible = false;
      hiddenAt = clock.local();
      cancel('pull');
      void flush();
    },

    show() {
      if (visible) return;
      visible = true;
      const away = hiddenAt === undefined ? 0 : clock.local() - hiddenAt;
      hiddenAt = undefined;
      startPulls();
      if (away >= AWAY_MS && !backingOff()) void request(false, true);
    },

    syncNow() {
      if (resuming) return carryOn();
      cancel('retry');
      releasePushes();
      cancel('push');
      cancel('watch');
      retryFull();
      return request(true, true);
    },

    flush,

    async hasLocalData() {
      // Not alongside a create, confirm, join, leave or delete: they change what the screen holds.
      await lastSetup;
      await started();
      const parts = await everyPart();
      return parts.some((part) => (part.ownData ? part.ownData() : false));
    },

    create(options = {}) {
      return once(creating, async () => {
        await started();
        if (state && state.phase !== 'creating') throw new SyncSetupError('signed-in');
        if (!state) {
          const code = newAccountCode(crypto);
          keys = await deriveAccountKeys(crypto, code);
          const made: SyncState = { v: 1, code, accountId: keys.accountId, phase: 'creating' };
          if (options.key !== undefined) made.key = options.key;
          await saveState(made);
        } else if (
          state.epoch === undefined &&
          options.key !== undefined &&
          options.key !== state.key
        ) {
          await saveState({ ...state, key: options.key });
        }
        if (state!.epoch === undefined) {
          const body: { account: string; auth: string; key?: string } = signed();
          if (state!.key !== undefined) body.key = state!.key;
          let answer;
          try {
            answer = readCreateAnswer(await send('/v1/account/create', body));
          } catch (error) {
            if (
              error instanceof Stop &&
              (error.error === 'closed' || error.error === 'exists' || error.error === 'key')
            ) {
              await forget();
              throw new SyncSetupError(error.error);
            }
            throw new SyncSetupError('offline');
          }
          if (!answer) throw new SyncSetupError('offline');
          // The account exists: its setup key is not kept.
          const made: SyncState = { ...state!, epoch: answer.epoch };
          delete made.key;
          await saveState(made);
        }
        return state!.code;
      });
    },

    confirmCreate() {
      return once(confirming, async () => {
        await started();
        if (!state || state.phase !== 'creating' || state.epoch === undefined) {
          throw new SyncSetupError(
            state && state.phase !== 'creating' ? 'signed-in' : 'not-started',
          );
        }
        await saveState({ ...state, step: CREATE_CONFIRMED });
        try {
          await finishCreate();
        } catch (error) {
          throw setupError(error);
        }
      });
    },

    async checkCode(input) {
      const code = readAccountCode(input);
      if (!code) return 'invalid';
      const checking = await deriveAccountKeys(crypto, code);
      const sentAt = clock.local();
      try {
        const answer = await transport.post('/v1/pull', {
          account: checking.accountId,
          auth: checking.auth,
          have: {},
          want: [],
        });
        const now = answerTime(answer.body);
        if (now !== undefined) clock.observe(now, sentAt);
        if (answer.status === 200) return 'ok';
        return answer.status === 401 ? 'unknown' : 'offline';
      } catch {
        return 'offline';
      }
    },

    join(input, mode) {
      return once(joining, async () => {
        await started();
        const code = readAccountCode(input);
        if (!code) throw new SyncSetupError('invalid');
        // A join carried on with this code got there first.
        if (state && state.phase === 'ready' && state.code === code) return;
        if (state && !(state.phase === 'joining' && state.code === code)) {
          throw new SyncSetupError('signed-in');
        }
        if (!state) {
          keys = await deriveAccountKeys(crypto, code);
          await saveState({
            v: 1,
            code,
            accountId: keys.accountId,
            phase: 'joining',
            mode,
            step: 0,
          });
        }
        try {
          await finishJoin();
        } catch (error) {
          const problem = setupError(error);
          // Out of reach: it carries on by itself, as the screen says. Otherwise nothing has
          // changed on the screen yet, unless the join got past its checks.
          if (problem.problem === 'offline') resumeLater(finishJoin, options.onJoined);
          else await forget();
          throw problem;
        }
      });
    },

    code: () => state?.code,

    leave() {
      return once(leaving, forget);
    },

    deleteAccount() {
      return once(deleting, async () => {
        await started();
        if (!state || !keys) return;
        try {
          await send('/v1/account/delete', signed());
        } catch (error) {
          if (!(error instanceof Stop && error.reason === 'denied')) {
            throw new SyncSetupError('offline');
          }
        }
        await forget();
      });
    },
  };
}
