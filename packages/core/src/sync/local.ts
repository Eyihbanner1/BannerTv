import type { KeyValueStore } from '../storage';
import type { Timers } from '../timers';
import { readAccountCode } from './code';
import { type Item, type Items, newItems, readItem } from './items';

/**
 * What the engine keeps in the device-wide key-value store, all under
 * `sync/` so that leaving the account forgets exactly this (ADR 0006,
 * "On the screen"):
 *
 * - `sync/state`: the account code, its id and epoch, how far a create or
 *   join got, and the setup key while a create waits for the service;
 * - `sync/base/<document>`: the account's version of a document as last
 *   seen, marked until every store has taken it;
 * - `sync/pend/<document>`: edits waiting for a push.
 *
 * `sync-aside`, the copy a join with Use keeps for 30 days, is outside
 * `sync/` on purpose: leaving keeps it.
 */
export const SYNC_PREFIX = 'sync/';
const STATE_KEY = 'sync/state';
export const ASIDE_KEY = 'sync-aside';
export const ASIDE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A read that failed is tried again this many times, this long apart, before it counts as failed. */
const READ_RETRIES = 3;
const READ_RETRY_MS = 250;

export type SyncPhase = 'creating' | 'joining' | 'ready' | 'gone';
export type JoinMode = 'bring' | 'use';

export interface SyncState {
  v: 1;
  /** The account code, 20 symbols. Never logged or sent anywhere. */
  code: string;
  accountId: string;
  /** Learnt from the first answer; a different one means the account was deleted. */
  epoch?: string;
  phase: SyncPhase;
  /** A join's choice. */
  mode?: JoinMode;
  /** How far a create or join got, so each step runs once when it carries on. */
  step?: number;
  /**
   * The service's setup key, while a create waits for the service: a create
   * carried on sends it again. Dropped once the account exists. Never logged.
   */
  key?: string;
}

const PHASES: readonly string[] = ['creating', 'joining', 'ready', 'gone'];

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Math.floor(value) === value && value >= 0 && value <= 9e15;

export function readSyncState(value: unknown): SyncState | undefined {
  if (!isObject(value) || value.v !== 1) return undefined;
  const code = isText(value.code) ? readAccountCode(value.code) : null;
  if (!code || !isText(value.accountId) || PHASES.indexOf(value.phase as string) === -1) {
    return undefined;
  }
  const state: SyncState = {
    v: 1,
    code,
    accountId: value.accountId,
    phase: value.phase as SyncPhase,
  };
  if (isText(value.epoch)) state.epoch = value.epoch;
  if (value.mode === 'bring' || value.mode === 'use') state.mode = value.mode;
  if (isWhole(value.step)) state.step = value.step;
  if (state.phase === 'creating' && state.epoch === undefined && typeof value.key === 'string') {
    state.key = value.key;
  }
  return state;
}

/**
 * Reads one of the engine's keys, telling a failed read from a missing key
 * (ADR 0006: a failed read must never look like empty data). A failed read
 * is tried again a few times, `timers` apart, and then rejects.
 */
async function readKey(storage: KeyValueStore, key: string, timers?: Timers): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await storage.get(key);
    } catch (error) {
      if (attempt === READ_RETRIES) throw error;
      if (timers) await new Promise<void>((resolve) => timers.after(READ_RETRY_MS, resolve));
    }
  }
}

/**
 * The saved state: undefined when there is none (no account here), or when
 * what was saved is not a state. Rejects when it cannot be read.
 */
export async function loadSyncState(
  storage: KeyValueStore,
  timers?: Timers,
): Promise<SyncState | undefined> {
  return readSyncState(await readKey(storage, STATE_KEY, timers));
}

/** Saves the state. Unlike the others this one must land, so a failure rejects. */
export function saveSyncState(storage: KeyValueStore, state: SyncState): Promise<void> {
  return storage.set(STATE_KEY, { ...state });
}

/** The account's version of a document as this screen last saw it. Version 0 is none yet. */
export interface DocumentBase {
  ver: number;
  /** Server milliseconds when that version was written. */
  at: number;
  items: Items;
  /** Set when it changed and not every store has taken it yet: the next sync makes them match. */
  apply?: true;
}

export const emptyBase = (): DocumentBase => ({ ver: 0, at: 0, items: newItems() });

/**
 * Items are saved as `[key, item]` pairs rather than as an object, so a key
 * such as `__proto__` survives whatever the store does with objects.
 */
function writeItems(items: Items): Array<[string, Item]> {
  return Object.keys(items).map((key): [string, Item] => [key, items[key]!]);
}

function readPairs(value: unknown): Items {
  const items = newItems();
  if (!Array.isArray(value)) return items;
  for (const pair of value) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue;
    const item = readItem(pair[1]);
    if (item) items[pair[0]] = item;
  }
  return items;
}

const baseKey = (document: string) => `${SYNC_PREFIX}base/${document}`;
const pendKey = (document: string) => `${SYNC_PREFIX}pend/${document}`;

/** The saved base, empty when there is none or it is not one. Rejects when it cannot be read. */
export async function loadBase(
  storage: KeyValueStore,
  document: string,
  timers?: Timers,
): Promise<DocumentBase> {
  const saved = await readKey(storage, baseKey(document), timers);
  if (!isObject(saved) || !isWhole(saved.ver) || !isWhole(saved.at)) return emptyBase();
  const base: DocumentBase = { ver: saved.ver, at: saved.at, items: readPairs(saved.items) };
  if (saved.apply === true) base.apply = true;
  return base;
}

export function saveBase(
  storage: KeyValueStore,
  document: string,
  base: DocumentBase,
): Promise<void> {
  const saved: { ver: number; at: number; items: Array<[string, Item]>; apply?: true } = {
    ver: base.ver,
    at: base.at,
    items: writeItems(base.items),
  };
  if (base.apply) saved.apply = true;
  return storage.set(baseKey(document), saved);
}

/** The saved edits, none when there are none. Rejects when they cannot be read. */
export async function loadPending(
  storage: KeyValueStore,
  document: string,
  timers?: Timers,
): Promise<Items> {
  return readPairs(await readKey(storage, pendKey(document), timers));
}

export function savePending(storage: KeyValueStore, document: string, items: Items): Promise<void> {
  return storage.set(pendKey(document), writeItems(items));
}

/**
 * Forgets the keys under `prefix`, which must be `sync/`: the profile's own
 * keys share the store (Main's have no prefix at all), so a mistake here
 * must not be able to delete anything else. Without deletePrefix, the state
 * and the named documents' keys are deleted one by one.
 */
export async function deleteSyncKeys(
  storage: KeyValueStore,
  prefix: string,
  documents: readonly string[],
): Promise<void> {
  if (prefix !== SYNC_PREFIX) throw new Error('Only the sync keys can be deleted here');
  if (storage.deletePrefix) {
    await storage.deletePrefix(prefix);
    return;
  }
  const keys = [STATE_KEY];
  for (const document of documents) keys.push(baseKey(document), pendKey(document));
  for (const key of keys) {
    if (storage.delete) await storage.delete(key);
    else await storage.set(key, undefined);
  }
}

/** What a join with Use kept of this screen: every part's items, by document. */
export interface SyncAside {
  v: 1;
  /** This screen's clock when it was kept, and when it may be thrown away. */
  at: number;
  until: number;
  documents: { [document: string]: Array<[string, { v: unknown; t?: number; trakt?: true }]> };
}

export function asideUntil(at: number): number {
  return at + ASIDE_DAYS * DAY_MS;
}

/** Throws the set-aside copy away once its 30 days are over. */
export async function expireAside(storage: KeyValueStore, now: number): Promise<void> {
  try {
    const saved = await storage.get(ASIDE_KEY);
    if (saved === undefined || saved === null) return;
    const until = isObject(saved) && typeof saved.until === 'number' ? saved.until : 0;
    // A copy dated in the future came from a clock that was wrong: it gets its 30 days from now.
    const at = isObject(saved) && typeof saved.at === 'number' ? saved.at : 0;
    if (at > now) {
      await storage.set(ASIDE_KEY, { ...(saved as object), at: now, until: asideUntil(now) });
      return;
    }
    if (now < until) return;
    if (storage.delete) await storage.delete(ASIDE_KEY);
    else await storage.set(ASIDE_KEY, undefined);
  } catch {
    // Tried again at the next launch.
  }
}
