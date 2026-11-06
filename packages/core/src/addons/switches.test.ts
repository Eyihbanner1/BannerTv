import { describe, expect, it, vi } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { createAccountClock } from '../sync/clock';
import { createSyncEngine } from '../sync/engine';
import type { Items, LiveItem } from '../sync/items';
import { deriveAccountKeys, wireName } from '../sync/keys';
import type { PartChange, SyncPart } from '../sync/part';
import { collectionPart, createProfileStores, profileParts } from '../sync/parts';
import { openDocument } from '../sync/seal';
import { fakeSyncService, manualTimers, memoryPart, webCryptoForTests } from '../sync/testing';
import { createAddonCollection, installIdOf } from './collection';
import { BANNERTV_DEMO_URL, CINEMETA_URL, DEFAULT_ADDONS, OPENSUBTITLES_V3_URL } from './defaults';
import { addonSwitchesPart, createAddonSwitches, switchedOnOnly } from './switches';

/** A configured addon: its address holds a key, which nothing about its switch may hold. */
const EXTRA_URL = 'https://addon.example.com/key=secret123/manifest.json';
const EXTRA_MANIFEST = {
  id: 'org.example',
  version: '1.0.0',
  name: 'Example',
  types: ['movie'],
  resources: ['stream'],
};

/** Lets the persisted stores finish their reads and saves. The core has no timers to wait on. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setup(storage = memoryKeyValueStore()) {
  const fetchJson = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(EXTRA_MANIFEST));
  const collection = createAddonCollection({
    storage,
    fetchJson,
    defaults: DEFAULT_ADDONS,
    now: () => 1000,
  });
  const switches = createAddonSwitches({ storage, collection });
  const view = switchedOnOnly(collection, switches);
  /** The install name of the addon at `url`. */
  const idOf = (url: string) =>
    installIdOf(collection.get().addons.find((addon) => addon.transportUrl === url)!);
  return { storage, fetchJson, collection, switches, view, idOf };
}

const urls = (collection: { get(): { addons: readonly { transportUrl: string }[] } }) =>
  collection.get().addons.map((addon) => addon.transportUrl);

describe('createAddonSwitches', () => {
  it('keeps the installs switched off by their names, never their addresses', async () => {
    const { storage, collection, switches, idOf } = setup();
    await collection.load();
    await collection.install(EXTRA_URL);
    await switches.load();
    expect(switches.get()).toEqual({ ready: true, off: new Set() });

    switches.set(idOf(EXTRA_URL), true);
    await settle();
    expect(switches.get().off).toEqual(new Set([idOf(EXTRA_URL)]));
    expect(switches.isOff(collection.get().addons[3]!)).toBe(true);
    const saved = await storage.get('addons.off');
    expect(saved).toEqual([idOf(EXTRA_URL)]);
    expect(JSON.stringify(saved)).not.toContain('secret123');

    // Switching it on again is the only change: its address and place stay.
    switches.set(idOf(EXTRA_URL), false);
    await settle();
    expect(switches.get().off.size).toBe(0);
    expect(await storage.get('addons.off')).toEqual([]);
    expect(urls(collection)[3]).toBe(EXTRA_URL);
  });

  it('gives the same object until a switch changes', async () => {
    const { collection, switches, idOf } = setup();
    await collection.load();
    await switches.load();
    const first = switches.get();
    expect(switches.get()).toBe(first);
    switches.set(idOf(CINEMETA_URL), false);
    await settle();
    expect(switches.get()).toBe(first);
    switches.set(idOf(CINEMETA_URL), true);
    await settle();
    expect(switches.get()).not.toBe(first);
  });

  it('reads what was saved, and lays a switch made at launch over it', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('addons.off', ['a', 'b', 7, '']);
    const { collection, switches } = setup(storage);
    await collection.load();
    switches.set('c', true);
    switches.set('a', false);
    expect(switches.get().ready).toBe(false);
    await switches.load();
    await settle();
    expect(switches.get()).toEqual({ ready: true, off: new Set(['b', 'c']) });
  });

  it('forgets the switch of an install that is removed, so it comes back on when added again', async () => {
    const { storage, collection, switches, idOf } = setup();
    await collection.load();
    await collection.install(EXTRA_URL);
    await switches.load();
    const id = idOf(EXTRA_URL);
    switches.set(id, true);
    switches.set(idOf(CINEMETA_URL), true);
    await settle();

    collection.remove(EXTRA_URL);
    await settle();
    expect(switches.get().off).toEqual(new Set([idOf(CINEMETA_URL)]));
    expect(await storage.get('addons.off')).toEqual([idOf(CINEMETA_URL)]);
    await collection.install(EXTRA_URL);
    expect(switches.isOff(collection.get().addons[3]!)).toBe(false);
  });

  it('keeps the switch of an addon set up again with new settings', async () => {
    const { collection, switches, idOf } = setup();
    await collection.load();
    await collection.install(EXTRA_URL);
    await switches.load();
    switches.set(idOf(EXTRA_URL), true);
    await settle();
    const reconfigured = 'https://addon.example.com/key=other456/manifest.json';
    const addon = await collection.install(reconfigured, { replaces: EXTRA_URL });
    await settle();
    expect(switches.isOff(addon)).toBe(true);
  });

  it('a removal before the saved switches are read still takes its switch', async () => {
    const storage = memoryKeyValueStore();
    const first = setup(storage);
    await first.collection.load();
    await first.collection.install(EXTRA_URL);
    const id = first.idOf(EXTRA_URL);
    await storage.set('addons.off', [id]);

    const { collection, switches } = setup(storage);
    await collection.load();
    collection.remove(EXTRA_URL);
    await switches.load();
    await settle();
    expect(switches.get().off.size).toBe(0);
  });
});

describe('switchedOnOnly', () => {
  it('leaves switched-off installs out, in the same order, until they are switched on', async () => {
    const { collection, switches, view, idOf } = setup();
    await view.load();
    expect(view.get().ready).toBe(true);
    // Nothing off: the collection's own state, so nothing changes for anyone.
    expect(view.get()).toBe(collection.get());

    switches.set(idOf(CINEMETA_URL), true);
    await settle();
    expect(urls(view)).toEqual([BANNERTV_DEMO_URL, OPENSUBTITLES_V3_URL]);
    expect(urls(collection)).toEqual([BANNERTV_DEMO_URL, CINEMETA_URL, OPENSUBTITLES_V3_URL]);
    expect(view.get().addons[0]).toBe(collection.get().addons[0]);
    expect(view.toStored().map((item) => item.transportUrl)).toEqual(urls(view));

    switches.set(idOf(CINEMETA_URL), false);
    await settle();
    expect(view.get()).toBe(collection.get());
  });

  it('is not ready until the switches have been read, so an addon off is never asked first', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('addons.off', ['nothing-here']);
    const { collection, switches, view } = setup(storage);
    await collection.load();
    expect(view.get()).toEqual({ ready: false, addons: [] });
    expect(view.get()).toBe(view.get());
    await switches.load();
    expect(view.get().ready).toBe(true);
    expect(view.get().addons).toHaveLength(3);
  });

  it('gives the same object, and tells nobody, until what it holds changes', async () => {
    const { collection, switches, view, idOf } = setup();
    await view.load();
    await collection.install(EXTRA_URL);
    switches.set(idOf(EXTRA_URL), true);
    await settle();
    const listener = vi.fn();
    const off = view.subscribe(listener);
    const shown = view.get();

    // Moving the switched-off addon changes the collection, but nothing the view holds.
    collection.move(EXTRA_URL, -1);
    expect(urls(collection)[2]).toBe(EXTRA_URL);
    expect(view.get()).toBe(shown);
    expect(listener).not.toHaveBeenCalled();

    collection.move(CINEMETA_URL, -1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(urls(view)).toEqual([CINEMETA_URL, BANNERTV_DEMO_URL, OPENSUBTITLES_V3_URL]);
    off();
    collection.move(CINEMETA_URL, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('adds, moves and removes over every install, as the collection does', async () => {
    const { collection, switches, view, idOf, fetchJson } = setup();
    await view.load();
    switches.set(idOf(CINEMETA_URL), true);
    await settle();
    const added = await view.install(EXTRA_URL);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(added.transportUrl).toBe(EXTRA_URL);
    expect(urls(view)).toEqual([BANNERTV_DEMO_URL, OPENSUBTITLES_V3_URL, EXTRA_URL]);
    view.remove(CINEMETA_URL);
    expect(urls(collection)).toEqual([BANNERTV_DEMO_URL, OPENSUBTITLES_V3_URL, EXTRA_URL]);
  });
});

function change(set: Array<[string, LiveItem]> = [], remove: string[] = []): PartChange {
  return { set: new Map(set), remove };
}

describe('addonSwitchesPart', () => {
  it('lists each switched-off install as off/<installId> in addons', async () => {
    const { collection, switches, idOf } = setup();
    await collection.load();
    const part = addonSwitchesPart(switches);
    await part.load();
    expect(part.document).toBe('addons');
    expect(part.prefixes).toEqual(['off/']);
    expect(part.snapshot().size).toBe(0);
    expect(part.ownData!()).toBe(false);

    switches.set(idOf(CINEMETA_URL), true);
    await settle();
    expect(Array.from(part.snapshot())).toEqual([[`off/${idOf(CINEMETA_URL)}`, { v: 1 }]]);
    expect(part.ownData!()).toBe(true);
  });

  it("takes the account's switches before adopt returns, leaving values it does not know", async () => {
    const { collection, switches } = setup();
    await collection.load();
    const part = addonSwitchesPart(switches);
    await part.load();
    switches.set('one', true);
    await settle();

    const adopted = part.adopt(
      change(
        [
          ['off/two', { t: 5, v: 1 }],
          ['off/three', { t: 5, v: 'later' }],
        ],
        ['off/one'],
      ),
    );
    expect(Array.from(part.snapshot().keys())).toEqual(['off/two']);
    await adopted;
    // Switched back on everywhere is a removal.
    void part.adopt(change([], ['off/two']));
    expect(part.snapshot().size).toBe(0);
  });
});

// Two screens in one account, through the real engine and a fake service.
const crypto = webCryptoForTests();
const START = Date.UTC(2026, 10, 1, 12, 0, 0) + 123;

function world() {
  const time = manualTimers();
  const now = () => START + time.elapsed();
  return { time, now, service: fakeSyncService({ now }) };
}

type World = ReturnType<typeof world>;

/**
 * A screen with the default addons and, unless `older`, the switches' part.
 * Given the storage of an older screen, it is that screen updated in place.
 */
function screen(w: World, options: { older?: boolean; storage?: KeyValueStore } = {}) {
  const storage = options.storage ?? memoryKeyValueStore();
  const clock = createAccountClock({ now: w.now });
  const profiles = memoryPart('profiles');
  profiles.set('main', 1, 0);
  const collection = createAddonCollection({
    storage,
    fetchJson: () => Promise.resolve(EXTRA_MANIFEST),
    defaults: DEFAULT_ADDONS,
    now: w.now,
  });
  const switches = createAddonSwitches({ storage, collection });
  const accountParts: SyncPart[] = [profiles.part, collectionPart(collection)];
  // A build from before the switches has no part for them.
  if (!options.older) accountParts.push(addonSwitchesPart(switches));
  const storesOf = (id: string) =>
    createProfileStores(
      profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix(id))),
      clock.now,
    );
  const engine = createSyncEngine({
    crypto,
    transport: w.service.transport,
    storage,
    clock,
    timers: w.time.timers,
    accountParts,
    profileParts: (id) => profileParts(id, storesOf(id)),
  });
  const view = switchedOnOnly(collection, switches);
  return {
    collection,
    switches,
    engine,
    view,
    idOf: (url: string) =>
      installIdOf(collection.get().addons.find((addon) => addon.transportUrl === url)!),
    async start() {
      await view.load();
      await engine.start({ id: 'main', parts: profileParts('main', storesOf('main')) });
    },
  };
}

/** The account's addons document, opened with the code. */
async function accountAddons(w: World, code: string): Promise<Items> {
  const keys = await deriveAccountKeys(crypto, code);
  const doc = w.service.documents(keys.accountId).get(await wireName(crypto, keys, 'addons'))!;
  return openDocument(crypto, keys, 'addons', doc.ver, doc.body);
}

describe('switches across screens', () => {
  it('reach every screen in the account, both ways, and go with a removed addon', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    await a.collection.install(EXTRA_URL);
    a.switches.set(a.idOf(EXTRA_URL), true);
    await settle();
    const code = await a.engine.create();
    await a.engine.confirmCreate();

    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    await settle();
    const extra = a.idOf(EXTRA_URL);
    expect(b.switches.get().off).toEqual(new Set([extra]));
    expect(urls(b.view)).toEqual([BANNERTV_DEMO_URL, CINEMETA_URL, OPENSUBTITLES_V3_URL]);
    // Still installed there, its settings with it.
    expect(urls(b.collection)).toContain(EXTRA_URL);

    // B switches it back on and Cinemeta off: A follows at its next sync.
    await w.time.advance(1000);
    b.switches.set(extra, false);
    b.switches.set(b.idOf(CINEMETA_URL), true);
    await settle();
    await b.engine.flush();
    await a.engine.syncNow();
    await settle();
    expect(a.switches.get().off).toEqual(new Set([a.idOf(CINEMETA_URL)]));
    expect(urls(a.view)).toEqual([BANNERTV_DEMO_URL, OPENSUBTITLES_V3_URL, EXTRA_URL]);
    const items = await accountAddons(w, code);
    expect(items[`off/${extra}`]).toMatchObject({ x: 1 });
    expect(items[`off/${a.idOf(CINEMETA_URL)}`]).toMatchObject({ v: 1 });

    // Removed on A, Cinemeta leaves B with its switch, and comes back on when added again.
    await w.time.advance(1000);
    const cinemeta = a.idOf(CINEMETA_URL);
    a.collection.remove(CINEMETA_URL);
    await settle();
    expect(a.switches.get().off.size).toBe(0);
    await a.engine.flush();
    await b.engine.syncNow();
    await settle();
    expect(urls(b.collection)).not.toContain(CINEMETA_URL);
    expect(b.switches.get().off.size).toBe(0);
    expect((await accountAddons(w, code))[`off/${cinemeta}`]).toMatchObject({ x: 1 });
  });

  it('a build without switches leaves them in the account as they are', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    a.switches.set(a.idOf(CINEMETA_URL), true);
    await settle();
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const cinemeta = a.idOf(CINEMETA_URL);

    // The older screen changes the addons; its push carries only what it changed.
    const old = screen(w, { older: true });
    await old.start();
    await old.engine.join(code, 'use');
    await settle();
    await w.time.advance(1000);
    old.collection.move(OPENSUBTITLES_V3_URL, -2);
    await old.engine.flush();
    const items = await accountAddons(w, code);
    expect(items[`off/${cinemeta}`]).toMatchObject({ v: 1 });
    expect(items.order).toMatchObject({
      v: [old.idOf(OPENSUBTITLES_V3_URL), expect.anything(), cinemeta],
    });

    await a.engine.syncNow();
    await settle();
    expect(a.switches.get().off).toEqual(new Set([cinemeta]));
    expect(urls(a.view)).toEqual([OPENSUBTITLES_V3_URL, BANNERTV_DEMO_URL]);
  });

  it('a screen that gains the switches brings the account’s in, rather than switching them on', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    a.switches.set(a.idOf(CINEMETA_URL), true);
    await settle();
    const code = await a.engine.create();
    await a.engine.confirmCreate();

    // An older build joins and syncs, then is updated: its storage stays, and the new
    // build's store of switches starts empty.
    const storage = memoryKeyValueStore();
    const before = screen(w, { older: true, storage });
    await before.start();
    await before.engine.join(code, 'use');
    await settle();
    const after = screen(w, { storage });
    await after.start();
    await w.time.advance(5000);
    await after.engine.syncNow();
    await settle();
    expect(after.switches.get().off).toEqual(new Set([a.idOf(CINEMETA_URL)]));
    expect((await accountAddons(w, code))[`off/${a.idOf(CINEMETA_URL)}`]).toMatchObject({ v: 1 });
  });
});
