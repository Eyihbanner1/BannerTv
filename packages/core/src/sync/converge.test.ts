import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import type { Timers } from '../timers';
import { createAccountClock } from './clock';
import { createSyncEngine } from './engine';
import { deriveAccountKeys, wireName } from './keys';
import type { PartItem } from './part';
import { createProfileStores, profileParts } from './parts';
import { openDocument } from './seal';
import {
  fakeSyncService,
  manualTimers,
  memoryPart,
  seededRandom,
  webCryptoForTests,
} from './testing';
import type { SyncTransport } from './wire';

// Two screens edit at random while the engine works: slow saves, edits made
// while a push is sealed or the account's values are being written, power
// lost mid-sync, outages, the service's limit and
// refusals, the app hidden for minutes. Once both are on and synced a few
// times, they must show the same things, and the account must hold them.
// Each screen has titles and settings of its own that only it changes, so
// its last change to each is what both must show: an edit the engine lost
// would still leave the two screens the same. The person also acts while
// the engine works: as a request goes out or is answered, or as a store or
// the engine writes.

const crypto = webCryptoForTests();
const START = Date.UTC(2026, 9, 1, 12, 0, 0) + 123;
const SEEDS = 24;
const STEPS = 50;

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

function world() {
  const time = manualTimers();
  const now = () => START + time.elapsed();
  return { time, now, service: fakeSyncService({ now }) };
}

type World = ReturnType<typeof world>;

/**
 * A TV's disk: writes land in order, each some way behind (a slow IndexedDB).
 * Once the power is gone, nothing more lands.
 */
function slowDisk(disk: Required<KeyValueStore>, rnd: () => number, dead: () => boolean) {
  let queue = Promise.resolve();
  const write = (land: () => Promise<void>) => {
    const hops = Math.floor(rnd() * 400);
    const landed = queue.then(async () => {
      for (let i = 0; i < hops; i++) await Promise.resolve();
      if (dead()) await new Promise<void>(() => undefined);
      await land();
    });
    queue = landed.catch(() => undefined);
    return landed;
  };
  const storage: KeyValueStore = {
    get: (key) => disk.get(key),
    set: (key, value) => write(() => disk.set(key, value)),
    delete: (key) => write(() => disk.delete(key)),
    deletePrefix: (prefix) => write(() => disk.deletePrefix(prefix)),
  };
  /** Resolves once every write made so far, and any made meanwhile, has landed. */
  async function drained() {
    for (let last = queue; ; last = queue) {
      await last;
      if (last === queue) return;
    }
  }
  return { storage, drained };
}

/**
 * One TV that can lose power: after that its timers, requests and writes go
 * nowhere. `busy` is told of every write and of every request going out or
 * answered, so the person can act just then, while the engine works.
 */
function device(
  w: World,
  disk: Required<KeyValueStore>,
  profilesDisk: Map<string, PartItem>,
  seed: number,
  busy: () => void,
) {
  let dead = false;
  const never = <T>() => new Promise<T>(() => undefined);
  // A key press comes between two steps of the code, never inside one.
  const nudge = () => void Promise.resolve().then(() => dead || busy());
  const slow = slowDisk(disk, seededRandom(seed), () => dead);
  const storage: KeyValueStore = {
    ...slow.storage,
    set(key, value) {
      nudge();
      return slow.storage.set(key, value);
    },
  };
  const timers: Timers = {
    after: (ms, run) => w.time.timers.after(ms, () => !dead && run()),
    every: (ms, run) => w.time.timers.every(ms, () => !dead && run()),
  };
  const answered = <T>(answer: T) => {
    nudge();
    return answer;
  };
  const transport: SyncTransport = {
    get: (path) => (dead ? never() : w.service.transport.get(path).then(answered)),
    post(path, body) {
      if (dead) return never();
      nudge();
      return w.service.transport.post(path, body).then(answered);
    },
  };
  const clock = createAccountClock({ now: w.now });
  // Profiles live in localStorage: written at once, kept across power-offs.
  const profiles = memoryPart('profiles');
  if (profilesDisk.size === 0) profilesDisk.set('main', { v: 1, t: 0 });
  profilesDisk.forEach((item, key) => profiles.set(key, item.v, item.t));
  profiles.part.subscribe(() => {
    if (dead) return;
    profilesDisk.clear();
    profiles.part.snapshot().forEach((item, key) => profilesDisk.set(key, item));
  });
  const storesOf = (id: string) =>
    createProfileStores(
      profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix(id))),
      clock.now,
    );
  const stores = storesOf('main');
  const parts = profileParts('main', stores);
  const engine = createSyncEngine({
    crypto,
    transport,
    storage,
    clock,
    timers,
    accountParts: [profiles.part, memoryPart('addons', ['a/', 'order']).part],
    profileParts: (id) => profileParts(id, storesOf(id)),
  });
  return {
    stores,
    profiles,
    engine,
    drained: slow.drained,
    kill: () => (dead = true),
    load: () => Promise.all(parts.map((part) => part.load())),
    start: () => engine.start({ id: 'main', parts }),
  };
}

type Device = ReturnType<typeof device>;

function view(s: Device) {
  return {
    list: s.stores.library
      .items()
      .map((item) => [item.id, item.addedAt])
      .sort(),
    hidden: s.stores.homeLayout.get().hidden,
    audio: s.stores.trackMemory
      .choices()
      .map((choice) => [choice.metaId, choice.audio ?? null])
      .sort(),
    offsets: s.stores.subtitleOffsets
      .offsets()
      .map((offset) => [offset.key, offset.offset])
      .sort(),
    progress: s.stores.progress
      .recent()
      .map((entry) => [entry.videoId, entry.position, entry.updatedAt])
      .sort(),
    name: s.profiles.part.snapshot().get('main/name')?.v,
  };
}

/** The titles each screen alone changes. */
const OWN = [
  ['t1', 't2', 't3'],
  ['t4', 't5', 't6'],
];

/** What only screen `i` changes, as screen `s` shows it. */
function own(s: Device, i: number) {
  const ids = OWN[i]!;
  return {
    list: ids.filter((id) => s.stores.library.get(id) !== undefined),
    audio: ids.map((id) => s.stores.trackMemory.get(id)?.audio ?? null),
    offsets: ids.map((id) => s.stores.subtitleOffsets.get(id) ?? 0),
    progress: ids.map((id) => s.stores.progress.get(id)?.position ?? null),
    setting:
      i === 0 ? s.profiles.part.snapshot().get('main/name')?.v : s.stores.homeLayout.get().hidden,
  };
}

describe('two screens editing at random', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`end up the same, with the account holding it (seed ${seed})`, async () => {
      const rnd = seededRandom(seed);
      const w = world();
      const disks = [memoryKeyValueStore(), memoryKeyValueStore()];
      const profileDisks = [new Map<string, PartItem>(), new Map<string, PartItem>()];
      const screens: Device[] = [];
      const expected: Array<ReturnType<typeof own>> = [];

      const editedAt = [-1, -1];

      /** The person changes something of screen `i`'s own there, and goes on while it saves. */
      function edit(i: number, random: () => number) {
        const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
        const s = screens[i]!;
        const r = random();
        // Changes are at least a millisecond apart, as a person's are: progress saved twice
        // in one millisecond is told apart by value alone, not by which came last.
        if (editedAt[i] === w.time.elapsed()) return;
        editedAt[i] = w.time.elapsed();
        const id = pick(OWN[i]!);
        if (r < 0.27) void s.stores.library.add(preview(id));
        else if (r < 0.45) void s.stores.library.remove(id);
        else if (r < 0.57) {
          if (i === 0) s.profiles.set('main/name', pick(['Ann', 'Bob', 'Cy']));
          else {
            const hidden = random() < 0.5 ? [pick(['r1', 'r2', 'r3'])] : [];
            void s.stores.homeLayout.update((current) => ({ order: current.order, hidden }));
          }
        } else if (r < 0.69) void s.stores.trackMemory.rememberAudio(id, pick(['en', 'fr']));
        else if (r < 0.81) void s.stores.subtitleOffsets.remember(id, pick([0, 1.5, -2]));
        else {
          const position = Math.floor(random() * 6000);
          s.stores.progress.record({
            metaId: id,
            type: 'movie',
            videoId: id,
            position,
            duration: 6000,
          });
        }
        // What the store holds once the change is made is what the person chose.
        void (async () => {
          for (let hop = 0; hop < 5; hop++) await Promise.resolve();
          expected[i] = own(screens[i]!, i);
        })();
      }

      let acting = false;
      const busy = [rnd() * 1e9, rnd() * 1e9].map((n, i) => {
        const chance = seededRandom(Math.floor(n));
        return () => {
          if (acting && chance() < 0.03) edit(i, chance);
        };
      });
      let boots = 0;
      const boot = (i: number) =>
        device(w, disks[i]!, profileDisks[i]!, seed * 1000 + boots++, busy[i]!);
      screens.push(boot(0), boot(1));
      for (const s of screens) {
        await s.load();
        await s.start();
      }
      expected.push(own(screens[0]!, 0), own(screens[1]!, 1));
      const code = await screens[0]!.engine.create();
      await screens[0]!.engine.confirmCreate();
      await screens[1]!.engine.join(code, 'use');

      acting = true;
      for (let step = 0; step < STEPS; step++) {
        const i = rnd() < 0.5 ? 0 : 1;
        const s = screens[i]!;
        const r = rnd();
        if (r < 0.59) edit(i, rnd);
        else if (r < 0.63) w.service.failNext({ network: true }, { network: true });
        else if (r < 0.66) {
          w.service.failNext({
            path: '/v1/push',
            status: 429,
            body: { error: 'limit', retryAfter: 60 },
          });
        } else if (r < 0.68)
          w.service.failNext({ path: '/v1/push', status: 413, body: { error: 'too-big' } });
        else if (r < 0.72) {
          s.engine.hide();
          await w.time.advance(Math.floor(rnd() * 200000));
          s.engine.show();
        } else if (r < 0.8) {
          // Whatever is in flight gets only partway. The disk is let finish what it
          // was given: a store's change and the edit it makes are separate writes.
          await w.time.settle();
          await s.drained();
          s.kill();
          const again = boot(i);
          screens[i] = again;
          await again.load();
          expected[i] = own(again, i);
          await again.start();
        } else if (r < 0.9) await s.engine.syncNow();
        else await s.engine.flush();
        await w.time.advance(Math.floor(rnd() * 8000));
      }
      acting = false;

      // Everything settles: both screens on and online, synced a few times.
      w.service.heal();
      for (let round = 0; round < 4; round++) {
        await screens[0]!.engine.syncNow();
        await screens[1]!.engine.syncNow();
        await w.time.advance(40 * 60 * 1000);
      }
      await screens[0]!.engine.syncNow();
      const a = view(screens[0]!);
      expect({ seed, view: view(screens[1]!) }).toEqual({ seed, view: a });
      for (const i of [0, 1]) {
        expect({ seed, screen: i, own: own(screens[i]!, i) }).toEqual({
          seed,
          screen: i,
          own: expected[i],
        });
      }
      const keys = await deriveAccountKeys(crypto, code);
      const doc = w.service
        .documents(keys.accountId)
        .get(await wireName(crypto, keys, 'p/main/list'));
      const list = doc ? await openDocument(crypto, keys, 'p/main/list', doc.ver, doc.body) : {};
      const live = Object.keys(list).filter((key) => !('x' in list[key]!));
      expect(a.list.map(([id]) => id)).toEqual(live.sort());
      expect(screens[0]!.engine.status().state).toBe('idle');
      expect(screens[1]!.engine.status().state).toBe('idle');
    });
  }
});
