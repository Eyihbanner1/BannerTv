import {
  createAccountClock,
  createStore,
  createSyncEngine,
  type KeyValueStore,
  type KidsRating,
  loadBase,
  type Profile,
  type ProfilesState,
  saveBase,
  type SyncEngine,
} from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeSyncService,
  manualTimers,
  webCryptoForTests,
} from '../../../../packages/core/src/sync/testing';
import type { ProfilesPartOptions } from './sync-parts';

/**
 * The app's profiles on screens in one account: the real engine over the
 * core's stand-in service, with profiles.ts and its localStorage where a
 * test needs a launch to read what the last one left.
 */

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

function memoryKv(): KeyValueStore & { keys(): string[] } {
  const map = new Map<string, unknown>();
  const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
  return {
    keys: () => Array.from(map.keys()),
    get: (key) => Promise.resolve(map.has(key) ? copy(map.get(key)) : undefined),
    set: (key, value) => {
      map.set(key, copy(value));
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    deletePrefix: (prefix) => {
      for (const key of Array.from(map.keys())) if (key.indexOf(prefix) === 0) map.delete(key);
      return Promise.resolve();
    },
  };
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

/** A launch of the app: profiles.ts and the parts read localStorage afresh. */
async function launch() {
  vi.resetModules();
  const profiles = await import('./profiles');
  const parts = await import('./sync-parts');
  return { ...profiles, ...parts };
}

type Launched = Awaited<ReturnType<typeof launch>>;

/** The profiles part as sync.ts gives it, over a launch's profiles.ts. */
function appPart(app: Launched) {
  return app.profilesPart({
    profiles: app.profiles,
    activeId: () => app.activeProfileId.get(),
    mainName: app.MAIN_NAME,
    holdDeletion: app.holdProfileDeletion,
    holdAside: app.holdProfileAside,
    holdKids: app.holdKidsChange,
    heldKids: app.heldKidsChange,
    hidden: app.setHiddenProfiles,
  });
}

/** Options for a part over a store of the test's own, holding nothing back. */
function plainOptions(profiles: ProfilesPartOptions['profiles'], active: string) {
  const options: ProfilesPartOptions = {
    profiles,
    activeId: () => active,
    mainName: 'Main',
    holdDeletion: () => undefined,
    holdAside: () => undefined,
    holdKids: () => undefined,
    heldKids: () => undefined,
    hidden: () => undefined,
  };
  return options;
}

function world() {
  let now = 1_700_000_000_000;
  const service = fakeSyncService({ now: () => now });
  const crypto = webCryptoForTests();
  const engine = (part: ReturnType<Launched['profilesPart']>, kv: KeyValueStore = memoryKv()) =>
    createSyncEngine({
      crypto,
      transport: service.transport,
      storage: kv,
      clock: createAccountClock({ now: () => now }),
      timers: manualTimers().timers,
      accountParts: [part],
      profileParts: () => [],
    });
  return {
    engine,
    later: (ms = 60_000) => (now += ms),
  };
}

/** Screen B, Main in use, which makes the account with `list` and changes it later. */
async function accountFrom(
  w: ReturnType<typeof world>,
  app: Launched,
  list: Profile[],
): Promise<{
  code: string;
  b: SyncEngine;
  profilesB: ReturnType<typeof createStore<ProfilesState>>;
}> {
  const profilesB = createStore<ProfilesState>({
    profiles: list,
    lastId: 'main',
    askAtLaunch: false,
  });
  const b = w.engine(app.profilesPart(plainOptions(profilesB, 'main')));
  await b.start({ id: 'main', parts: [] });
  const code = await b.create();
  await b.confirmCreate();
  return { code, b, profilesB };
}

function setKids(state: ProfilesState, id: string, kids: KidsRating | null): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((p) => {
      if (p.id !== id) return p;
      const next: Profile = { id: p.id, name: p.name, colour: p.colour };
      if (kids) next.kids = kids;
      return next;
    }),
  };
}

const MAIN: Profile = { id: 'main', name: 'Main', colour: 0 };

describe('a kids setting held for the profile in use', () => {
  /** Screen A opens `id` at launch (the picker off), in the account B made with the same profiles. */
  async function screenA(list: Profile[], id: string) {
    local.setItem(
      'bannertv.profiles',
      JSON.stringify({ profiles: list, lastId: id, askAtLaunch: false }),
    );
    const w = world();
    const app = await launch();
    const { code, b, profilesB } = await accountFrom(w, app, list);
    const kvA = memoryKv();
    const a = w.engine(appPart(app), kvA);
    await a.start({ id, parts: [] });
    await a.join(code, 'bring');
    /** Main on B changes the setting, and A pulls. */
    const change = async (kids: KidsRating | null) => {
      w.later();
      profilesB.set((s) => setKids(s, id, kids));
      await b.syncNow();
      w.later();
      await a.syncNow();
    };
    return { app, change, kvA };
  }

  it('is let go when the account changes back, so the next launch opens the profile as the account says', async () => {
    const list: Profile[] = [MAIN, { id: 'kid1', name: 'Kid', colour: 1, kids: 'U' }];
    const { app, change } = await screenA(list, 'kid1');
    expect(app.activeProfileId.get()).toBe('kid1');

    // On B, Main turns Kid's rating off by mistake, and A pulls: it waits for A's next launch.
    await change(null);
    expect(app.heldKidsChange('kid1')).toBe(null);
    expect(app.profiles.get().profiles[1]!.kids).toBe('U');
    // Main puts it back, and A pulls again: nothing waits any more.
    await change('U');
    expect(app.heldKidsChange('kid1')).toBeUndefined();
    expect(local.getItem('bannertv.syncHeld')).toBeNull();

    const next = await launch();
    expect(next.activeProfileId.get()).toBe('kid1');
    expect(next.profiles.get().profiles[1]!.kids).toBe('U');
    expect(next.isKidsProfile()).toBe(true);
  });

  it('the other way round, leaves a profile with no rating free at the next launch', async () => {
    const list: Profile[] = [MAIN, { id: 'ada1', name: 'Ada', colour: 2 }];
    const { app, change } = await screenA(list, 'ada1');

    await change('PG');
    expect(app.heldKidsChange('ada1')).toBe('PG');
    await change(null);
    expect(app.heldKidsChange('ada1')).toBeUndefined();

    const next = await launch();
    expect(next.profiles.get().profiles[1]!.kids).toBeUndefined();
    expect(next.isKidsProfile()).toBe(false);
  });

  it('still applies at the next launch what the account kept', async () => {
    const list: Profile[] = [MAIN, { id: 'kid1', name: 'Kid', colour: 1, kids: 'U' }];
    const { change, kvA } = await screenA(list, 'kid1');
    await change('12');

    const next = await launch();
    expect(next.profiles.get().profiles[1]!.kids).toBe('12');
    // The account still says 12: it stays, and nothing starts again.
    expect(next.confirmHeldKids((await loadBase(kvA, 'profiles')).items)).toBe(false);
    expect(next.profiles.get().profiles[1]!.kids).toBe('12');
    expect(local.getItem('bannertv.syncHeld')).toBeNull();
    expect((await launch()).profiles.get().profiles[1]!.kids).toBe('12');
  });

  it('is taken back at launch when the account it came from has changed back since', async () => {
    const list: Profile[] = [MAIN, { id: 'kid1', name: 'Kid', colour: 1, kids: 'U' }];
    const { change, kvA } = await screenA(list, 'kid1');
    await change(null);
    // The account went back to U and A saved it, but A stopped before its store was told.
    const base = await loadBase(kvA, 'profiles');
    base.items['kid1/kids'] = { t: base.items['kid1/kids']!.t + 1, v: 'U' };
    await saveBase(kvA, 'profiles', base);

    const next = await launch();
    expect(next.isKidsProfile()).toBe(false);
    // The check finds the account says U: the rating comes back, and the app starts again.
    expect(next.confirmHeldKids((await loadBase(kvA, 'profiles')).items)).toBe(true);
    expect(next.profiles.get().profiles[1]!.kids).toBe('U');
    expect(local.getItem('bannertv.syncHeld')).toBeNull();

    const restarted = await launch();
    expect(restarted.activeProfileId.get()).toBe('kid1');
    expect(restarted.isKidsProfile()).toBe(true);
  });

  it('stays when the account cannot be read, as it came from it', async () => {
    const list: Profile[] = [MAIN, { id: 'kid1', name: 'Kid', colour: 1, kids: 'U' }];
    const { change } = await screenA(list, 'kid1');
    await change(null);

    const next = await launch();
    expect(next.confirmHeldKids(undefined)).toBe(false);
    expect(next.isKidsProfile()).toBe(false);
  });
});

describe('six profiles at most', () => {
  const base: Profile[] = [
    MAIN,
    { id: 'pa', name: 'A', colour: 1 },
    { id: 'pb', name: 'B', colour: 1 },
    { id: 'pc', name: 'C', colour: 1 },
    { id: 'pd', name: 'D', colour: 1 },
  ];

  it('leaves off the same profile on every screen: the newest in the account', async () => {
    const w = world();
    const app = await launch();
    const screen = () => {
      const profiles = createStore<ProfilesState>({
        profiles: base.map((p) => ({ ...p })),
        lastId: 'main',
        askAtLaunch: true,
      });
      let writes = 0;
      profiles.subscribe(() => (writes += 1));
      let hidden = 0;
      const engine = w.engine(
        app.profilesPart({
          ...plainOptions(profiles, 'main'),
          hidden: (count) => (hidden = count),
        }),
      );
      return {
        profiles,
        engine,
        ids: () => profiles.get().profiles.map((p) => p.id),
        writes: () => writes,
        hidden: () => hidden,
      };
    };
    const a = screen();
    const b = screen();
    await a.engine.start({ id: 'main', parts: [] });
    await b.engine.start({ id: 'main', parts: [] });
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    await b.engine.join(code, 'bring');

    // Each screen adds a sixth profile before it hears of the other's. A's is older.
    w.later(1000);
    a.profiles.set((s) => ({
      ...s,
      profiles: s.profiles.concat({ id: 'old5', name: 'Older', colour: 2 }),
    }));
    w.later();
    b.profiles.set((s) => ({
      ...s,
      profiles: s.profiles.concat({ id: 'new6', name: 'Newer', colour: 3 }),
    }));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    await b.engine.syncNow();

    const shown = ['main', 'pa', 'pb', 'pc', 'pd', 'old5'];
    expect(a.ids()).toEqual(shown);
    expect(b.ids()).toEqual(shown);
    expect(a.hidden()).toBe(1);
    expect(b.hidden()).toBe(1);

    // Each pull brings Newer again, and leaves it off again without writing the profiles.
    const writes = [a.writes(), b.writes()];
    w.later();
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect([a.writes(), b.writes()]).toEqual(writes);

    // Deleting one makes room: Newer shows on both.
    w.later();
    a.profiles.set((s) => ({ ...s, profiles: s.profiles.filter((p) => p.id !== 'pb') }));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(a.ids()).toEqual(['main', 'pa', 'pc', 'pd', 'old5', 'new6']);
    expect(b.ids()).toEqual(['main', 'pa', 'pc', 'pd', 'old5', 'new6']);
    expect(a.hidden()).toBe(0);
    expect(b.hidden()).toBe(0);
  });
});

describe('joining with Use', () => {
  it('takes this screen’s own profiles off the list and keeps their data and Trakt sign-in', async () => {
    const w = world();
    const app = await launch();
    const { code } = await accountFrom(w, app, [MAIN]);

    local.setItem(
      'bannertv.profiles',
      JSON.stringify({
        profiles: [MAIN, { id: 'dad', name: 'Dad', colour: 2 }],
        lastId: 'main',
        askAtLaunch: false,
      }),
    );
    const screen = await launch();
    const kv = memoryKv();
    await kv.set('p/dad/trakt', { tokens: { accessToken: 'x' } });
    await kv.set('p/dad/library-outbox', [{ add: 'tt9' }]);
    const engine = w.engine(appPart(screen), kv);
    await engine.start({ id: 'main', parts: [] });
    await engine.join(code, 'use');

    expect(screen.profiles.get().profiles.map((p) => p.id)).toEqual(['main']);
    // Nothing is held for deletion, so the next launch deletes nothing and signs Dad out of nothing.
    expect(screen.heldDeletions()).toEqual([]);
    expect(kv.keys()).toEqual(expect.arrayContaining(['p/dad/trakt', 'p/dad/library-outbox']));
    expect((await launch()).profiles.get().profiles.map((p) => p.id)).toEqual(['main']);
  });

  it('takes the profile in use off at the next launch, its data kept', async () => {
    const w = world();
    const app = await launch();
    const { code } = await accountFrom(w, app, [MAIN]);

    local.setItem(
      'bannertv.profiles',
      JSON.stringify({
        profiles: [MAIN, { id: 'dad', name: 'Dad', colour: 2 }],
        lastId: 'dad',
        askAtLaunch: false,
      }),
    );
    const screen = await launch();
    expect(screen.activeProfileId.get()).toBe('dad');
    const engine = w.engine(appPart(screen), memoryKv());
    await engine.start({ id: 'dad', parts: [] });
    await engine.join(code, 'use');

    expect(screen.profiles.get().profiles.map((p) => p.id)).toEqual(['main', 'dad']);
    const next = await launch();
    expect(next.profiles.get().profiles.map((p) => p.id)).toEqual(['main']);
    expect(next.activeProfileId.get()).toBe('main');
    expect(next.heldDeletions()).toEqual([]);
    expect(local.getItem('bannertv.syncHeld')).toBeNull();
  });
});
