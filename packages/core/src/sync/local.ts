import type { KeyValueStore } from '../storage';
import { readAccountCode } from './code';
import { type Item, type Items, newItems, readItem } from './items';

/**
 * What the engine keeps in the device-wide key-value store, all under
 * `sync/` so that leaving the account forgets exactly this (ADR 0006,
 * "On screen"):
 *
 * - `sync/state`: the account code, its id and epoch, and how far a create
 *   or join got;
 * - `sync/base/<document>`: the account's version of a document as last seen;
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
  return state;
}

export async function loadSyncState(storage: KeyValueStore): Promise<SyncState | undefined> {
  try {
    return readSyncState(await storage.get(STATE_KEY));
  } catch {
    return undefined;
  }
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

export async function loadBase(storage: KeyValueStore, document: string): Promise<DocumentBase> {
  try {
    const saved = await storage.get(baseKey(document));
    if (!isObject(saved) || !isWhole(saved.ver) || !isWhole(saved.at)) return emptyBase();
    return { ver: saved.ver, at: saved.at, items: readPairs(saved.items) };
  } catch {
    return emptyBase();
  }
}

export function saveBase(
  storage: KeyValueStore,
  document: string,
  base: DocumentBase,
): Promise<void> {
  return storage.set(baseKey(document), {
    ver: base.ver,
    at: base.at,
    items: writeItems(base.items),
  });
}

export async function loadPending(storage: KeyValueStore, document: string): Promise<Items> {
  try {
    return readPairs(await storage.get(pendKey(document)));
  } catch {
    return newItems();
  }
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
