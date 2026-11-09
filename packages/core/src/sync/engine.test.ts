import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { toBase64Url, utf8Encode } from './bytes';
import { createAccountClock } from './clock';
import type { SyncCrypto } from './crypto';
import { createSyncEngine, type SyncEngine, SyncSetupError } from './engine';
import type { Items } from './items';
import { deriveAccountKeys, wireName } from './keys';
import { createProfileStores, profileParts } from './parts';
import { openDocument } from './seal';
import { fakeSyncService, manualTimers, memoryPart, webCryptoForTests } from './testing';
import type { SyncTransport } from './wire';

const crypto = webCryptoForTests();
/** Not a whole second, so titles added here are not taken for Trakt's. */
const START = Date.UTC(2026, 9, 1, 12, 0, 0) + 123;
const DAY = 24 * 60 * 60 * 1000;

function preview(id: string): MetaPreview {
  return {
    id,
    type: 'movie',
    name: `Title ${id}`,
    posterShape: 'poster',
    genres: [],
    trailers: [],
  };
}

function world(maxAccounts = 1, createKey?: string) {
  const time = manualTimers();
  const now = () => START + time.elapsed();
  const service = fakeSyncService({ now, maxAccounts, createKey });
  return { time, now, service };
}

type World = ReturnType<typeof world>;

/**
 * One TV: its storage, clock, stores and engine, with Main (and any
 * `others`) as profiles. `storage` is the TV's; `engineStorage`, when
 * given, is what the engine reads it through. `shift` moves the TV's own
 * clock at any moment, as NTP can.
 */
function screen(
  w: World,
  options: {
    storage?: KeyValueStore;
    engineStorage?: KeyValueStore;
    profile?: string;
    others?: string[];
    skew?: number;
    shift?: { ms: number };
    crypto?: SyncCrypto;
    transport?: SyncTransport;
    addons?: ReturnType<typeof memoryPart>;
    /** The profiles as an earlier launch left them, rather than Main and `others`. */
    profiles?: ReturnType<typeof memoryPart>;
  } = {},
) {
  const storage = options.storage ?? memoryKeyValueStore();
  const skew = options.skew ?? 0;
  const shift = options.shift ?? { ms: 0 };
  const clock = createAccountClock({ now: () => w.now() + skew + shift.ms });
  const profiles = options.profiles ?? memoryPart('profiles');
  if (!options.profiles) profiles.set('main', 1, 0);
  for (const id of options.profiles ? [] : (options.others ?? [])) {
    profiles.set(id, 1);
    profiles.set(`${id}/name`, id);
  }
  const addons = options.addons ?? memoryPart('addons', ['a/', 'order']);
  const storesOf = (id: string) =>
    createProfileStores(
      profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix(id))),
      clock.now,
    );
  const profileId = options.profile ?? 'main';
  const stores = storesOf(profileId);
  const parts = profileParts(profileId, stores);
  const joined = vi.fn();
  const broughtBack = vi.fn();
  const engine = createSyncEngine({
    crypto: options.crypto ?? crypto,
    transport: options.transport ?? w.service.transport,
    storage: options.engineStorage ?? storage,
    clock,
    timers: w.time.timers,
    accountParts: [profiles.part, addons.part],
    profileParts: (id) => profileParts(id, storesOf(id)),
    onJoined: joined,
    onBroughtBack: broughtBack,
  });
  return {
    storage,
    clock,
    profiles,
    addons,
    stores,
    storesOf,
    engine,
    joined,
    broughtBack,
    start: () => engine.start({ id: profileId, parts }),
  };
}

/** Waits for a sync that a timer started. */
async function settled(engine: SyncEngine) {
  await vi.waitFor(() => {
    if (engine.status().state === 'syncing') throw new Error('Still syncing');
  });
}

/** A document as the account holds it, opened with the code. */
async function accountItems(w: World, code: string, document: string): Promise<Items | undefined> {
  const keys = await deriveAccountKeys(crypto, code);
  const doc = w.service.documents(keys.accountId).get(await wireName(crypto, keys, document));
  return doc && openDocument(crypto, keys, document, doc.ver, doc.body);
}

async function created(w: World, setUp?: (a: ReturnType<typeof screen>) => Promise<void>) {
  const a = screen(w);
  await a.start();
  if (setUp) await setUp(a);
  const code = await a.engine.create();
  await a.engine.confirmCreate();
  return { a, code };
}

const titles = (s: ReturnType<typeof screen>) => s.stores.library.items().map((item) => item.id);

describe('createSyncEngine without an account', () => {
  it('makes no request and keeps nothing', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    await a.stores.library.add(preview('tt1'));
    await w.time.advance(DAY);
    a.engine.hide();
    a.engine.show();
    a.engine.pushSoon();
    await w.time.advance(DAY);
    await a.engine.syncNow();
    expect(a.engine.status()).toEqual({ state: 'off' });
    expect(w.service.requests).toEqual([]);
    expect(await a.storage.get('sync/state')).toBeUndefined();
    expect(a.engine.code()).toBeUndefined();
  });

  it('throws the set-aside copy away after its 30 days', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    await storage.set('sync-aside', { v: 1, at: START - 31 * DAY, until: START - DAY });
    await screen(w, { storage }).start();
    expect(await storage.get('sync-aside')).toBeUndefined();
  });
});

describe('creating an account', () => {
  it("sends what the screen holds once the code is written down, but none of Trakt's", async () => {
    const w = world();
    const a = screen(w, { others: ['kid1'] });
    await a.start();
    await a.stores.library.add(preview('own'));
    await a.stores.library.adopt({
      set: [
        { id: 'trakt', type: 'movie', name: 'From Trakt', addedAt: START - 5, from: 'trakt' },
        // Saved before this build, at a whole second: counted as Trakt's.
        { id: 'old', type: 'movie', name: 'Old', addedAt: START - 123 - DAY },
      ],
    });
    const kid = a.storesOf('kid1');
    await kid.library.add(preview('kids'));
    const code = await a.engine.create();
    expect(code).toMatch(/^[A-Z2-9]{20}$/);
    expect(a.engine.code()).toBe(code);
    expect(a.engine.status().state).toBe('setup');
    expect(w.service.count('/v1/push')).toBe(0);

    await a.engine.confirmCreate();
    const list = await accountItems(w, code, 'p/main/list');
    expect(list).toEqual({ own: { t: START, v: { type: 'movie', name: 'Title own' } } });
    expect(a.stores.library.get('old')!.from).toBe('trakt');
    expect(Object.keys((await accountItems(w, code, 'p/kid1/list'))!)).toEqual(['kids']);
    const profiles = (await accountItems(w, code, 'profiles'))!;
    expect(profiles.main).toEqual({ t: 0, v: 1 });
    expect(profiles['kid1/name']).toMatchObject({ v: 'kid1' });
    expect(a.engine.status()).toMatchObject({ state: 'idle', lastSync: START });
  });

  it('keeps the same code when the service did not answer, and when it is asked again', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    w.service.failNext({ path: '/v1/account/create', network: true });
    const failed = await a.engine.create().catch((error: SyncSetupError) => error);
    expect(failed).toBeInstanceOf(SyncSetupError);
    expect((failed as SyncSetupError).problem).toBe('offline');
    const code = a.engine.code()!;
    expect(await a.engine.create()).toBe(code);
    // Made by then: asked again, nothing more is sent.
    expect(await a.engine.create()).toBe(code);
    expect(w.service.count('/v1/account/create')).toBe(2);
  });

  it('forgets the code when no account can be made', async () => {
    const w = world(0);
    const a = screen(w);
    await a.start();
    await expect(a.engine.create()).rejects.toMatchObject({ problem: 'closed' });
    expect(a.engine.status().state).toBe('off');
    expect(await a.storage.get('sync/state')).toBeUndefined();
  });

  it('carries on at the next launch once the code was confirmed', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const a = screen(w, { storage });
    await a.start();
    await a.stores.library.add(preview('tt1'));
    const code = await a.engine.create();
    // The TV went off just after the person confirmed the code.
    const state = (await storage.get('sync/state')) as object;
    await storage.set('sync/state', { ...state, step: 1 });

    const again = screen(w, { storage });
    await again.start();
    await vi.waitFor(async () =>
      expect(Object.keys((await accountItems(w, code, 'p/main/list')) ?? {})).toEqual(['tt1']),
    );
    await settled(again.engine);
    expect(again.engine.status().state).toBe('idle');
  });
});

describe('joining an account', () => {
  it('checks a typed code with the service', async () => {
    const w = world();
    const { code } = await created(w);
    const b = screen(w);
    await b.start();
    const typed = code.toLowerCase().replace(/(.{4})/g, '$1 ');
    expect(await b.engine.checkCode(typed)).toBe('ok');
    expect(await b.engine.checkCode('ABCD')).toBe('invalid');
    expect(await b.engine.checkCode('A'.repeat(20))).toBe('unknown');
    w.service.failNext({ network: true });
    expect(await b.engine.checkCode(code)).toBe('offline');
  });

  it("with Use, makes the screen match the account and sets this screen's data aside", async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const b = screen(w);
    await b.start();
    await w.time.advance(1000);
    await b.stores.library.add(preview('b1'));
    await b.stores.library.adopt({
      set: [{ id: 'trakt', type: 'movie', name: 'T', addedAt: START, from: 'trakt' }],
    });
    expect(await b.engine.hasLocalData()).toBe(true);
    await b.engine.join(code, 'use');
    // Trakt's title stays: the account never knew it.
    expect(titles(b)).toEqual(['trakt', 'a1']);
    expect(await b.storage.get('sync-aside')).toMatchObject({
      v: 1,
      at: START + 1000,
      until: START + 1000 + 30 * DAY,
      documents: { 'p/main/list': expect.arrayContaining([['b1', expect.anything()]]) },
    });
    expect(b.engine.status().state).not.toBe('setup');

    // From now on, both ways.
    await w.time.advance(1000);
    await b.stores.library.add(preview('b2'));
    await b.engine.flush();
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['b2', 'a1']);
  });

  it("with Bring, adds this screen's profiles and titles, and the account's settings win", async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
      await s.stores.homeLayout.update(() => ({ order: ['x', 'y'], hidden: [] }));
    });
    const b = screen(w, { others: ['kid1'] });
    await b.start();
    await w.time.advance(1000);
    await b.stores.library.add(preview('b1'));
    await b.stores.homeLayout.update(() => ({ order: ['y', 'z'], hidden: ['h'] }));
    await b.engine.join(code, 'bring');

    expect(titles(b)).toEqual(['b1', 'a1']);
    // The account's order, with the row only this screen has after its neighbour.
    expect(b.stores.homeLayout.get()).toEqual({ order: ['x', 'y', 'z'], hidden: ['h'] });
    const profiles = (await accountItems(w, code, 'profiles'))!;
    expect(Object.keys(profiles).sort()).toEqual(['kid1', 'kid1/name', 'main']);
    const settings = (await accountItems(w, code, 'p/main/settings'))!;
    expect(settings['home/order']).toMatchObject({ v: ['x', 'y'] });
    expect(settings['home/hidden']).toMatchObject({ v: ['h'] });

    await a.engine.syncNow();
    expect(titles(a)).toEqual(['b1', 'a1']);
    expect(a.stores.homeLayout.get().hidden).toEqual(['h']);
  });

  it('refuses Bring past six profiles and stays signed out', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      for (const id of ['p1', 'p2', 'p3', 'p4']) s.profiles.set(id, 1);
    });
    const b = screen(w, { others: ['q1', 'q2'] });
    await b.start();
    await expect(b.engine.join(code, 'bring')).rejects.toMatchObject({ problem: 'profiles' });
    expect(b.engine.status().state).toBe('off');
    expect(await b.storage.get('sync/state')).toBeUndefined();
  });

  it('refuses a code no account has', async () => {
    const w = world();
    const b = screen(w);
    await b.start();
    await expect(b.engine.join('A'.repeat(20), 'use')).rejects.toMatchObject({
      problem: 'unknown',
    });
    expect(b.engine.status().state).toBe('off');
  });

  it('carries on at the next launch without setting aside a second time', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const storage = memoryKeyValueStore();
    const keys = await deriveAccountKeys(crypto, code);
    // A join with Use that stopped after keeping the copy.
    await storage.set('sync/state', {
      v: 1,
      code,
      accountId: keys.accountId,
      phase: 'joining',
      mode: 'use',
      step: 2,
    });
    const aside = { v: 1, at: START, until: START + 30 * DAY, documents: { kept: [] } };
    await storage.set('sync-aside', aside);
    const b = screen(w, { storage });
    await b.stores.library.add(preview('b1'));
    await b.start();
    await vi.waitFor(() => expect(b.joined).toHaveBeenCalled());
    expect(titles(b)).toEqual(['a1']);
    expect(await storage.get('sync-aside')).toEqual(aside);
    expect((await storage.get('sync/state')) as object).toMatchObject({ phase: 'ready' });
  });

  it('carries on a join on Sync now once the service answers again', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const storage = memoryKeyValueStore();
    const keys = await deriveAccountKeys(crypto, code);
    await storage.set('sync/state', {
      v: 1,
      code,
      accountId: keys.accountId,
      phase: 'joining',
      mode: 'use',
      step: 0,
    });
    const pulls = w.service.count('/v1/pull');
    w.service.failNext({ path: '/v1/pull', network: true });
    const b = screen(w, { storage });
    await b.start();
    await vi.waitFor(() => expect(w.service.count('/v1/pull')).toBe(pulls + 1));
    expect(b.engine.status().state).toBe('setup');
    await b.engine.syncNow();
    expect(b.joined).toHaveBeenCalled();
    expect(titles(b)).toEqual(['a1']);
    expect(b.engine.status().state).not.toBe('setup');
  });
});

describe('a signed-in screen', () => {
  it('pushes three seconds after an edit, fifteen after progress, and at once when hidden', async () => {
    const w = world();
    const { a, code } = await created(w);
    const pushes = () => w.service.count('/v1/push');
    const before = pushes();

    await a.stores.library.add(preview('tt1'));
    expect(a.engine.status().state).toBe('waiting');
    await w.time.advance(2999);
    expect(pushes()).toBe(before);
    await w.time.advance(1);
    await settled(a.engine);
    expect(pushes()).toBe(before + 1);
    expect(a.engine.status().state).toBe('idle');

    a.stores.progress.record({
      metaId: 'tt2',
      type: 'movie',
      videoId: 'tt2',
      position: 60,
      duration: 6000,
    });
    await w.time.advance(14999);
    expect(pushes()).toBe(before + 1);
    await w.time.advance(1);
    await settled(a.engine);
    expect(pushes()).toBe(before + 2);
    expect(Object.keys((await accountItems(w, code, 'p/main/watch'))!)).toEqual(['tt2']);

    a.stores.progress.record({
      metaId: 'tt2',
      type: 'movie',
      videoId: 'tt2',
      position: 120,
      duration: 6000,
    });
    a.engine.hide();
    await settled(a.engine);
    expect(pushes()).toBe(before + 3);
  });

  it('pulls two seconds after start, when back after fifteen seconds away, and on Sync now', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const { code } = await created(w, async () => undefined);
    const keys = await deriveAccountKeys(crypto, code);
    await storage.set('sync/state', { v: 1, code, accountId: keys.accountId, phase: 'ready' });
    const b = screen(w, { storage });
    await b.start();
    const pulls = () => w.service.count('/v1/pull');
    const before = pulls();
    await w.time.advance(1999);
    expect(pulls()).toBe(before);
    await w.time.advance(1);
    await settled(b.engine);
    expect(pulls()).toBe(before + 1);
    // The pull asks only for the account's documents and the profile in use.
    const pull = w.service.requests.filter((request) => request.path === '/v1/pull').pop()!;
    expect((pull.body as { want: string[] }).want).toHaveLength(5);

    b.engine.hide();
    await settled(b.engine);
    await w.time.advance(14 * 1000);
    b.engine.show();
    expect(pulls()).toBe(before + 1);
    b.engine.hide();
    await w.time.advance(20 * 1000);
    b.engine.show();
    await settled(b.engine);
    expect(pulls()).toBe(before + 2);
    await b.engine.syncNow();
    expect(pulls()).toBe(before + 3);
  });

  it('pushes progress within a minute while playback goes on saving, then about once a minute', async () => {
    const w = world();
    const { a, code } = await created(w);
    const pushes = () => w.service.count('/v1/push');
    const before = pushes();
    // Seconds after the first save at which each push went out.
    const sent: number[] = [];
    for (let save = 0; save < 30; save++) {
      a.stores.progress.record({
        metaId: 'tt2',
        type: 'movie',
        videoId: 'tt2',
        position: 60 + save * 10,
        duration: 6000,
      });
      const had = pushes();
      await w.time.advance(10 * 1000);
      await settled(a.engine);
      if (pushes() > had) sent.push((save + 1) * 10);
    }
    expect(sent).toEqual([60, 120, 180, 240, 300]);
    expect((await accountItems(w, code, 'p/main/watch'))!.tt2).toMatchObject({
      v: { position: 350 },
    });
    // The saves stopped with the last of them sent: nothing more goes.
    await w.time.advance(5 * 60 * 1000);
    expect(pushes()).toBe(before + 5);
  });

  it('pushes three seconds after the player pauses, unless failures are backing off', async () => {
    const w = world();
    const { a, code } = await created(w);
    const pushes = () => w.service.count('/v1/push');
    const before = pushes();
    const save = (position: number) =>
      a.stores.progress.record({
        metaId: 'tt2',
        type: 'movie',
        videoId: 'tt2',
        position,
        duration: 6000,
      });

    save(60);
    a.engine.pushSoon();
    await w.time.advance(2999);
    expect(pushes()).toBe(before);
    await w.time.advance(1);
    await settled(a.engine);
    expect(pushes()).toBe(before + 1);
    expect((await accountItems(w, code, 'p/main/watch'))!.tt2).toMatchObject({
      v: { position: 60 },
    });
    // Nothing waits: nothing is sent, and the progress save's own wait has gone with the push.
    a.engine.pushSoon();
    await w.time.advance(60 * 1000);
    expect(pushes()).toBe(before + 1);
    expect(a.engine.status().state).toBe('idle');

    // The service out of reach: the retry, not the pause, sends it.
    w.service.failNext({ path: '/v1/push', network: true });
    save(120);
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'offline' });
    const failed = pushes();
    save(180);
    a.engine.pushSoon();
    await w.time.advance(29 * 1000);
    expect(pushes()).toBe(failed);
    await w.time.advance(1000);
    await settled(a.engine);
    expect(pushes()).toBe(failed + 1);
    expect((await accountItems(w, code, 'p/main/watch'))!.tt2).toMatchObject({
      v: { position: 180 },
    });
  });

  it("does not take the account's changes for edits", async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await b.stores.library.add(preview('b1'));
    await b.engine.flush();
    const pushes = w.service.count('/v1/push');
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['b1']);
    expect(a.engine.status().state).toBe('idle');
    await w.time.advance(60 * 1000);
    expect(w.service.count('/v1/push')).toBe(pushes);
  });

  it('removes nothing when a store could not read what it saved', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const keys = await deriveAccountKeys(crypto, code);
    await storage.set('sync/state', { v: 1, code, accountId: keys.accountId, phase: 'ready' });
    const broken: KeyValueStore = {
      ...storage,
      get: (key) => (key === 'library' ? Promise.reject(new Error('IDB')) : storage.get(key)),
    };
    const b = screen(w, { storage: broken });
    await b.start();
    await w.time.advance(2000);
    await settled(b.engine);
    // The account's title came in; nothing went out.
    expect(titles(b)).toEqual(['a1']);
    expect((await accountItems(w, code, 'p/main/list'))!.a1).toMatchObject({
      v: expect.anything(),
    });
    await w.time.advance(60 * 1000);
    expect(b.engine.status().state).toBe('idle');
  });

  it("never sends Trakt's items, and lets only a newer account item change them", async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await a.stores.library.add(preview('tt1'));
    await a.engine.flush();
    // Trakt brought the same title to b later on.
    await b.stores.library.adopt({
      set: [{ id: 'tt1', type: 'movie', name: 'Trakt', addedAt: START + 5000, from: 'trakt' }],
    });
    expect(b.engine.status().state).toBe('idle');
    await b.engine.syncNow();
    expect(b.stores.library.get('tt1')).toMatchObject({ name: 'Trakt', from: 'trakt' });

    await w.time.advance(10 * 1000);
    await a.stores.library.remove('tt1');
    await a.engine.flush();
    await b.engine.syncNow();
    expect(b.stores.library.get('tt1')).toBeUndefined();
  });

  it('pulls, merges and pushes again when another screen wrote first', async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await a.stores.library.add(preview('a1'));
    await w.time.advance(100);
    await b.stores.library.add(preview('b1'));
    await a.engine.flush();
    const pushes = w.service.count('/v1/push');
    await b.engine.flush();
    expect(w.service.count('/v1/push')).toBe(pushes + 2);
    expect(Object.keys((await accountItems(w, code, 'p/main/list'))!).sort()).toEqual(['a1', 'b1']);
    expect(titles(b)).toEqual(['b1', 'a1']);
    expect(b.engine.status().state).toBe('idle');
  });

  it('gives up after three rounds of conflicts and backs off', async () => {
    const w = world();
    const { a } = await created(w);
    w.service.conflictEveryPush(true);
    await a.stores.library.add(preview('a1'));
    const pushes = w.service.count('/v1/push');
    await a.engine.flush();
    expect(w.service.count('/v1/push')).toBe(pushes + 4);
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'busy' });
    expect(w.time.nextDue() - w.time.elapsed()).toBe(30 * 1000);
    w.service.conflictEveryPush(false);
    await w.time.advance(30 * 1000);
    await settled(a.engine);
    expect(a.engine.status().state).toBe('idle');
  });

  it('backs off 30 seconds, then 2, 10 and 30 minutes while the service is away', async () => {
    const w = world();
    const { a } = await created(w);
    for (let i = 0; i < 6; i++) w.service.failNext({ network: true });
    await a.engine.syncNow();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'offline' });
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const wait = w.time.nextDue() - w.time.elapsed();
      waits.push(wait);
      await w.time.advance(wait);
      await settled(a.engine);
    }
    expect(waits).toEqual([30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000]);
  });

  it('holds pushes as long as the service asks when its limit is reached, and still pulls', async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    b.profiles.set('main/name', 'Zed');
    await b.engine.flush();
    w.service.failNext({
      path: '/v1/push',
      status: 429,
      body: { error: 'limit', retryAfter: 3600 },
    });
    await a.stores.library.add(preview('a1'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'limit' });
    // The push held back, the same sync pulls.
    expect(a.profiles.get('main/name')?.v).toBe('Zed');
    const pushes = w.service.count('/v1/push');
    a.engine.hide();
    await settled(a.engine);
    expect(w.service.count('/v1/push')).toBe(pushes);
    a.engine.show();

    // What other screens send still comes, on Sync now and at the regular pull.
    b.profiles.set('main/name', 'Ann');
    await b.engine.flush();
    await a.engine.syncNow();
    expect(a.profiles.get('main/name')?.v).toBe('Ann');
    b.profiles.set('main/name', 'Bob');
    await b.engine.flush();
    await w.time.advance(30 * 60 * 1000);
    await settled(a.engine);
    expect(a.profiles.get('main/name')?.v).toBe('Bob');
    expect(w.service.count('/v1/push')).toBe(pushes + 2);
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'limit' });

    // An hour after the refusal, the push goes.
    await w.time.advance(30 * 60 * 1000);
    await settled(a.engine);
    expect(Object.keys((await accountItems(w, code, 'p/main/list'))!)).toEqual(['a1']);
    expect(a.engine.status().state).toBe('idle');
  });

  it('holds pushes back when the service refuses a request for its size', async () => {
    const w = world();
    const { a } = await created(w);
    w.service.failNext({ path: '/v1/push', status: 413, body: { error: 'too-big' } });
    await a.stores.library.add(preview('a1'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'too-big' });
  });

  it('stops for good when the account was deleted, or deleted and made again', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const { a, code } = await created(w);
    const keys = await deriveAccountKeys(crypto, code);
    w.service.remake(keys.accountId);
    await a.engine.syncNow();
    expect(a.engine.status().state).toBe('gone');

    await storage.set('sync/state', { v: 1, code, accountId: keys.accountId, phase: 'ready' });
    const b = screen(w, { storage });
    await b.start();
    w.service.failNext({ path: '/v1/pull', status: 401, body: { error: 'denied' } });
    await b.engine.syncNow();
    expect(b.engine.status().state).toBe('gone');
    expect((await storage.get('sync/state')) as object).toMatchObject({ phase: 'gone' });

    const requests = w.service.requests.length;
    const again = screen(w, { storage });
    await again.start();
    await w.time.advance(DAY);
    await again.engine.syncNow();
    expect(again.engine.status().state).toBe('gone');
    expect(w.service.requests.length).toBe(requests);
  });

  it('lowers times more than a minute ahead of the service to when it stored them', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.adopt({
        set: [{ id: 'future', type: 'movie', name: 'F', addedAt: START + 10 * DAY + 7 }],
      });
    });
    expect(a.stores.library.get('future')!.addedAt).toBe(START);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    expect(b.stores.library.get('future')!.addedAt).toBe(START);
  });

  it('refuses an older version and a document from a newer BannerTV', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const keys = await deriveAccountKeys(crypto, code);
    const name = await wireName(crypto, keys, 'p/main/list');
    const first = { ...w.service.documents(keys.accountId).get(name)! };
    await a.stores.library.add(preview('a2'));
    await a.engine.flush();
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    expect(titles(b).sort()).toEqual(['a1', 'a2']);

    // An older body comes back: it is not taken.
    w.service.put(keys.accountId, name, first);
    await b.stores.library.remove('a2');
    await b.engine.syncNow();
    expect(titles(b)).toEqual(['a1']);

    // A newer build wrote the list: neither applied nor pushed over.
    const ver = first.ver + 5;
    const iv = crypto.random(12);
    const plain = utf8Encode(JSON.stringify({ items: {}, s: 2 }));
    const aad = utf8Encode(`bannertv/1|${keys.accountId}|p/main/list|${ver}`);
    const sealed = await crypto.aesGcmEncrypt(keys.dataKey, iv, aad, plain);
    const body = `1.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
    w.service.put(keys.accountId, name, { ver, at: w.now(), body });
    await b.engine.syncNow();
    expect(b.engine.status()).toMatchObject({ state: 'paused', reason: 'update' });
    await b.stores.library.add(preview('b1'));
    await b.engine.flush();
    expect(w.service.documents(keys.accountId).get(name)!.body).toBe(body);
  });

  it("pushes what another profile left waiting, but pulls only the profile in use's", async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const a = screen(w, { storage, others: ['kid1'] });
    await a.start();
    const code = await a.engine.create();
    await a.engine.confirmCreate();

    // A run as kid1 whose edit never left the screen.
    const kid = screen(w, { storage, profile: 'kid1', others: ['kid1'] });
    await kid.start();
    w.service.failNext({ path: '/v1/push', network: true });
    await kid.stores.library.add(preview('k1'));
    await kid.engine.flush();
    expect(kid.engine.status()).toMatchObject({ state: 'paused' });

    const main = screen(w, { storage, others: ['kid1'] });
    await main.start();
    await main.engine.syncNow();
    expect(Object.keys((await accountItems(w, code, 'p/kid1/list'))!)).toEqual(['k1']);
    const pull = w.service.requests.filter((request) => request.path === '/v1/pull').pop()!;
    const kidList = await wireName(crypto, await deriveAccountKeys(crypto, code), 'p/kid1/list');
    expect((pull.body as { want: string[] }).want).not.toContain(kidList);
  });

  it('leaves: forgets the account and keeps everything on the screen', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const b = screen(w, { skew: -5000 });
    await b.start();
    await b.stores.library.add(preview('b1'));
    await b.engine.join(code, 'use');
    expect(b.clock.skew()).not.toBe(0);
    await b.engine.leave();
    expect(b.engine.status()).toMatchObject({ state: 'off' });
    expect(b.engine.code()).toBeUndefined();
    expect(b.clock.skew()).toBe(0);
    expect(titles(b)).toEqual(['a1']);
    expect(await b.storage.get('sync/state')).toBeUndefined();
    expect(await b.storage.get('sync/base/p/main/list')).toBeUndefined();
    expect(await b.storage.get('sync-aside')).toBeDefined();
    // Edits are no longer watched.
    const requests = w.service.requests.length;
    await b.stores.library.add(preview('b2'));
    await w.time.advance(60 * 1000);
    expect(w.service.requests.length).toBe(requests);
  });

  it('deletes the account from the service, then leaves', async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await a.engine.deleteAccount();
    expect(a.engine.status().state).toBe('off');
    const keys = await deriveAccountKeys(crypto, code);
    expect(w.service.documents(keys.accountId).size).toBe(0);
    await b.engine.syncNow();
    expect(b.engine.status().state).toBe('gone');
  });

  it('follows a pull cut short until it has every document', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
      await s.stores.homeLayout.update(() => ({ order: ['x'], hidden: [] }));
    });
    w.service.limitPages(1);
    const b = screen(w);
    await b.start();
    const pulls = w.service.count('/v1/pull');
    await b.engine.join(code, 'use');
    expect(w.service.count('/v1/pull')).toBeGreaterThan(pulls + 2);
    expect(titles(b)).toEqual(['a1']);
    expect(b.stores.homeLayout.get().order).toEqual(['x']);
  });

  it('writes over a document nobody can read with what it knows', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const keys = await deriveAccountKeys(crypto, code);
    const name = await wireName(crypto, keys, 'p/main/list');
    const stored = w.service.documents(keys.accountId).get(name)!;
    w.service.put(keys.accountId, name, { ...stored, ver: stored.ver + 1, body: '1.AAAA.BBBB' });
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['a1']);
    await a.stores.library.add(preview('a2'));
    await a.engine.flush();
    expect(Object.keys((await accountItems(w, code, 'p/main/list'))!).sort()).toEqual(['a1', 'a2']);
  });

  it('stops pushing for a profile deleted on another screen', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const a = screen(w, { storage, others: ['kid1'] });
    await a.start();
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const kid = screen(w, { storage, profile: 'kid1', others: ['kid1'] });
    await kid.start();
    // Main deletes kid1 while kid1 is in use.
    a.profiles.delete('kid1');
    a.profiles.delete('kid1/name');
    await a.engine.flush();
    expect((await accountItems(w, code, 'profiles'))!.kid1).toMatchObject({ x: 1 });
    await kid.engine.syncNow();
    const pushes = w.service.count('/v1/push');
    await kid.stores.library.add(preview('k1'));
    await kid.engine.flush();
    expect(w.service.count('/v1/push')).toBe(pushes);
    expect(kid.engine.status().state).toBe('idle');
  });
});

/** Crypto whose sealing can be held, as on a slow TV: `hold()` resolves once a seal waits. */
function slowCrypto() {
  let gate: Promise<void> | undefined;
  let open: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const slow: SyncCrypto = {
    ...crypto,
    async aesGcmEncrypt(key, iv, aad, plain) {
      if (gate) {
        const wait = gate;
        entered();
        await wait;
      }
      return crypto.aesGcmEncrypt(key, iv, aad, plain);
    },
  };
  return {
    crypto: slow,
    hold(): Promise<void> {
      gate = new Promise<void>((resolve) => (open = resolve));
      return new Promise<void>((resolve) => (entered = resolve));
    },
    release() {
      gate = undefined;
      open();
    },
  };
}

/** Storage whose saves of `key` can be held, as a slow IndexedDB's: `hold()` resolves once one waits. */
function slowSaves(key: string) {
  const storage = memoryKeyValueStore();
  let gate: Promise<void> | undefined;
  let open: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const slow: KeyValueStore = {
    ...storage,
    async set(name, value) {
      if (name === key && gate) {
        const wait = gate;
        entered();
        await wait;
      }
      return storage.set(name, value);
    },
  };
  return {
    storage: slow,
    hold(): Promise<void> {
      gate = new Promise<void>((resolve) => (open = resolve));
      return new Promise<void>((resolve) => (entered = resolve));
    },
    release() {
      gate = undefined;
      open();
    },
  };
}

/** The titles an account's My List holds, without its removals. */
async function accountTitles(w: World, code: string): Promise<string[]> {
  const list = (await accountItems(w, code, 'p/main/list')) ?? {};
  return Object.keys(list)
    .filter((key) => !('x' in list[key]!))
    .sort();
}

describe('edits made while the engine works', () => {
  it('keeps an edit made while a push is sealed, and sends it with the next push', async () => {
    const w = world();
    const slow = slowCrypto();
    const a = screen(w, { crypto: slow.crypto });
    await a.start();
    await a.stores.library.add(preview('t1'));
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');

    await w.time.advance(1000);
    await a.stores.library.add(preview('t2'));
    const sealing = slow.hold();
    const push = a.engine.flush();
    await sealing;
    await a.stores.library.remove('t1');
    slow.release();
    await push;
    // t2 went; the removal waits for the next push, and the screen still shows it.
    expect(await accountTitles(w, code)).toEqual(['t1', 't2']);
    expect(titles(a)).toEqual(['t2']);
    expect(a.engine.status().state).toBe('waiting');

    await w.time.advance(3000);
    await settled(a.engine);
    expect(await accountTitles(w, code)).toEqual(['t2']);
    await b.engine.syncNow();
    expect(titles(b)).toEqual(['t2']);
    expect(titles(a)).toEqual(['t2']);
  });

  it('keeps a setting changed again while a push is sealed', async () => {
    const w = world();
    const slow = slowCrypto();
    const a = screen(w, { crypto: slow.crypto });
    await a.start();
    await a.stores.homeLayout.update(() => ({ order: [], hidden: ['r1'] }));
    const code = await a.engine.create();
    await a.engine.confirmCreate();

    await w.time.advance(1000);
    await a.stores.homeLayout.update(() => ({ order: [], hidden: ['r2'] }));
    const sealing = slow.hold();
    const push = a.engine.flush();
    await sealing;
    await a.stores.homeLayout.update(() => ({ order: [], hidden: ['r3'] }));
    slow.release();
    await push;
    expect(a.stores.homeLayout.get().hidden).toEqual(['r3']);
    await w.time.advance(60 * 1000);
    await settled(a.engine);
    expect(a.stores.homeLayout.get().hidden).toEqual(['r3']);
    expect((await accountItems(w, code, 'p/main/settings'))!['home/hidden']).toMatchObject({
      v: ['r3'],
    });
    expect(a.engine.status().state).toBe('idle');
  });

  it('takes a removal made while the engine writes the same store for an edit', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const slow = slowSaves('library');
    const b = screen(w, { storage: slow.storage });
    await b.start();
    await b.engine.join(code, 'use');

    await w.time.advance(1000);
    await a.stores.library.add(preview('a2'));
    await a.engine.flush();
    // While B saves the a2 it pulled, the person removes a1 there.
    const saving = slow.hold();
    const sync = b.engine.syncNow();
    await saving;
    expect(titles(b)).toEqual(['a2', 'a1']);
    void b.stores.library.remove('a1');
    await Promise.resolve();
    expect(titles(b)).toEqual(['a2']);
    slow.release();
    await sync;
    expect(b.engine.status().state).toBe('waiting');

    await b.engine.flush();
    expect(await accountTitles(w, code)).toEqual(['a2']);
    await w.time.advance(1000);
    await a.stores.library.add(preview('a3'));
    await a.engine.flush();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(titles(b)).toEqual(['a3', 'a2']);
    expect(titles(a)).toEqual(['a3', 'a2']);
  });

  it("never takes a store's own trimming for a removal", async () => {
    const w = world();
    // An addons store that keeps its two newest, as a store with a limit does.
    const capped = () => {
      const part = memoryPart('addons', ['a/']);
      const adopt = part.part.adopt;
      part.part.adopt = (change) => {
        const done = adopt(change);
        const keys = part.keys();
        if (keys.length > 2) part.delete(keys[0]!);
        return done;
      };
      return part;
    };
    const aAddons = capped();
    const bAddons = capped();
    const a = screen(w, { addons: aAddons });
    await a.start();
    aAddons.set('a/1', 'one');
    aAddons.set('a/2', 'two');
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const b = screen(w, { addons: bAddons });
    await b.start();
    await b.engine.join(code, 'use');
    expect(bAddons.keys()).toEqual(['a/1', 'a/2']);

    aAddons.delete('a/2');
    aAddons.set('a/3', 'three');
    aAddons.set('a/2', 'two');
    await a.engine.flush();
    await b.engine.syncNow();
    // B took a/3 and cut a/1: that is no removal, so the account keeps it.
    expect(bAddons.keys()).toEqual(['a/2', 'a/3']);
    await b.engine.flush();
    const addons = (await accountItems(w, code, 'addons'))!;
    expect(Object.keys(addons).filter((key) => !('x' in addons[key]!))).toContain('a/1');
    expect(b.engine.status().state).toBe('idle');
  });

  it('adds back a title removed with a time ahead of this screen, and the store takes that time', async () => {
    const w = world();
    const { a, code } = await created(w);
    const shift = { ms: 0 };
    const b = screen(w, { shift });
    await b.start();
    await b.engine.join(code, 'use');
    // B's TV clock is put forward 40 seconds after its last answer from the service.
    shift.ms = 40 * 1000;
    await b.stores.library.add(preview('x'));
    await b.engine.flush();
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['x']);
    const added = a.stores.library.get('x')!.addedAt;

    // The removal goes just after B's time; the title added back 10 seconds later still wins.
    await a.stores.library.remove('x');
    await w.time.advance(10 * 1000);
    await a.stores.library.add(preview('x'));
    await w.time.settle();
    expect(a.stores.library.get('x')!.addedAt).toBe(added + 2);
    await a.engine.flush();
    expect((await accountItems(w, code, 'p/main/list'))!.x).toMatchObject({ t: added + 2 });

    await w.time.advance(60 * 1000);
    await b.stores.library.add(preview('y'));
    await b.engine.flush();
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(titles(a)).toEqual(['y', 'x']);
    expect(titles(b)).toEqual(['y', 'x']);
    expect(a.engine.status().state).toBe('idle');
  });
});

describe('a store behind the account', () => {
  it('catches up at the next sync when the run that moved it on failed', async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await w.time.advance(1000);
    await a.stores.homeLayout.update(() => ({ order: [], hidden: ['r1'] }));
    await a.engine.flush();

    // B's push conflicts and merges A's row; the pull after it meets a blip.
    await b.stores.trackMemory.rememberAudio('t1', 'fr');
    const transport = w.service.transport;
    const post = transport.post;
    let pulls = 0;
    transport.post = (path, body) => {
      if (path === '/v1/pull' && ++pulls === 2) return Promise.reject(new Error('Network'));
      return post(path, body);
    };
    await b.engine.syncNow();
    transport.post = post;
    expect(b.engine.status()).toMatchObject({ state: 'paused', reason: 'offline' });
    expect(((await b.storage.get('sync/base/p/main/settings')) as { apply?: true }).apply).toBe(
      true,
    );

    // The retry 30 seconds later makes the store match, though it pulls nothing new.
    await w.time.advance(30 * 1000);
    await settled(b.engine);
    expect(b.stores.homeLayout.get().hidden).toEqual(['r1']);
    expect(b.engine.status().state).toBe('idle');
    expect(
      ((await b.storage.get('sync/base/p/main/settings')) as { apply?: true }).apply,
    ).toBeUndefined();
  });

  it('tries a store that could not take a change again at the next sync', async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await w.time.advance(1000);
    a.profiles.set('main/name', 'Ann');
    await a.engine.flush();

    b.profiles.failAdopts(true);
    await b.engine.syncNow();
    expect(b.profiles.get('main/name')).toBeUndefined();
    b.profiles.failAdopts(false);
    await b.engine.syncNow();
    expect(b.profiles.get('main/name')?.v).toBe('Ann');
  });

  it('catches up at the next launch even while the service is out of reach', async () => {
    const w = world();
    const storage = memoryKeyValueStore();
    const { a, code } = await created(w);
    const b = screen(w, { storage });
    await b.start();
    await b.engine.join(code, 'use');
    await w.time.advance(1000);
    a.profiles.set('main/name', 'Ann');
    await a.engine.flush();
    b.profiles.failAdopts(true);
    await b.engine.syncNow();

    // The TV goes off. At the next launch the service cannot be reached.
    const again = screen(w, { storage });
    w.service.failNext({ network: true }, { network: true }, { network: true });
    await again.start();
    await w.time.advance(2000);
    await settled(again.engine);
    expect(again.engine.status()).toMatchObject({ state: 'paused', reason: 'offline' });
    expect(again.profiles.get('main/name')?.v).toBe('Ann');
  });
});

describe('changes made while the engine was not running', () => {
  const ONE = { u: 'https://one.example/manifest.json' };
  const TWO = { u: 'https://two.example/manifest.json' };

  /** A copy of a screen's addons that its engine does not watch, as after the TV went off. */
  function offline(from: ReturnType<typeof memoryPart>) {
    const copy = memoryPart('addons', ['a/', 'order']);
    for (const key of from.keys()) copy.set(key, from.get(key)!.v, from.get(key)!.t);
    return copy;
  }

  /** A has an account with addon `one`; B joined it and went off. */
  async function joinedThenOff() {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      s.addons.set('a/one', ONE);
      s.addons.set('order', ['one']);
    });
    const storage = memoryKeyValueStore();
    const b = screen(w, { storage });
    await b.start();
    await b.engine.join(code, 'use');
    await b.engine.syncNow();
    b.engine.hide();
    await settled(b.engine);
    return { w, a, b, code, storage };
  }

  /** B launches again on `addons` and syncs. */
  async function relaunch(
    setUp: Awaited<ReturnType<typeof joinedThenOff>>,
    addons: ReturnType<typeof memoryPart>,
  ) {
    const again = screen(setUp.w, { storage: setUp.storage, addons });
    await again.start();
    await setUp.w.time.advance(2000);
    await settled(again.engine);
    await setUp.a.engine.syncNow();
    return again;
  }

  it('sends an addon installed meanwhile, and another screen gets it', async () => {
    const setUp = await joinedThenOff();
    const addons = offline(setUp.b.addons);
    addons.set('a/two', TWO);
    addons.set('order', ['one', 'two']);
    const again = await relaunch(setUp, addons);
    expect((await accountItems(setUp.w, setUp.code, 'addons'))!['a/two']).toMatchObject({ v: TWO });
    expect(setUp.a.addons.get('a/two')?.v).toEqual(TWO);
    expect(setUp.a.addons.get('order')?.v).toEqual(['one', 'two']);
    expect(again.engine.status().state).toBe('idle');
  });

  it('sends an addon set up again meanwhile', async () => {
    const setUp = await joinedThenOff();
    const addons = offline(setUp.b.addons);
    const configured = { u: 'https://one.example/new-settings/manifest.json' };
    addons.set('a/one', configured);
    await relaunch(setUp, addons);
    expect(setUp.a.addons.get('a/one')?.v).toEqual(configured);
  });

  it('sends an addon removed meanwhile', async () => {
    const setUp = await joinedThenOff();
    const addons = offline(setUp.b.addons);
    addons.delete('a/one');
    addons.set('order', []);
    await relaunch(setUp, addons);
    expect((await accountItems(setUp.w, setUp.code, 'addons'))!['a/one']).toMatchObject({ x: 1 });
    expect(setUp.a.addons.get('a/one')).toBeUndefined();
  });

  it("takes the account's newer change rather than sending what the store had before it", async () => {
    const setUp = await joinedThenOff();
    const { w, a, b, code } = setUp;
    b.engine.show();
    await w.time.advance(1000);
    a.addons.set('a/one', TWO);
    await a.engine.flush();
    // B pulls A's change but its store cannot take it before the TV goes off.
    b.addons.failAdopts(true);
    await b.engine.syncNow();
    b.engine.hide();
    await settled(b.engine);
    expect(b.addons.get('a/one')?.v).toEqual(ONE);

    const addons = offline(b.addons);
    await relaunch(setUp, addons);
    expect((await accountItems(w, code, 'addons'))!['a/one']).toMatchObject({ v: TWO });
    expect(addons.get('a/one')?.v).toEqual(TWO);
    expect(a.addons.get('a/one')?.v).toEqual(TWO);
  });

  it('sends a title added to My List meanwhile', async () => {
    const setUp = await joinedThenOff();
    const stores = setUp.b.storesOf('main');
    await stores.library.load();
    await setUp.w.time.advance(1000);
    await stores.library.add(preview('later'));
    await relaunch(setUp, offline(setUp.b.addons));
    expect(Object.keys((await accountItems(setUp.w, setUp.code, 'p/main/list'))!)).toEqual([
      'later',
    ]);
    expect(titles(setUp.a)).toEqual(['later']);
  });

  it('brings the addons back when the collection fell back to the defaults', async () => {
    const setUp = await joinedThenOff();
    // The saved collection could not be read at launch: only the defaults are there.
    const addons = memoryPart('addons', ['a/', 'order'], { ownData: () => false });
    addons.set('a/default', { u: 'https://default.example/manifest.json' });
    addons.set('order', ['default']);
    const pushes = setUp.w.service.count('/v1/push');
    await relaunch(setUp, addons);
    expect((await accountItems(setUp.w, setUp.code, 'addons'))!['a/one']).toMatchObject({
      v: ONE,
    });
    expect(addons.get('a/one')?.v).toEqual(ONE);
    expect(addons.get('order')?.v).toEqual(['one']);
    expect(setUp.a.addons.get('a/one')?.v).toEqual(ONE);
    // A's Sync now is the only push since: B sent nothing.
    expect(setUp.w.service.count('/v1/push')).toBe(pushes);
  });

  it('sends nothing on a screen without an account', async () => {
    const w = world();
    const addons = memoryPart('addons', ['a/', 'order']);
    addons.set('a/one', ONE);
    const a = screen(w, { addons });
    await a.start();
    await w.time.advance(DAY);
    expect(a.engine.status()).toEqual({ state: 'off' });
    expect(w.service.requests).toEqual([]);
  });
});

describe('a push the service or the size refuses', () => {
  it('keeps pulling past a document too big to send, and seals it again only once it changes', async () => {
    const w = world();
    let bigSeals = 0;
    const counting: SyncCrypto = {
      ...crypto,
      aesGcmEncrypt(key, iv, aad, plain) {
        if (plain.length > 1000 * 1000) bigSeals += 1;
        return crypto.aesGcmEncrypt(key, iv, aad, plain);
      },
    };
    const a = screen(w, { crypto: counting });
    await a.start();
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');

    // An addon whose manifest makes the addons document too big for one body.
    a.addons.set('a/big', { u: 'https://big.example/manifest.json', m: 'x'.repeat(1100 * 1000) });
    await a.stores.library.add(preview('a1'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'too-big' });
    expect(bigSeals).toBe(1);
    // The rest went.
    expect(await accountTitles(w, code)).toEqual(['a1']);

    // What other screens send still comes, at the regular pull too.
    b.profiles.set('main/name', 'Ann');
    await b.engine.flush();
    await a.engine.syncNow();
    expect(a.profiles.get('main/name')?.v).toBe('Ann');
    b.profiles.set('main/name', 'Bob');
    await b.engine.flush();
    await a.stores.library.add(preview('a2'));
    await w.time.advance(30 * 60 * 1000);
    await settled(a.engine);
    expect(a.profiles.get('main/name')?.v).toBe('Bob');
    expect(await accountTitles(w, code)).toEqual(['a1', 'a2']);
    expect(bigSeals).toBe(1);
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'too-big' });

    // Once the addon goes, the document is sent again.
    a.addons.delete('a/big');
    await a.engine.flush();
    expect(a.engine.status().state).toBe('idle');
    expect((await accountItems(w, code, 'addons'))!['a/big']).toMatchObject({ x: 1 });
  });

  it('keeps pulling past a document the full account refuses, and tries it again only when room may have been made', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    const keys = await deriveAccountKeys(crypto, code);
    const watch = await wireName(crypto, keys, 'p/main/watch');
    w.service.limitDocuments(w.service.documents(keys.accountId).size);

    const record = (position: number) =>
      a.stores.progress.record({
        metaId: 'tt1',
        type: 'movie',
        videoId: 'tt1',
        position,
        duration: 6000,
      });
    record(60);
    await a.stores.library.add(preview('a2'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });
    expect(await accountTitles(w, code)).toEqual(['a1', 'a2']);
    expect(w.service.documents(keys.accountId).has(watch)).toBe(false);

    // Not sent again as it stands, while the rest goes and comes.
    const sent = () =>
      w.service.requests.filter(
        (request) =>
          request.path === '/v1/push' &&
          (request.body as { put: Array<{ name: string }> }).put.some((put) => put.name === watch),
      ).length;
    const before = sent();
    await a.stores.library.add(preview('a3'));
    await a.engine.flush();
    await w.time.advance(30 * 60 * 1000);
    await settled(a.engine);
    expect(await accountTitles(w, code)).toEqual(['a1', 'a2', 'a3']);
    expect(sent()).toBe(before);
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });

    // Another screen's change may have made room: the pull that brings it tries once more.
    b.profiles.set('main/name', 'Ann');
    await b.engine.flush();
    await w.time.advance(30 * 60 * 1000);
    await settled(a.engine);
    expect(a.profiles.get('main/name')?.v).toBe('Ann');
    expect(sent()).toBe(before + 1);
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });
    // So does Sync now, once.
    await a.engine.syncNow();
    expect(sent()).toBe(before + 2);
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });

    // Room again, and the progress changes: it goes.
    w.service.limitDocuments(Infinity);
    await w.time.advance(1000);
    record(120);
    await a.engine.flush();
    expect(w.service.documents(keys.accountId).has(watch)).toBe(true);
    expect(a.engine.status().state).toBe('idle');
  });

  it('sends a document the full account refused on Sync now, or as a hold ends, once there is room', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const keys = await deriveAccountKeys(crypto, code);
    const on = (document: string) =>
      wireName(crypto, keys, document).then((name) =>
        w.service.documents(keys.accountId).has(name),
      );
    w.service.limitDocuments(w.service.documents(keys.accountId).size);
    await w.time.advance(1000);
    await a.stores.homeLayout.update(() => ({ order: [], hidden: ['r1'] }));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });

    // Another screen makes room. Nothing here has changed, and Sync now sends it.
    w.service.limitDocuments(Infinity);
    await a.engine.syncNow();
    expect(await on('p/main/settings')).toBe(true);
    expect(a.engine.status().state).toBe('idle');

    // Full again, then the service's daily limit holds pushes while room is made.
    w.service.limitDocuments(w.service.documents(keys.accountId).size);
    a.stores.progress.record({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 60,
      duration: 6000,
    });
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });
    w.service.failNext({
      path: '/v1/push',
      status: 429,
      body: { error: 'limit', retryAfter: 600 },
    });
    await a.stores.library.add(preview('a2'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'limit' });
    w.service.limitDocuments(Infinity);
    await w.time.advance(600 * 1000);
    await settled(a.engine);
    expect(await on('p/main/watch')).toBe(true);
    expect(await accountTitles(w, code)).toEqual(['a1', 'a2']);
    expect(a.engine.status().state).toBe('idle');
  });

  it('sends a document the full account refused when hiding the app ends a hold on pushes', async () => {
    const w = world();
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    w.service.limitDocuments(
      w.service.documents((await deriveAccountKeys(crypto, code)).accountId).size,
    );
    await w.time.advance(1000);
    await a.stores.homeLayout.update(() => ({ order: [], hidden: ['r1'] }));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'full' });

    // A request refused for its size holds pushes while another screen makes room.
    w.service.failNext({ path: '/v1/push', status: 413, body: { error: 'too-big' } });
    await a.stores.library.add(preview('a2'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'too-big' });
    w.service.limitDocuments(Infinity);
    a.engine.hide();
    await settled(a.engine);
    expect((await accountItems(w, code, 'p/main/settings')) ?? {}).not.toEqual({});
    expect(await accountTitles(w, code)).toEqual(['a1', 'a2']);
    expect(a.engine.status().state).toBe('idle');
  });

  it('still pulls in the same sync when other screens keep winning, and keeps the regular pulls', async () => {
    const w = world();
    const { a, code } = await created(w);
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    b.profiles.set('main/name', 'Ann');
    await b.engine.flush();

    w.service.conflictEveryPush(true);
    await a.stores.library.add(preview('a1'));
    await a.engine.syncNow();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'busy' });
    expect(a.profiles.get('main/name')?.v).toBe('Ann');
    w.service.conflictEveryPush(false);
    b.profiles.set('main/name', 'Bob');
    await b.engine.flush();
    w.service.conflictEveryPush(true);
    // The pushes back off 30 seconds, then 2 minutes; the pull every 30 minutes goes on.
    await w.time.advance(30 * 60 * 1000);
    await settled(a.engine);
    expect(a.profiles.get('main/name')?.v).toBe('Bob');
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'busy' });
    w.service.conflictEveryPush(false);
    await a.engine.flush();
    expect(await accountTitles(w, code)).toEqual(['a1']);
    expect(a.engine.status().state).toBe('idle');
  });
});

describe('what the engine kept, unreadable', () => {
  /** The TV's storage, read through a store whose reads of `key` fail `times` times. */
  function failingReads(storage: KeyValueStore, key: string, times: number): KeyValueStore {
    let left = times;
    return {
      ...storage,
      get(name) {
        if (name !== key || left === 0) return storage.get(name);
        left -= 1;
        return Promise.reject(new Error('IDB transaction aborted'));
      },
    };
  }

  /**
   * Lets the test's time pass until `promise` settles: the engine's reads are
   * tried again on its timers, after Web Crypto, which takes real time.
   */
  async function whileTimePasses(w: World, promise: Promise<unknown>): Promise<unknown> {
    let outcome: { value: unknown } | undefined;
    void promise.then(
      (value) => (outcome = { value }),
      (error: unknown) => (outcome = { value: error }),
    );
    await vi.waitFor(async () => {
      await w.time.advance(250);
      if (!outcome) throw new Error('Still waiting');
    });
    return outcome!.value;
  }

  async function signedIn(w: World) {
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
      await s.stores.library.add(preview('a2'));
    });
    const storage = memoryKeyValueStore();
    const b = screen(w, { storage });
    await b.start();
    await b.engine.join(code, 'use');
    return { a, code, storage };
  }

  it('fails the start rather than read as no account, and watches nothing', async () => {
    const w = world();
    const { code, storage } = await signedIn(w);
    const requests = w.service.requests.length;
    const b = screen(w, {
      storage,
      engineStorage: failingReads(storage, 'sync/state', Infinity),
    });
    expect(await whileTimePasses(w, b.start())).toBeInstanceOf(Error);
    await expect(b.engine.join(code, 'use')).rejects.toMatchObject({ problem: 'not-started' });
    await b.stores.library.remove('a2');
    await w.time.advance(60 * 1000);
    expect(w.service.requests.length).toBe(requests);
    expect(await storage.get('sync/state')).toMatchObject({ phase: 'ready' });
    expect(await storage.get('sync/pend/p/main/list')).toBeUndefined();
  });

  it('tries a read that failed once again, and starts', async () => {
    const w = world();
    const { storage } = await signedIn(w);
    const b = screen(w, { storage, engineStorage: failingReads(storage, 'sync/state', 1) });
    expect(await whileTimePasses(w, b.start())).toBeUndefined();
    expect(b.engine.status().state).not.toBe('off');
    await b.stores.library.remove('a2');
    await b.engine.flush();
    expect(b.engine.status().state).toBe('idle');
  });

  it("fails the start when a document's waiting edits cannot be read, says nothing of the account, and keeps them", async () => {
    const w = world();
    const { a, code, storage } = await signedIn(w);
    const b = screen(w, { storage });
    await b.start();
    // Offline: the removal waits in sync/pend.
    w.service.failNext({ network: true }, { network: true }, { network: true });
    await b.stores.library.remove('a2');
    await b.engine.flush();
    expect(await storage.get('sync/pend/p/main/list')).toBeDefined();

    const broken = screen(w, {
      storage,
      engineStorage: failingReads(storage, 'sync/pend/p/main/list', Infinity),
    });
    expect(await whileTimePasses(w, broken.start())).toBeInstanceOf(Error);
    expect(titles(broken)).toEqual(['a1']);
    // As when the state itself cannot be read: not In sync while nothing is watched.
    expect(broken.engine.status().state).toBe('off');
    expect(broken.engine.code()).toBeUndefined();
    const requests = w.service.requests.length;
    await broken.engine.syncNow();
    await w.time.advance(60 * 1000);
    expect(w.service.requests.length).toBe(requests);

    const again = screen(w, { storage });
    await again.start();
    await again.engine.syncNow();
    expect(titles(again)).toEqual(['a1']);
    expect(await accountTitles(w, code)).toEqual(['a1']);
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['a1']);
  });
});

describe('setting up', () => {
  /** A transport whose pulls wait until `release`. */
  function slowPulls(w: World) {
    let gate: Promise<void> | undefined;
    let open: () => void = () => undefined;
    const transport: SyncTransport = {
      get: (path) => w.service.transport.get(path),
      async post(path, body) {
        if (path === '/v1/pull' && gate) await gate;
        return w.service.transport.post(path, body);
      },
    };
    return {
      transport,
      hold() {
        gate = new Promise<void>((resolve) => (open = resolve));
      },
      release() {
        gate = undefined;
        open();
      },
    };
  }

  it('runs one join at a time, and keeps the copy of what the screen had', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const slow = slowPulls(w);
    const b = screen(w, { transport: slow.transport, others: ['guest'] });
    await b.start();
    await b.stores.library.add(preview('b1'));
    slow.hold();
    const first = b.engine.join(code, 'use');
    await w.time.settle();
    // Try now, while the first is still going.
    const second = b.engine.join(code, 'use');
    expect(second).toBe(first);
    // Anything else waits for it.
    const create = b.engine.create().catch((error: SyncSetupError) => error.problem);
    slow.release();
    await first;
    expect(await create).toBe('signed-in');
    expect(titles(b)).toEqual(['a1']);
    const aside = (await b.storage.get('sync-aside')) as {
      documents: { [document: string]: Array<[string, unknown]> };
    };
    expect(aside.documents['p/main/list']!.map(([key]) => key)).toEqual(['b1']);
    expect(aside.documents.profiles!.map(([key]) => key)).toContain('guest');
    expect(b.joined).not.toHaveBeenCalled();
  });

  it('carries on a join the service did not answer, and says when it is done', async () => {
    const w = world();
    const { code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
    });
    const b = screen(w);
    await b.start();
    w.service.failNext({ path: '/v1/pull', network: true });
    await expect(b.engine.join(code, 'use')).rejects.toMatchObject({ problem: 'offline' });
    expect(b.engine.status().state).toBe('setup');
    await w.time.advance(29 * 1000);
    expect(b.joined).not.toHaveBeenCalled();
    await w.time.advance(1000);
    await vi.waitFor(() => expect(b.joined).toHaveBeenCalled());
    expect(titles(b)).toEqual(['a1']);
    expect(b.engine.status().state).not.toBe('setup');
    // Pressing Try now after that finds the join done.
    await b.engine.join(code, 'use');
  });

  it('lets Try now take over a join that is carrying on by itself', async () => {
    const w = world();
    const { code } = await created(w);
    const b = screen(w);
    await b.start();
    w.service.failNext({ path: '/v1/pull', network: true });
    await expect(b.engine.join(code, 'use')).rejects.toMatchObject({ problem: 'offline' });
    await b.engine.join(code, 'use');
    await w.time.advance(DAY);
    // The person's join finished it: nothing carries on behind it.
    expect(b.joined).not.toHaveBeenCalled();
    expect(b.engine.status().state).toBe('idle');
  });

  it('sends the setup key the service asks for, and keeps it only until the account exists', async () => {
    const w = world(1, 'setup-key');
    const a = screen(w);
    await a.start();
    await expect(a.engine.create()).rejects.toMatchObject({ problem: 'key' });
    expect(await a.storage.get('sync/state')).toBeUndefined();
    await expect(a.engine.create({ key: 'wrong' })).rejects.toMatchObject({ problem: 'key' });
    expect(a.engine.status().state).toBe('off');

    // Out of reach: the key is kept, and carrying on at the next launch sends it again.
    w.service.failNext({ path: '/v1/account/create', network: true });
    await expect(a.engine.create({ key: 'setup-key' })).rejects.toMatchObject({
      problem: 'offline',
    });
    expect(await a.storage.get('sync/state')).toMatchObject({ key: 'setup-key' });
    const again = screen(w, { storage: a.storage });
    await again.start();
    const code = await again.engine.create();
    expect(code).toBe(a.engine.code());
    const create = w.service.requests.filter((r) => r.path === '/v1/account/create').pop()!;
    expect((create.body as { key?: string }).key).toBe('setup-key');
    expect(await again.storage.get('sync/state')).not.toHaveProperty('key');
    await again.engine.confirmCreate();
    expect(again.engine.status().state).toBe('idle');
  });

  it('gives a create, confirm, leave or delete asked again while it runs the same answer', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    const create = a.engine.create();
    expect(a.engine.create()).toBe(create);
    await create;
    const confirm = a.engine.confirmCreate();
    expect(a.engine.confirmCreate()).toBe(confirm);
    await confirm;
    expect(w.service.count('/v1/account/create')).toBe(1);

    const remove = a.engine.deleteAccount();
    expect(a.engine.deleteAccount()).toBe(remove);
    // A leave asked meanwhile waits for it, and finds nothing left to do.
    const leave = a.engine.leave();
    expect(a.engine.leave()).toBe(leave);
    await remove;
    await leave;
    expect(w.service.count('/v1/account/delete')).toBe(1);
    expect(a.engine.status().state).toBe('off');
  });

  it('runs one setup call at a time: a join asked while a create runs waits, then finds the screen signed in', async () => {
    const w = world(5);
    const { code } = await created(w);
    // Working out the new account's keys takes a while: a join is asked meanwhile.
    let gate: Promise<void> | undefined;
    let open: () => void = () => undefined;
    const slow: SyncCrypto = {
      ...crypto,
      async hkdf(ikm, salt, info, length) {
        if (gate) await gate;
        return crypto.hkdf(ikm, salt, info, length);
      },
    };
    const b = screen(w, { crypto: slow });
    await b.start();
    gate = new Promise<void>((resolve) => (open = resolve));
    const create = b.engine.create();
    await w.time.settle();
    const join = b.engine.join(code, 'use').catch((error: SyncSetupError) => error.problem);
    gate = undefined;
    open();
    const made = await create;
    expect(await join).toBe('signed-in');
    expect(made).not.toBe(code);
    expect(b.engine.code()).toBe(made);
    const keys = await deriveAccountKeys(crypto, made);
    expect(await b.storage.get('sync/state')).toMatchObject({
      phase: 'creating',
      accountId: keys.accountId,
    });
    await b.engine.confirmCreate();
    expect(b.engine.status().state).toBe('idle');
  });
});

describe('bringing back what Use set aside', () => {
  const SHARED = 'https://shared.example/manifest.json';
  const MINE = 'https://mine.example/manifest.json';

  /** The ids of the titles in the account's My List for `profile`, sorted. */
  async function accountList(w: World, code: string, profile = 'main'): Promise<string[]> {
    return Object.keys((await accountItems(w, code, `p/${profile}/list`)) ?? {}).sort();
  }

  /**
   * Screen A makes the account; screen B, with Guest, titles, a video part
   * way, Home arranged and addons of its own, joins it with Use. B's engine
   * reads its storage through a store whose throwing away of the copy can be
   * made to fail, as when the TV goes off just before.
   */
  async function usedAccount(w: World, others: string[] = ['guest']) {
    const { a, code } = await created(w, async (s) => {
      await s.stores.library.add(preview('a1'));
      await s.stores.homeLayout.update(() => ({ order: ['x', 'y'], hidden: [] }));
      s.addons.set('a/shared', { u: SHARED, m: { name: 'Shared' } });
    });
    const storage = memoryKeyValueStore();
    const drops = { fail: false };
    const engineStorage: KeyValueStore = {
      ...storage,
      delete(key) {
        if (key === 'sync-aside' && drops.fail) return Promise.reject(new Error('IDB aborted'));
        return storage.delete(key);
      },
    };
    const b = screen(w, { storage, engineStorage, others });
    await b.start();
    await w.time.advance(1000);
    await b.stores.library.add(preview('b1'));
    b.stores.progress.record({
      metaId: 'tt9',
      type: 'movie',
      videoId: 'tt9',
      position: 600,
      duration: 6000,
    });
    // Only rows the account orders too, so the account's order is all there is to it.
    await b.stores.homeLayout.update(() => ({ order: ['x'], hidden: ['h'] }));
    b.addons.set('a/mine', { u: MINE, m: { name: 'Mine' } });
    // The account's addon, installed here under another name.
    b.addons.set('a/again', { u: SHARED, m: { name: 'Shared' } });
    for (const id of others) await b.storesOf(id).library.add(preview(`${id}-title`));
    await b.engine.join(code, 'use');
    return { a, b, code, storage, drops };
  }

  it("signed in, brings the copy's profiles, titles and addons into the account, the account's settings winning", async () => {
    const w = world();
    const { a, b, code, storage } = await usedAccount(w);
    expect(titles(b)).toEqual(['a1']);
    expect(b.profiles.keys()).toEqual(['main']);
    expect(await b.engine.asideCopy()).toEqual({
      profiles: [{ id: 'main' }, { id: 'guest', name: 'guest' }],
      list: 2,
      watching: 1,
      addons: ['Mine', 'Shared'],
      until: START + 1000 + 30 * DAY,
    });

    expect(await b.engine.bringBack()).toEqual({ profiles: true });
    expect(b.profiles.keys()).toEqual(['guest', 'guest/name', 'main']);
    // My List and Continue Watching keep their own times.
    expect(titles(b)).toEqual(['b1', 'a1']);
    expect(b.stores.progress.get('tt9')).toMatchObject({ position: 600 });
    const guest = b.storesOf('guest');
    await guest.library.load();
    expect(guest.library.items().map((item) => item.id)).toEqual(['guest-title']);
    // The account's row order wins; the hidden row it had none of comes back.
    expect(b.stores.homeLayout.get()).toEqual({ order: ['x', 'y'], hidden: ['h'] });
    // An addon the account has nowhere comes back; one at the account's address does not.
    expect(b.addons.keys()).toEqual(['a/mine', 'a/shared']);
    expect(await storage.get('sync-aside')).toBeUndefined();
    expect(await b.engine.asideCopy()).toBeUndefined();

    // Sent at once, and the other screen gets it all.
    expect(await accountList(w, code)).toEqual(['a1', 'b1']);
    expect(await accountList(w, code, 'guest')).toEqual(['guest-title']);
    expect(Object.keys((await accountItems(w, code, 'profiles'))!).sort()).toEqual([
      'guest',
      'guest/name',
      'main',
    ]);
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['b1', 'a1']);
    expect(a.profiles.keys()).toEqual(['guest', 'guest/name', 'main']);
    expect(a.addons.keys()).toEqual(['a/mine', 'a/shared']);
    expect(a.stores.homeLayout.get()).toEqual({ order: ['x', 'y'], hidden: ['h'] });
    await expect(b.engine.bringBack()).rejects.toMatchObject({ problem: 'none' });
  });

  it('refuses past six profiles and changes nothing', async () => {
    const w = world();
    const { a, b, code, storage } = await usedAccount(w, ['guest', 'g2', 'g3']);
    // Meanwhile another screen adds three profiles to the account.
    for (const id of ['p1', 'p2', 'p3']) {
      a.profiles.set(id, 1);
      a.profiles.set(`${id}/name`, id);
    }
    await a.engine.flush();
    const copy = await storage.get('sync-aside');
    const pushes = w.service.count('/v1/push');

    await expect(b.engine.bringBack()).rejects.toMatchObject({ problem: 'profiles' });
    expect(await storage.get('sync-aside')).toEqual(copy);
    expect(titles(b)).toEqual(['a1']);
    expect(b.addons.keys()).toEqual(['a/shared']);
    expect(w.service.count('/v1/push')).toBe(pushes);
    expect(await accountList(w, code)).toEqual(['a1']);
    expect(b.engine.status().state).toBe('idle');

    // With a profile deleted in the account, they fit.
    a.profiles.delete('p3');
    a.profiles.delete('p3/name');
    await a.engine.flush();
    await b.engine.bringBack();
    expect(b.profiles.keys().filter((key) => key.indexOf('/') === -1)).toEqual([
      'g2',
      'g3',
      'guest',
      'main',
      'p1',
      'p2',
    ]);
  });

  it('signed out after leaving, puts back what the screen had and sends nothing', async () => {
    const w = world();
    const { b, storage } = await usedAccount(w);
    await b.engine.leave();
    // Changed here since: what the screen has now wins.
    await b.stores.homeLayout.update(() => ({ order: ['q'], hidden: [] }));
    const requests = w.service.requests.length;

    expect(await b.engine.bringBack()).toEqual({ profiles: true });
    expect(w.service.requests.length).toBe(requests);
    expect(b.engine.status().state).toBe('off');
    expect(b.profiles.keys()).toEqual(['guest', 'guest/name', 'main']);
    expect(titles(b)).toEqual(['b1', 'a1']);
    expect(b.stores.progress.get('tt9')).toMatchObject({ position: 600 });
    expect(b.stores.homeLayout.get()).toEqual({ order: ['q'], hidden: ['h'] });
    expect(b.addons.keys()).toEqual(['a/mine', 'a/shared']);
    expect(await storage.get('sync-aside')).toBeUndefined();
  });

  it('carries on at the next launch when interrupted, and changes nothing twice', async () => {
    const w = world();
    const { a, b, code, storage, drops } = await usedAccount(w);
    // The TV goes off just as the copy would be thrown away.
    drops.fail = true;
    await b.engine.bringBack();
    expect(await storage.get('sync-aside')).toMatchObject({ back: true });
    expect(await accountList(w, code)).toEqual(['a1', 'b1']);
    const pushes = w.service.count('/v1/push');

    const again = screen(w, { storage, profiles: b.profiles, addons: b.addons });
    await again.start();
    await vi.waitFor(async () => expect(await storage.get('sync-aside')).toBeUndefined());
    await settled(again.engine);
    expect(titles(again)).toEqual(['b1', 'a1']);
    expect(again.profiles.keys()).toEqual(['guest', 'guest/name', 'main']);
    // Everything had come back already: nothing more to send, and no reason to start again.
    expect(w.service.count('/v1/push')).toBe(pushes);
    expect(again.broughtBack).not.toHaveBeenCalled();
    await a.engine.syncNow();
    expect(titles(a)).toEqual(['b1', 'a1']);
  });

  it('cut off while the addons store saves what came back, brings it into the store at the next launch rather than removing it', async () => {
    const w = world();
    const { b, code, storage } = await usedAccount(w);
    // The addons store as it was saved before, and the TV going off while it saves again.
    const saved = memoryPart('addons', ['a/', 'order']);
    for (const key of b.addons.keys()) saved.set(key, b.addons.get(key)!.v);
    const adopt = b.addons.part.adopt.bind(b.addons.part);
    b.addons.part.adopt = (change) => {
      void adopt(change);
      return new Promise<void>(() => undefined);
    };
    void b.engine.bringBack();
    await vi.waitFor(async () => expect(await storage.get('sync/pend/addons')).toBeTruthy());
    expect(await storage.get('sync-aside')).toMatchObject({ back: true });

    const again = screen(w, { storage, profiles: b.profiles, addons: saved });
    await again.start();
    await vi.waitFor(async () => expect(await storage.get('sync-aside')).toBeUndefined());
    await again.engine.syncNow();
    expect(again.addons.keys()).toEqual(['a/mine', 'a/shared']);
    const account = (await accountItems(w, code, 'addons'))!;
    expect(account['a/mine']).toMatchObject({ v: { u: MINE } });
  });

  it('carries on at the next launch when interrupted before anything changed, and says the profiles came back', async () => {
    const w = world();
    const { b, code, storage } = await usedAccount(w);
    // Marked, and then the TV went off.
    await storage.set('sync-aside', { ...(await storage.get('sync-aside'))!, back: true });

    const again = screen(w, { storage, profiles: b.profiles, addons: b.addons });
    await again.start();
    await vi.waitFor(() => expect(again.broughtBack).toHaveBeenCalled());
    expect(again.profiles.keys()).toEqual(['guest', 'guest/name', 'main']);
    expect(titles(again)).toEqual(['b1', 'a1']);
    expect(await storage.get('sync-aside')).toBeUndefined();
    expect(await accountList(w, code, 'guest')).toEqual(['guest-title']);
  });

  it('keeps a copy being brought back past its 30 days, and refuses one that ran out', async () => {
    const w = world();
    const { b, storage } = await usedAccount(w);
    const copy = (await storage.get('sync-aside')) as object;
    await w.time.advance(31 * DAY);
    expect(await b.engine.asideCopy()).toBeUndefined();
    await expect(b.engine.bringBack()).rejects.toMatchObject({ problem: 'none' });
    expect(await storage.get('sync-aside')).toBeUndefined();

    // A launch carrying on one marked just before it ran out finishes it.
    await storage.set('sync-aside', { ...copy, documents: {}, back: true });
    const again = screen(w, { storage, profiles: b.profiles, addons: b.addons });
    await again.start();
    await vi.waitFor(async () => expect(await storage.get('sync-aside')).toBeUndefined());
  });

  it('runs one at a time with the other setup calls, and gives a second call the same answer', async () => {
    const w = world();
    const { b } = await usedAccount(w);
    const back = b.engine.bringBack();
    expect(b.engine.bringBack()).toBe(back);
    // A leave asked meanwhile waits for it: the copy comes back into the account first.
    const leave = b.engine.leave();
    await back;
    await leave;
    expect(b.engine.status().state).toBe('off');
    expect(titles(b)).toEqual(['b1', 'a1']);
  });

  it("changes nothing when the service can't be reached, and refuses while a join carries on", async () => {
    const w = world(2);
    const { b, storage } = await usedAccount(w);
    const copy = await storage.get('sync-aside');
    w.service.failNext({ path: '/v1/pull', network: true });
    await expect(b.engine.bringBack()).rejects.toMatchObject({ problem: 'offline' });
    expect(await storage.get('sync-aside')).toEqual(copy);
    expect(titles(b)).toEqual(['a1']);

    await b.engine.leave();
    const { code: other } = await created(w);
    w.service.failNext({ path: '/v1/pull', network: true });
    await expect(b.engine.join(other, 'use')).rejects.toMatchObject({ problem: 'offline' });
    await expect(b.engine.bringBack()).rejects.toMatchObject({ problem: 'signed-in' });
    expect(await storage.get('sync-aside')).toEqual(copy);
  });
});
