import {
  createAccountClock,
  createSyncEngine,
  type KeyValueStore,
  SyncSetupError,
} from '@bannertv/core';
import { parseMetaPreview } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeSyncService,
  type manualTimers,
  webCryptoForTests,
} from '../../../../packages/core/src/sync/testing';

/**
 * data/sync.ts as the app runs it: the real engine, profiles and stores over
 * an IndexedDB and a service in memory. What lasts from one launch to the
 * next is `disk` and localStorage; each launch loads the modules afresh.
 */

const disk = vi.hoisted(() => ({
  values: new Map<string, string>(),
  /** Reads of sync/state that fail before one goes through. */
  failStateReads: 0,
}));

const net = vi.hoisted(() => ({
  service: undefined as unknown as ReturnType<typeof fakeSyncService>,
}));

const launched = vi.hoisted(() => ({
  timers: undefined as unknown as ReturnType<typeof manualTimers>,
  /** What reloadWhenSafe was given, to run as if the app had got somewhere safe. */
  whenSafe: [] as Array<() => void>,
}));

vi.mock('./storage', async () => {
  const core = await import('@bannertv/core');
  const { profilePrefix } = await import('./profiles');
  const kv: KeyValueStore = {
    get(key) {
      if (key === 'sync/state' && disk.failStateReads > 0) {
        disk.failStateReads -= 1;
        return Promise.reject(new Error('The read failed'));
      }
      const raw = disk.values.get(key);
      return Promise.resolve(raw === undefined ? undefined : (JSON.parse(raw) as unknown));
    },
    set(key, value) {
      disk.values.set(key, JSON.stringify(value));
      return Promise.resolve();
    },
    delete(key) {
      disk.values.delete(key);
      return Promise.resolve();
    },
    deletePrefix(prefix) {
      for (const key of Array.from(disk.values.keys())) {
        if (key.indexOf(prefix) === 0) disk.values.delete(key);
      }
      return Promise.resolve();
    },
  };
  return {
    storage: { kv, cache: core.memoryCacheStore(), persistent: Promise.resolve(true) },
    profileKv: core.profileKeyValueStore(kv, profilePrefix),
  };
});

vi.mock('../platform/web-crypto', async () => {
  const testing = await import('../../../../packages/core/src/sync/testing');
  const crypto = testing.webCryptoForTests();
  return {
    pageCrypto: () => crypto,
    webCryptoWorks: () => Promise.resolve(true),
    secureRandom: () => Math.random(),
  };
});

vi.mock('./sync-service', () => ({
  SYNC_SERVICE: 'https://sync.test',
  createSyncTransport: () => ({
    get: (path: string) => net.service.transport.get(path),
    post: (path: string, body: unknown) => net.service.transport.post(path, body),
  }),
}));

vi.mock('./sports', async () => {
  const testing = await import('../../../../packages/core/src/sync/testing');
  launched.timers = testing.manualTimers();
  return { browserTimers: launched.timers.timers, sportsChoices: {} };
});

vi.mock('../app/features', () => ({ SPORTS_IN_BUILD: false }));
vi.mock('./profile-delete', () => ({ deleteProfile: () => Promise.resolve() }));
vi.mock('./sync-reload', () => ({
  reloadWhenSafe: (run: () => void) => launched.whenSafe.push(run),
}));

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
const now = 1_700_000_000_000;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  disk.values.clear();
  disk.failStateReads = 0;
  launched.whenSafe = [];
  local = new MemoryStorage();
  reload = vi.fn();
  net.service = fakeSyncService({ now: () => now });
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('window', {
    location: { hash: '', pathname: '/', search: '', reload },
    addEventListener: () => undefined,
  });
  vi.stubGlobal('document', { hidden: false, addEventListener: () => undefined });
  vi.stubGlobal('history', { replaceState: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A launch of the app as main.tsx starts it, the engine having read what it could. */
async function launch() {
  vi.resetModules();
  const sync = await import('./sync');
  // The stores load at launch, as main.tsx has them (the addons without their refresh).
  void (await import('./addons')).addonCollection.load();
  (await import('./library')).startLibraryData();
  (await import('./playback')).startPlaybackData();
  sync.startSync();
  await settle();
  return sync;
}

/**
 * Lets the engine work for `ms` of its timers, its retries and the two
 * seconds to the first pull included. Web Crypto answers on Node's own
 * clock, so real time passes in between.
 */
async function settle(ms = 5000): Promise<void> {
  for (let step = 0; step < 20; step++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await launched.timers.advance(ms / 20);
  }
}

/** A screen with an account made on it, as Settings > BannerTV account makes one. */
async function signedIn() {
  const sync = await launch();
  sync.openAccount();
  await sync.createAccount();
  await sync.confirmAccount();
  await settle();
  expect(sync.accountState.get().status.state).not.toBe('off');
  expect(local.getItem('bannertv.syncOn')).toBe('1');
}

/** Why a create or join stopped. Each launch has a core of its own, so not by instanceof. */
function problem(error: unknown): string | undefined {
  return error instanceof Error && error.name === 'SyncSetupError'
    ? (error as SyncSetupError).problem
    : undefined;
}

describe('a launch that cannot read what the account kept', () => {
  it('runs no account for that launch, and is not taken for signed out', async () => {
    await signedIn();

    disk.failStateReads = Infinity;
    const bad = await launch();
    expect(bad.accountState.get().engine).toBe('broken');
    // The screen stays one of the account's: Settings offers the account, not Create or Join.
    expect(local.getItem('bannertv.syncOn')).toBe('1');
    expect(bad.accountSection.get().shown).toBe(true);
    expect(problem(await bad.createAccount().catch((error: unknown) => error))).toBe('not-started');

    disk.failStateReads = 0;
    const good = await launch();
    expect(good.accountState.get().engine).toBe('running');
    expect(good.accountState.get().status.state).not.toBe('off');
    expect(good.accountCode()).toBeDefined();
  });

  it('tries a read that failed again, so a title taken off My List that launch stays off', async () => {
    await signedIn();
    const first = await import('./library');
    await first.library.add(parseMetaPreview({ id: 'tt0000001', type: 'movie', name: 'One' })!);
    await settle(10_000);

    // The next launch's first read of the account's state fails.
    disk.failStateReads = 1;
    const next = await launch();
    expect(next.accountState.get().engine).toBe('running');
    const { library } = await import('./library');
    expect(library.has('tt0000001')).toBe(true);
    await library.remove('tt0000001');
    await settle(10_000);

    const after = await launch();
    await after.syncAccountNow();
    expect((await import('./library')).library.has('tt0000001')).toBe(false);
    expect(local.getItem('bannertv.syncOn')).toBe('1');
  });

  it('opens the engine all the same where the flag was lost too, and it reads the state again', async () => {
    await signedIn();
    local.removeItem('bannertv.syncOn');

    // Every try of the launch's own read fails; the engine's read then gets through.
    disk.failStateReads = 4;
    const sync = await launch();
    expect(sync.accountState.get().engine).toBe('running');
    expect(sync.accountState.get().status.state).not.toBe('off');
    expect(local.getItem('bannertv.syncOn')).toBe('1');
  });

  it("starts the account all the same when the launch's check of a join fails", async () => {
    await signedIn();
    vi.doMock('./sync-joined', () => ({
      markJoined: () => Promise.resolve(),
      settleJoined: () => Promise.reject(new Error('The check failed')),
    }));
    try {
      const sync = await launch();
      expect(sync.accountState.get().engine).toBe('running');
      expect(sync.accountState.get().status.state).not.toBe('off');
    } finally {
      vi.doUnmock('./sync-joined');
    }
  });

  it('on a screen with no account, sets nothing', async () => {
    disk.failStateReads = Infinity;
    const sync = await launch();
    expect(sync.accountState.get().engine).toBe('broken');
    expect(local.getItem('bannertv.syncOn')).toBeNull();
  });
});

describe('making an account', () => {
  it('offers only Join once the service says new accounts are closed', async () => {
    net.service = fakeSyncService({ now: () => now, maxAccounts: 0 });
    local.setItem('bannertv.syncStatus', JSON.stringify({ at: Date.now(), create: true }));
    const sync = await launch();
    sync.checkAccountSection();
    await settle();
    expect(sync.accountSection.get()).toEqual({ shown: true, canCreate: true, needsKey: false });

    sync.openAccount();
    expect(problem(await sync.createAccount().catch((error: unknown) => error))).toBe('closed');
    expect(sync.accountSection.get()).toEqual({ shown: true, canCreate: false, needsKey: false });
    expect(JSON.parse(local.getItem('bannertv.syncStatus')!)).toMatchObject({ create: false });
    // The next launch remembers it, for the day.
    expect((await launch()).accountSection.get().canCreate).toBe(false);
  });

  it('sends the setup key the service asks for, and asks for it again when it was wrong', async () => {
    const key = 'Abc123def456';
    net.service = fakeSyncService({ now: () => now, createKey: key });
    const sync = await launch();
    sync.checkAccountSection();
    await settle();
    expect(sync.accountSection.get()).toEqual({ shown: true, canCreate: true, needsKey: true });
    expect(JSON.parse(local.getItem('bannertv.syncStatus')!)).toMatchObject({ key: true });

    sync.openAccount();
    expect(problem(await sync.createAccount('abc123def456').catch((e: unknown) => e))).toBe('key');
    expect(sync.accountSection.get().needsKey).toBe(true);
    expect(await sync.createAccount(`  ${key} `)).toMatch(/^[0-9A-Z]{16,}$/);
    const creates = net.service.requests.filter((r) => r.path === '/v1/account/create');
    expect((creates[creates.length - 1]!.body as { key?: string }).key).toBe(key);
    // Kept only until the account exists, and never in localStorage.
    expect(JSON.stringify(Array.from(local.map.values()))).not.toContain(key);
    expect(JSON.parse(disk.values.get('sync/state')!)).not.toHaveProperty('key');
  });

  it('asks for the key once the service says it needs one, though its status said not', async () => {
    net.service = fakeSyncService({ now: () => now, createKey: 'Abc123def456' });
    local.setItem('bannertv.syncStatus', JSON.stringify({ at: Date.now(), create: true }));
    const sync = await launch();
    sync.checkAccountSection();
    await settle();
    expect(sync.accountSection.get().needsKey).toBe(false);

    sync.openAccount();
    expect(problem(await sync.createAccount().catch((e: unknown) => e))).toBe('key');
    expect(sync.accountSection.get().needsKey).toBe(true);
    expect(JSON.parse(local.getItem('bannertv.syncStatus')!)).toMatchObject({ key: true });
  });
});

describe('joining', () => {
  /** An account made on another screen, which has Main only. */
  async function otherScreen(): Promise<string> {
    const other = createSyncEngine({
      crypto: webCryptoForTests(),
      transport: net.service.transport,
      storage: (await import('@bannertv/core')).memoryKeyValueStore(),
      clock: createAccountClock({ now: () => now }),
      timers: { after: () => () => undefined, every: () => () => undefined },
      accountParts: [],
      profileParts: () => [],
    });
    await other.start({ id: 'main', parts: [] });
    const code = await other.create();
    await other.confirmCreate();
    return code;
  }

  it('starts the app again at once for a join the person watches, keeping a copy of what it wrote', async () => {
    const code = await otherScreen();
    const sync = await launch();
    sync.openAccount();
    await sync.joinAccount(code, 'use');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(disk.values.get('sync-joined')!)).toEqual({
      profiles: local.getItem('bannertv.profiles'),
      held: local.getItem('bannertv.syncHeld'),
      token: expect.any(String),
    });

    // The next launch reads what the join wrote, and drops the copy.
    await launch();
    expect(disk.values.has('sync-joined')).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('starts the app again only once somewhere safe, for a join that carried on by itself', async () => {
    const code = await otherScreen();
    const sync = await launch();
    sync.openAccount();
    net.service.failNext({ network: true }, { network: true }, { network: true });
    expect(problem(await sync.joinAccount(code, 'use').catch((e: unknown) => e))).toBe('offline');
    net.service.heal();

    // The join carries on by itself 30 seconds later, and gets through.
    await settle(60_000);
    expect(sync.accountState.get().status.state).not.toBe('setup');
    expect(reload).not.toHaveBeenCalled();
    expect(launched.whenSafe).toHaveLength(1);

    launched.whenSafe[0]!();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(disk.values.has('sync-joined')).toBe(true);
  });
});
