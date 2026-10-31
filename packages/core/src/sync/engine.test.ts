import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { toBase64Url, utf8Encode } from './bytes';
import { createAccountClock } from './clock';
import { createSyncEngine, type SyncEngine, SyncSetupError } from './engine';
import type { Items } from './items';
import { deriveAccountKeys, wireName } from './keys';
import { createProfileStores, profileParts } from './parts';
import { openDocument } from './seal';
import { fakeSyncService, manualTimers, memoryPart, webCryptoForTests } from './testing';

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

function world(maxAccounts = 1) {
  const time = manualTimers();
  const now = () => START + time.elapsed();
  const service = fakeSyncService({ now, maxAccounts });
  return { time, now, service };
}

type World = ReturnType<typeof world>;

/** One TV: its storage, clock, stores and engine, with Main (and any `others`) as profiles. */
function screen(
  w: World,
  options: { storage?: KeyValueStore; profile?: string; others?: string[]; skew?: number } = {},
) {
  const storage = options.storage ?? memoryKeyValueStore();
  const skew = options.skew ?? 0;
  const clock = createAccountClock({ now: () => w.now() + skew });
  const profiles = memoryPart('profiles');
  profiles.set('main', 1, 0);
  for (const id of options.others ?? []) {
    profiles.set(id, 1);
    profiles.set(`${id}/name`, id);
  }
  const addons = memoryPart('addons', ['a/', 'order']);
  const storesOf = (id: string) =>
    createProfileStores(
      profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix(id))),
      clock.now,
    );
  const profileId = options.profile ?? 'main';
  const stores = storesOf(profileId);
  const parts = profileParts(profileId, stores);
  const joined = vi.fn();
  const engine = createSyncEngine({
    crypto,
    transport: w.service.transport,
    storage,
    clock,
    timers: w.time.timers,
    accountParts: [profiles.part, addons.part],
    profileParts: (id) => profileParts(id, storesOf(id)),
    onJoined: joined,
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

  it('pulls two seconds after start, when back after two minutes away, and on Sync now', async () => {
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
    await w.time.advance(60 * 1000);
    b.engine.show();
    expect(pulls()).toBe(before + 1);
    b.engine.hide();
    await w.time.advance(2 * 60 * 1000);
    b.engine.show();
    await settled(b.engine);
    expect(pulls()).toBe(before + 2);
    await b.engine.syncNow();
    expect(pulls()).toBe(before + 3);
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

  it('waits as long as the service asks when a limit is reached', async () => {
    const w = world();
    const { a } = await created(w);
    w.service.failNext({
      path: '/v1/push',
      status: 429,
      body: { error: 'limit', retryAfter: 3600 },
    });
    await a.stores.library.add(preview('a1'));
    await a.engine.flush();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'limit' });
    expect(w.time.nextDue() - w.time.elapsed()).toBe(3600 * 1000);
    const pushes = w.service.count('/v1/push');
    a.engine.hide();
    expect(w.service.count('/v1/push')).toBe(pushes);
  });

  it('pauses for a document too big to push', async () => {
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
