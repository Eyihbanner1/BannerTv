import { describe, expect, it } from 'vitest';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { newItems } from './items';
import {
  ASIDE_KEY,
  deleteSyncKeys,
  expireAside,
  loadBase,
  loadPending,
  readSyncState,
  saveBase,
  savePending,
} from './local';

const DAY = 24 * 60 * 60 * 1000;
const CODE = 'ABCDEFGHJKMNPQRSTUVW';

describe('readSyncState', () => {
  it('reads what was saved and refuses anything else', () => {
    const state = {
      v: 1,
      code: CODE,
      accountId: 'UkVdMmNwSTzmLeiw_tUFCA',
      epoch: 'e',
      phase: 'joining',
      mode: 'use',
      step: 2,
    };
    expect(readSyncState(state)).toEqual(state);
    expect(readSyncState({ ...state, code: 'abcd efgh jkmn pqrs tuvw' })!.code).toBe(CODE);
    expect(readSyncState({ ...state, mode: 'other', step: -1 })).toEqual({
      v: 1,
      code: CODE,
      accountId: 'UkVdMmNwSTzmLeiw_tUFCA',
      epoch: 'e',
      phase: 'joining',
    });
    expect(readSyncState({ ...state, v: 2 })).toBeUndefined();
    expect(readSyncState({ ...state, code: 'nope' })).toBeUndefined();
    expect(readSyncState({ ...state, phase: 'done' })).toBeUndefined();
    expect(readSyncState(null)).toBeUndefined();
  });
});

describe('bases and pending edits', () => {
  it('keep any key, __proto__ included, and drop what is not an item', async () => {
    const storage = memoryKeyValueStore();
    const items = newItems();
    items['__proto__' as string] = { t: 5, v: 'odd' };
    items['constructor' as string] = { t: 6, x: 1 };
    await saveBase(storage, 'p/main/list', { ver: 3, at: 99, items });
    const base = await loadBase(storage, 'p/main/list');
    expect(base.ver).toBe(3);
    expect(base.at).toBe(99);
    expect(Object.keys(base.items)).toEqual(['__proto__', 'constructor']);
    expect(base.items['__proto__' as string]).toEqual({ t: 5, v: 'odd' });
    expect(Object.getPrototypeOf(base.items)).toBeNull();

    await storage.set('sync/pend/p/main/list', [
      ['ok', { t: 1, v: 1 }],
      ['bad', { t: -1, v: 1 }],
      'x',
    ]);
    expect(Object.keys(await loadPending(storage, 'p/main/list'))).toEqual(['ok']);
    await savePending(storage, 'addons', newItems());
    expect(Object.keys(await loadPending(storage, 'addons'))).toEqual([]);
  });

  it('start again from nothing when unreadable', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('sync/base/profiles', { ver: 'two', at: 1, items: [] });
    expect((await loadBase(storage, 'profiles')).ver).toBe(0);
    const failing: KeyValueStore = {
      get: () => Promise.reject(new Error('IDB')),
      set: () => Promise.resolve(),
    };
    expect((await loadBase(failing, 'profiles')).ver).toBe(0);
    expect(Object.keys(await loadPending(failing, 'profiles'))).toEqual([]);
  });
});

describe('deleteSyncKeys', () => {
  it('deletes only what is under sync/', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('sync/state', 1);
    await storage.set('sync/base/profiles', 1);
    await storage.set('sync-aside', 1);
    await storage.set('library', 1);
    await expect(deleteSyncKeys(storage, '', [])).rejects.toThrow();
    await expect(deleteSyncKeys(storage, 'sync', [])).rejects.toThrow();
    await expect(deleteSyncKeys(storage, 'p/', [])).rejects.toThrow();
    expect(await storage.get('library')).toBe(1);
    await deleteSyncKeys(storage, 'sync/', []);
    expect(await storage.get('sync/state')).toBeUndefined();
    expect(await storage.get('sync/base/profiles')).toBeUndefined();
    expect(await storage.get('sync-aside')).toBe(1);
    expect(await storage.get('library')).toBe(1);
  });

  it('deletes the named documents one by one without deletePrefix', async () => {
    const memory = memoryKeyValueStore();
    const storage: KeyValueStore = { get: memory.get, set: memory.set, delete: memory.delete };
    await memory.set('sync/state', 1);
    await memory.set('sync/pend/p/main/list', 1);
    await memory.set('library', 1);
    await deleteSyncKeys(storage, 'sync/', ['p/main/list']);
    expect(await memory.get('sync/state')).toBeUndefined();
    expect(await memory.get('sync/pend/p/main/list')).toBeUndefined();
    expect(await memory.get('library')).toBe(1);
  });
});

describe('expireAside', () => {
  const NOW = Date.UTC(2026, 9, 1);

  it('keeps the copy for 30 days and then throws it away', async () => {
    const storage = memoryKeyValueStore();
    const aside = { v: 1, at: NOW - 29 * DAY, until: NOW + DAY, documents: {} };
    await storage.set(ASIDE_KEY, aside);
    await expireAside(storage, NOW);
    expect(await storage.get(ASIDE_KEY)).toEqual(aside);
    await expireAside(storage, NOW + DAY);
    expect(await storage.get(ASIDE_KEY)).toBeUndefined();
  });

  it('gives a copy dated in the future its 30 days from now', async () => {
    const storage = memoryKeyValueStore();
    await storage.set(ASIDE_KEY, { v: 1, at: NOW + 400 * DAY, until: NOW + 430 * DAY });
    await expireAside(storage, NOW);
    expect(await storage.get(ASIDE_KEY)).toMatchObject({ at: NOW, until: NOW + 30 * DAY });
  });
});
