import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * runtime/app-updates.ts as it runs on a phone, with stand-ins for expo-updates, React Native,
 * the restart gate (shims/sync-reload.ts) and the app's restart (web-globals.ts): which rule each
 * downloaded update is handed to the gate with, when Settings is offered the restart, and how a
 * check ends. The rules themselves are tested in safe-restart.test.ts and app-updates-plan.test.ts.
 */

type StateListener = (event: { context: { isUpdatePending: boolean } }) => void;

/** A restart handed to the gate. */
interface Handed {
  rule: string;
  restart: () => void;
  cancelled: boolean;
}

const fake = vi.hoisted(() => {
  const stateListeners: StateListener[] = [];
  const appStateListeners: ((next: string) => void)[] = [];
  const handed: Handed[] = [];
  const updates = {
    isEnabled: true,
    isEmbeddedLaunch: true,
    updateId: null as string | null,
    createdAt: null as Date | null,
    latestContext: { isUpdatePending: false },
    checkForUpdateAsync: vi.fn(),
    fetchUpdateAsync: vi.fn(),
    reloadAsync: vi.fn(),
    addUpdatesStateChangeListener: vi.fn((listener: StateListener) => {
      stateListeners.push(listener);
      return { remove: () => undefined };
    }),
  };
  const reactNative = {
    Platform: { OS: 'android' },
    AppState: {
      currentState: 'active',
      addEventListener: vi.fn((_type: string, listener: (next: string) => void) => {
        appStateListeners.push(listener);
        return { remove: () => undefined };
      }),
    },
  };
  return { updates, reactNative, stateListeners, appStateListeners, handed };
});

vi.mock('expo-updates', () => fake.updates);
vi.mock('react-native', () => fake.reactNative);
vi.mock('../ui/theme', () => ({ colors: { bg: '#0B0815' } }));
vi.mock('./web-globals', () => ({
  startAgain: (restart: () => Promise<void>) => restart().catch(() => undefined),
}));
vi.mock('../shims/sync-reload', () => ({
  restartWhenSafe: (restart: () => void, rule: string) => {
    const entry: Handed = { rule, restart, cancelled: false };
    fake.handed.push(entry);
    return () => {
      entry.cancelled = true;
    };
  },
}));

const BOOT = Date.UTC(2026, 10, 9, 12, 0);
const MINUTE = 60_000;

/** A promise the test settles when it chooses. */
function later<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Lets the module's awaits run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const FOUND = { isAvailable: true, isRollBackToEmbedded: false };
const NOTHING = { isAvailable: false, isRollBackToEmbedded: false };
const FETCHED = { isNew: true, isRollBackToEmbedded: false };

/** A fresh copy of the module, as at a launch, with Settings or another screen on top. */
async function launch(screen = 'home') {
  vi.resetModules();
  const where = await import('./whereabouts');
  where.reportScreen(screen);
  const updates = await import('./app-updates');
  return { ...updates, where };
}

/** The app goes to the background and comes back `minutes` after boot. */
function backAfter(minutes: number): void {
  vi.setSystemTime(BOOT + minutes * MINUTE);
  for (const listener of fake.appStateListeners) listener('background');
  for (const listener of fake.appStateListeners) listener('active');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BOOT);
  vi.stubGlobal('__DEV__', false);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.assign(fake.updates, {
    isEnabled: true,
    isEmbeddedLaunch: true,
    updateId: null,
    createdAt: null,
    latestContext: { isUpdatePending: false },
  });
  fake.updates.checkForUpdateAsync.mockReset().mockResolvedValue(NOTHING);
  fake.updates.fetchUpdateAsync.mockReset().mockResolvedValue(FETCHED);
  fake.updates.reloadAsync.mockReset().mockResolvedValue(undefined);
  fake.updates.addUpdatesStateChangeListener.mockClear();
  fake.reactNative.AppState.addEventListener.mockClear();
  fake.reactNative.Platform.OS = 'android';
  fake.reactNative.AppState.currentState = 'active';
  fake.stateListeners.length = 0;
  fake.appStateListeners.length = 0;
  fake.handed.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('builds that take no updates', () => {
  const builds: [string, () => void][] = [
    ['an APK built without the certificate', () => (fake.updates.isEnabled = false)],
    ['the web build', () => (fake.reactNative.Platform.OS = 'web')],
    ['a development build', () => vi.stubGlobal('__DEV__', true)],
  ];

  for (const [build, arrange] of builds) {
    it(`${build} never checks, listens or restarts`, async () => {
      arrange();
      fake.updates.latestContext = { isUpdatePending: true };
      const app = await launch('settings');
      app.startAppUpdates();
      app.checkForUpdates();
      app.restartNow();
      await settle();
      expect(app.appUpdates.get()).toMatchObject({ on: false, phase: 'idle', offer: false });
      expect(app.appUpdates.get().running).toEqual({ kind: 'builtIn' });
      expect(fake.updates.addUpdatesStateChangeListener).not.toHaveBeenCalled();
      expect(fake.reactNative.AppState.addEventListener).not.toHaveBeenCalled();
      expect(fake.updates.checkForUpdateAsync).not.toHaveBeenCalled();
      expect(fake.handed).toEqual([]);
      expect(fake.updates.reloadAsync).not.toHaveBeenCalled();
    });
  }
});

describe("the app's own checks", () => {
  it("count Expo's check at launch as the first, and check again 15 minutes on", async () => {
    const app = await launch();
    app.startAppUpdates();
    backAfter(14);
    expect(fake.updates.checkForUpdateAsync).not.toHaveBeenCalled();
    backAfter(15);
    expect(fake.updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    await settle();
    expect(app.appUpdates.get().phase).toBe('none');
    backAfter(16);
    expect(fake.updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it('start an update Expo downloaded before boot at the next safe moment', async () => {
    fake.updates.latestContext = { isUpdatePending: true };
    const app = await launch();
    app.startAppUpdates();
    expect(app.appUpdates.get()).toMatchObject({ phase: 'ready', offer: false });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['update']);
  });

  it('start an update Expo downloads after boot the same way, once', async () => {
    const app = await launch();
    app.startAppUpdates();
    expect(fake.handed).toEqual([]);
    for (const listener of fake.stateListeners) listener({ context: { isUpdatePending: true } });
    for (const listener of fake.stateListeners) listener({ context: { isUpdatePending: true } });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['update']);
  });

  it('start what they download by the update rule, with no offer, even with Settings open', async () => {
    fake.updates.checkForUpdateAsync.mockResolvedValue(FOUND);
    const app = await launch('settings');
    app.startAppUpdates();
    backAfter(15);
    await settle();
    expect(fake.updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(app.appUpdates.get()).toMatchObject({ phase: 'ready', offer: false });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['update']);
  });

  it('fail quietly and are tried again later', async () => {
    fake.updates.checkForUpdateAsync.mockRejectedValue(new Error('offline'));
    const app = await launch();
    app.startAppUpdates();
    backAfter(15);
    await settle();
    expect(app.appUpdates.get().phase).toBe('idle');
    backAfter(30);
    expect(fake.updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  });
});

describe("the person's check, in Settings", () => {
  it('downloads, offers the restart once, and otherwise holds it until off screen', async () => {
    fake.updates.checkForUpdateAsync.mockResolvedValue(FOUND);
    const app = await launch('settings');
    app.startAppUpdates();
    app.checkForUpdates();
    expect(app.appUpdates.get().phase).toBe('checking');
    await settle();
    expect(app.appUpdates.get()).toMatchObject({ phase: 'ready', offer: true });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['offScreen']);
    app.offerShown();
    expect(app.appUpdates.get().offer).toBe(false);
  });

  it('makes no offer once the person has left Settings', async () => {
    const download = later<typeof FETCHED>();
    fake.updates.checkForUpdateAsync.mockResolvedValue(FOUND);
    fake.updates.fetchUpdateAsync.mockReturnValue(download.promise);
    const app = await launch('settings');
    app.startAppUpdates();
    app.checkForUpdates();
    await settle();
    expect(app.appUpdates.get().phase).toBe('downloading');
    app.where.reportScreen('details');
    download.resolve(FETCHED);
    await settle();
    expect(app.appUpdates.get()).toMatchObject({ phase: 'ready', offer: false });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['offScreen']);
  });

  it("joins the app's check already running, which then ends in the person's offer", async () => {
    const found = later<typeof FOUND>();
    fake.updates.checkForUpdateAsync.mockReturnValue(found.promise);
    const app = await launch('settings');
    app.startAppUpdates();
    backAfter(15);
    app.checkForUpdates();
    expect(fake.updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    found.resolve(FOUND);
    await settle();
    expect(app.appUpdates.get()).toMatchObject({ phase: 'ready', offer: true });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['offScreen']);
  });

  it("says when it failed, and a later check of the app's own does not", async () => {
    fake.updates.checkForUpdateAsync.mockRejectedValue(new Error('offline'));
    const app = await launch('settings');
    app.startAppUpdates();
    app.checkForUpdates();
    await settle();
    expect(app.appUpdates.get().phase).toBe('failed');
    backAfter(15);
    await settle();
    expect(fake.updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
    expect(app.appUpdates.get().phase).toBe('idle');
  });

  it('says when it is up to date', async () => {
    const app = await launch('settings');
    app.startAppUpdates();
    app.checkForUpdates();
    await settle();
    expect(app.appUpdates.get()).toMatchObject({ phase: 'none', offer: false });
    expect(fake.handed).toEqual([]);
  });

  it("once over, leaves an update Expo downloads by itself to the app's rule", async () => {
    const app = await launch('settings');
    app.startAppUpdates();
    app.checkForUpdates();
    await settle();
    for (const listener of fake.stateListeners) listener({ context: { isUpdatePending: true } });
    expect(app.appUpdates.get()).toMatchObject({ phase: 'ready', offer: false });
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['update']);
  });

  it('offers an update already waiting, without checking again, and holds it off screen', async () => {
    fake.updates.latestContext = { isUpdatePending: true };
    const app = await launch('settings');
    app.startAppUpdates();
    expect(fake.handed.map((entry) => entry.rule)).toEqual(['update']);
    app.checkForUpdates();
    expect(fake.updates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(app.appUpdates.get().offer).toBe(true);
    expect(fake.handed.map((entry) => [entry.rule, entry.cancelled])).toEqual([
      ['update', true],
      ['offScreen', false],
    ]);
  });
});

describe('starting the update', () => {
  it('Restart now starts it through expo-updates, over the app’s background', async () => {
    fake.updates.latestContext = { isUpdatePending: true };
    const app = await launch('settings');
    app.startAppUpdates();
    app.restartNow();
    await settle();
    expect(fake.updates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(fake.updates.reloadAsync).toHaveBeenCalledWith({
      reloadScreenOptions: { backgroundColor: '#0B0815', fade: true },
    });
    expect(fake.handed[0]?.cancelled).toBe(true);
  });

  it('starts once, however often it is asked while starting', async () => {
    fake.updates.latestContext = { isUpdatePending: true };
    fake.updates.reloadAsync.mockReturnValue(new Promise(() => undefined));
    const app = await launch();
    app.startAppUpdates();
    fake.handed[0]?.restart();
    app.restartNow();
    fake.handed[0]?.restart();
    await settle();
    expect(fake.updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('can be tried again with Restart now when starting failed', async () => {
    fake.updates.latestContext = { isUpdatePending: true };
    fake.updates.reloadAsync.mockRejectedValueOnce(new Error('no'));
    const app = await launch('settings');
    app.startAppUpdates();
    fake.handed[0]?.restart();
    await settle();
    expect(fake.updates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(app.appUpdates.get().phase).toBe('ready');
    app.restartNow();
    await settle();
    expect(fake.updates.reloadAsync).toHaveBeenCalledTimes(2);
  });

  it('Restart now does nothing while no update waits', async () => {
    const app = await launch('settings');
    app.startAppUpdates();
    app.restartNow();
    await settle();
    expect(fake.updates.reloadAsync).not.toHaveBeenCalled();
  });
});
