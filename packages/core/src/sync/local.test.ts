import { describe, expect, it } from 'vitest';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { newItems } from './items';
import {
  ASIDE_KEY,
  deleteSyncKeys,
  expireAside,
  loadAside,
  loadBase,
  loadPending,
  loadSyncState,
  readAside,
  readSyncState,
  saveBase,
  savePending,
  saveSyncState,
} from './local';
import { manualTimers } from './testing';

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

  it('keeps the setup key only while a create waits for the service', () => {
    const creating = { v: 1, code: CODE, accountId: 'id', phase: 'creating', key: 'k' };
    expect(readSyncState(creating)!.key).toBe('k');
    expect(readSyncState({ ...creating, epoch: 'e' })!.key).toBeUndefined();
    expect(readSyncState({ ...creating, phase: 'ready' })!.key).toBeUndefined();
    expect(readSyncState({ ...creating, key: 5 })!.key).toBeUndefined();
  });
});

/** A store whose reads of `key` fail `times` times, then work. */
function flaky(key: string, times: number) {
  const storage = memoryKeyValueStore();
  let left = times;
  const reads = { count: 0 };
  const flakyStorage: KeyValueStore = {
    ...storage,
    get(name) {
      if (name !== key) return storage.get(name);
      reads.count += 1;
      if (left > 0) {
        left -= 1;
        return Promise.reject(new Error('IDB transaction aborted'));
      }
      return storage.get(name);
    },
  };
  return { storage, flaky: flakyStorage, reads };
}

describe('reading what the engine kept', () => {
  it('tells a missing state from one that could not be read', async () => {
    const time = manualTimers();
    expect(await loadSyncState(memoryKeyValueStore(), time.timers)).toBeUndefined();

    const broken = flaky('sync/state', Infinity);
    const failed = loadSyncState(broken.flaky, time.timers).catch((error: Error) => error);
    await time.advance(5000);
    expect(await failed).toBeInstanceOf(Error);
    // Tried again three times, a quarter of a second apart.
    expect(broken.reads.count).toBe(4);
  });

  it('tries a failed read again before giving up', async () => {
    const time = manualTimers();
    const once = flaky('sync/state', 1);
    await saveSyncState(once.storage, { v: 1, code: CODE, accountId: 'id', phase: 'ready' });
    const state = loadSyncState(once.flaky, time.timers);
    await time.advance(250);
    expect(await state).toMatchObject({ code: CODE, phase: 'ready' });

    // Without timers, at once.
    const again = flaky('sync/pend/addons', 2);
    const items = newItems();
    items.a = { t: 1, v: 1 };
    await savePending(again.storage, 'addons', items);
    expect(Object.keys(await loadPending(again.flaky, 'addons'))).toEqual(['a']);
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

  it('start again from nothing when what was saved is not a base', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('sync/base/profiles', { ver: 'two', at: 1, items: [] });
    expect((await loadBase(storage, 'profiles')).ver).toBe(0);
  });

  it('reject when they cannot be read, rather than read as empty', async () => {
    const failing: KeyValueStore = {
      get: () => Promise.reject(new Error('IDB')),
      set: () => Promise.resolve(),
    };
    await expect(loadBase(failing, 'profiles')).rejects.toThrow('IDB');
    await expect(loadPending(failing, 'profiles')).rejects.toThrow('IDB');
  });

  it('keep the mark of a base not every store has taken', async () => {
    const storage = memoryKeyValueStore();
    await saveBase(storage, 'addons', { ver: 2, at: 5, items: newItems(), apply: true });
    expect((await loadBase(storage, 'addons')).apply).toBe(true);
    await saveBase(storage, 'addons', { ver: 2, at: 5, items: newItems() });
    expect(await storage.get('sync/base/addons')).toEqual({ ver: 2, at: 5, items: [] });
    expect((await loadBase(storage, 'addons')).apply).toBeUndefined();
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

  it('keeps a copy being brought back past its 30 days, for the launch that finishes it', async () => {
    const storage = memoryKeyValueStore();
    const aside = { v: 1, at: NOW - 31 * DAY, until: NOW - DAY, documents: {}, back: true };
    await storage.set(ASIDE_KEY, aside);
    await expireAside(storage, NOW);
    expect(await storage.get(ASIDE_KEY)).toEqual(aside);
  });
});

describe('reading the set-aside copy', () => {
  it('keeps what is an item of the copy and drops what is not', () => {
    const saved = {
      v: 1,
      at: 1,
      until: 2,
      back: true,
      documents: {
        'p/main/list': [
          ['tt1', { v: { type: 'movie' }, t: 5 }],
          ['__proto__', { v: 1 }],
          ['tt2', { v: { type: 'movie' }, t: -1, trakt: true }],
          ['gone', { t: 5 }],
          [3, { v: 1 }],
          'nonsense',
        ],
        addons: 'nonsense',
      },
    };
    const aside = readAside(saved)!;
    expect(aside.back).toBe(true);
    expect(aside.documents['p/main/list']).toEqual([
      ['tt1', { v: { type: 'movie' }, t: 5 }],
      ['__proto__', { v: 1 }],
      ['tt2', { v: { type: 'movie' }, trakt: true }],
    ]);
    expect(Object.keys(aside.documents)).toEqual(['p/main/list']);
    expect(readAside({ ...saved, v: 2 })).toBeUndefined();
    expect(readAside({ ...saved, until: 'soon' })).toBeUndefined();
    expect(readAside(null)).toBeUndefined();
  });

  it('tells a copy that cannot be read from none', async () => {
    const storage = memoryKeyValueStore();
    expect(await loadAside(storage)).toBeUndefined();
    const failing: KeyValueStore = {
      ...storage,
      get: () => Promise.reject(new Error('IDB aborted')),
    };
    await expect(loadAside(failing)).rejects.toThrow('IDB aborted');
  });
});
