import { type KeyValueStore, memoryKeyValueStore, type Profile } from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOINED_KEY, markJoined, settleJoined } from './sync-joined';

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let local: MemoryStorage;

beforeEach(() => {
  local = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' } });
  vi.stubGlobal('history', { replaceState: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A launch of the app: profiles.ts reads localStorage afresh. */
async function launch() {
  vi.resetModules();
  return import('./profiles');
}

const MAIN: Profile = { id: 'main', name: 'Main', colour: 0 };
const GUEST: Profile = { id: 'guest4', name: 'Guest', colour: 1 };
const ADA: Profile = { id: 'ada001', name: 'Ada', colour: 2 };

/**
 * What the next launch does with the copy, as sync.ts runs it: `reloads`
 * counts the app starting again, `signedIn` the flag put back.
 */
async function settle(kv: KeyValueStore) {
  const app = await launch();
  let reloads = 0;
  let signedIn = false;
  const go = await settleJoined({
    kv,
    launch: app.launchSaved,
    restore: app.restoreSaved,
    signIn: () => (signedIn = true),
    reload: () => (reloads += 1),
  });
  return { app, go, reloads, signedIn, ids: () => app.profiles.get().profiles.map((p) => p.id) };
}

/** localStorage as a screen had it before joining, with Guest of its own and Main in use. */
function before(): Map<string, string> {
  local.setItem(
    'bannertv.profiles',
    JSON.stringify({ profiles: [MAIN, GUEST], lastId: 'main', askAtLaunch: false }),
  );
  return new Map(local.map);
}

/** A join with Use as the profiles part applies it: Guest goes, the account's Ada comes. */
async function joinWithUse(kv: KeyValueStore): Promise<void> {
  const app = await launch();
  app.profiles.set((s) => ({ ...s, profiles: [MAIN, ADA] }));
  await markJoined(kv, app.savedProfiles);
}

/** IndexedDB whose reads of the join's copy fail `times` times. */
function failingReads(kv: KeyValueStore, times: number): KeyValueStore {
  let left = times;
  return {
    ...kv,
    get(key) {
      if (key !== JOINED_KEY || left === 0) return kv.get(key);
      left -= 1;
      return Promise.reject(new Error('IDB transaction aborted'));
    },
  };
}

/** The reload read localStorage as it was before the join's last writes arrived. */
function loseWrites(old: Map<string, string>): void {
  local.map.clear();
  old.forEach((value, key) => local.map.set(key, value));
}

describe('a join’s reload', () => {
  it('reads what the join wrote and drops the copy', async () => {
    const kv = memoryKeyValueStore();
    before();
    await joinWithUse(kv);

    const next = await settle(kv);
    expect(next.go).toBe(true);
    expect(next.reloads).toBe(0);
    expect(next.signedIn).toBe(true);
    expect(next.ids()).toEqual(['main', 'ada001']);
    expect(await kv.get(JOINED_KEY)).toBeUndefined();
  });

  it('puts back what a reload lost, and starts the app again once to show it', async () => {
    const kv = memoryKeyValueStore();
    const old = before();
    await joinWithUse(kv);
    loseWrites(old);

    // The first paint had Guest, which the account never knew: localStorage gets the join's
    // profiles back and the app starts again, the copy kept until a launch reads them.
    const stale = await settle(kv);
    expect(stale.ids()).toEqual(['main', 'guest4']);
    expect(stale.go).toBe(false);
    expect(stale.reloads).toBe(1);
    expect(stale.signedIn).toBe(true);
    expect(await kv.get(JOINED_KEY)).toMatchObject({ again: true });

    const next = await settle(kv);
    expect(next.go).toBe(true);
    expect(next.reloads).toBe(0);
    expect(next.ids()).toEqual(['main', 'ada001']);
    expect(await kv.get(JOINED_KEY)).toBeUndefined();
  });

  it('puts them back in place when starting again lost them too', async () => {
    const kv = memoryKeyValueStore();
    const old = before();
    await joinWithUse(kv);
    loseWrites(old);
    await settle(kv);
    loseWrites(old);

    const again = await settle(kv);
    expect(again.go).toBe(true);
    expect(again.reloads).toBe(0);
    expect(again.ids()).toEqual(['main', 'ada001']);
    expect(JSON.parse(local.getItem('bannertv.profiles')!).profiles).toEqual([MAIN, ADA]);
    expect(await kv.get(JOINED_KEY)).toBeUndefined();
    expect((await launch()).profiles.get().profiles).toEqual([MAIN, ADA]);
  });

  it('puts back a profile set aside, which leaves at the launch after', async () => {
    const kv = memoryKeyValueStore();
    local.setItem(
      'bannertv.profiles',
      JSON.stringify({ profiles: [MAIN, GUEST], lastId: 'guest4', askAtLaunch: false }),
    );
    const old = new Map(local.map);
    const app = await launch();
    expect(app.activeProfileId.get()).toBe('guest4');
    // A join carried on by itself while Guest was in use: Use took Guest away.
    app.profiles.set((s) => ({ ...s, profiles: [MAIN, GUEST, ADA] }));
    app.holdProfileAside('guest4');
    await markJoined(kv, app.savedProfiles);
    loseWrites(old);

    expect((await settle(kv)).reloads).toBe(1);
    const next = await settle(kv);
    expect(next.ids()).toEqual(['main', 'ada001']);
    expect(next.app.heldDeletions()).toEqual([]);
  });

  it('tries a read that failed again, and still puts back what the reload lost', async () => {
    const kv = failingReads(memoryKeyValueStore(), 1);
    const old = before();
    await joinWithUse(kv);
    loseWrites(old);

    expect((await settle(kv)).reloads).toBe(1);
    const next = await settle(kv);
    expect(next.ids()).toEqual(['main', 'ada001']);
    expect(await kv.get(JOINED_KEY)).toBeUndefined();
  });

  it('drops the copy unread at a later launch when the one after the join could not read it', async () => {
    const disk = memoryKeyValueStore();
    const kv = failingReads(disk, 4);
    before();
    await joinWithUse(kv);
    const first = await settle(kv);
    expect(first.go).toBe(true);
    expect(first.reloads).toBe(0);
    expect(await disk.get(JOINED_KEY)).toBeDefined();
    // Meanwhile Guest is added again; the app then starts again, or is opened another day.
    first.app.profiles.set((s) => ({ ...s, profiles: [...s.profiles, GUEST] }));

    const later = await settle(kv);
    expect(later.go).toBe(true);
    expect(later.reloads).toBe(0);
    expect(later.signedIn).toBe(false);
    expect(later.ids()).toEqual(['main', 'ada001', 'guest4']);
    expect(await kv.get(JOINED_KEY)).toBeUndefined();
    expect((await launch()).profiles.get().profiles.map((p) => p.id)).toEqual([
      'main',
      'ada001',
      'guest4',
    ]);
  });

  it('puts back what a reload lost after bringing back on a screen without an account, and does not sign it in', async () => {
    const kv = memoryKeyValueStore();
    local.setItem(
      'bannertv.profiles',
      JSON.stringify({ profiles: [MAIN], lastId: 'main', askAtLaunch: false }),
    );
    const old = new Map(local.map);
    const app = await launch();
    // Bringing back what Use set aside put Guest back on the list.
    app.profiles.set((s) => ({ ...s, profiles: [MAIN, GUEST] }));
    await markJoined(kv, app.savedProfiles, false);
    loseWrites(old);

    const stale = await settle(kv);
    expect(stale.reloads).toBe(1);
    expect(stale.signedIn).toBe(false);
    const next = await settle(kv);
    expect(next.signedIn).toBe(false);
    expect(next.ids()).toEqual(['main', 'guest4']);
    expect(await kv.get(JOINED_KEY)).toBeUndefined();
  });

  it('leaves a launch with no join alone', async () => {
    const kv = memoryKeyValueStore();
    before();
    const next = await settle(kv);
    expect(next.go).toBe(true);
    expect(next.signedIn).toBe(false);
    expect(next.ids()).toEqual(['main', 'guest4']);
  });

  it('keeps the profiles as a sync changed them while the copy was written', async () => {
    const kv = memoryKeyValueStore();
    before();
    const app = await launch();
    app.profiles.set((s) => ({ ...s, profiles: [MAIN, ADA] }));
    const store: KeyValueStore = {
      ...kv,
      set: async (key, value) => {
        await kv.set(key, value);
        // A pull lands as the copy is written.
        if (!app.profiles.get().profiles.some((p) => p.name === 'Ada L')) {
          app.profiles.set((s) => ({ ...s, profiles: [MAIN, { ...ADA, name: 'Ada L' }] }));
        }
      },
    };
    await markJoined(store, app.savedProfiles);
    expect((await settle(kv)).app.profiles.get().profiles[1]!.name).toBe('Ada L');
  });
});
