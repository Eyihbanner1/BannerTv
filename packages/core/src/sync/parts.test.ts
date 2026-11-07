import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createAddonCollection, installIdOf, type StoredAddon } from '../addons/collection';
import { BANNERTV_DEMO_URL, CINEMETA_URL, DEFAULT_ADDONS } from '../addons/defaults';
import { createHomeLayout } from '../addons/layout';
import { createLibrary } from '../library/library';
import { createPlayedVideos } from '../playback/continue';
import { createSubtitleOffsets } from '../playback/offsets';
import { createProgressStore } from '../playback/progress';
import { createTrackMemory } from '../playback/tracks';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import type { LiveItem } from './items';
import type { PartChange } from './part';
import {
  CARD_DESCRIPTION_LENGTH,
  collectionPart,
  createProfileStores,
  homeLayoutPart,
  libraryPart,
  mergeRowOrder,
  profileParts,
  subtitleOffsetsPart,
  trackMemoryPart,
  watchPart,
} from './parts';

function preview(id: string, extra: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id,
    type: 'movie',
    name: `Title ${id}`,
    posterShape: 'poster',
    genres: [],
    trailers: [],
    ...extra,
  };
}

function change(set: { [key: string]: LiveItem } = {}, remove: string[] = []): PartChange {
  const items = new Map<string, LiveItem>();
  for (const key of Object.keys(set)) items.set(key, set[key]!);
  return { set: items, remove };
}

describe('libraryPart', () => {
  it('lists My List by title at the time each was added, Trakt marks included', async () => {
    let time = 1500;
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => time });
    const part = libraryPart('main', library);
    expect(part.document).toBe('p/main/list');
    await part.load();
    await library.add(preview('tt1', { poster: 'https://img/p.jpg', description: 'not kept' }));
    time = 2700;
    await library.add(preview('tt2', { type: 'series' }));
    await part.markTrakt!(['tt2']);
    const snapshot = part.snapshot();
    expect(snapshot.get('tt1')).toEqual({
      v: { type: 'movie', name: 'Title tt1', poster: 'https://img/p.jpg' },
      t: 1500,
    });
    expect(snapshot.get('tt2')).toEqual({
      v: { type: 'series', name: 'Title tt2' },
      t: 2700,
      trakt: true,
    });
    // The same item for an unchanged title, so snapshots stay cheap.
    expect(part.snapshot().get('tt1')).toBe(snapshot.get('tt1'));
  });

  it('compares only the type, so new artwork is not an edit', () => {
    const part = libraryPart('main', createLibrary({ storage: memoryKeyValueStore() }));
    const one = part.compare!('tt1', { type: 'movie', name: 'A', poster: 'x' });
    const two = part.compare!('tt1', { type: 'movie', name: 'B' });
    expect(one).toEqual(two);
    expect(part.compare!('tt1', { type: 'series', name: 'A' })).not.toEqual(one);
  });

  it("writes the account's titles with their times and takes removed ones out", async () => {
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => 1000 });
    const part = libraryPart('kid1', library);
    await part.load();
    await library.add(preview('gone'));
    await part.adopt(
      change(
        {
          tt9: { t: 5000, v: { type: 'movie', name: 'Nine', genres: ['Drama'] } },
          bad: { t: 6000, v: 'not a tile' },
        },
        ['gone'],
      ),
    );
    expect(library.items()).toEqual([
      { id: 'tt9', type: 'movie', name: 'Nine', genres: ['Drama'], addedAt: 5000 },
    ]);
  });

  it("sets titles aside without taking them off Trakt's list when joining with Use", async () => {
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => 1000 });
    const part = libraryPart('main', library);
    await part.load();
    await library.mergeRemote([{ id: 'tt1', type: 'movie', name: 'One', addedAt: 1000 }]);
    await library.add(preview('tt1'));
    await part.adopt({ ...change({}, ['tt1']), reset: true });
    expect(library.items()).toEqual([]);
    expect(library.outbox()).toEqual([]);
  });

  it("has the person's own data only for titles neither Trakt's nor at a whole second", async () => {
    let time = 2000;
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => time });
    const part = libraryPart('main', library);
    await part.load();
    await library.add(preview('tt1'));
    expect(part.ownData!()).toBe(false);
    time = 2001;
    await library.add(preview('tt2'));
    expect(part.ownData!()).toBe(true);
    await part.markTrakt!(['tt2']);
    expect(part.ownData!()).toBe(false);
  });
});

describe('watchPart', () => {
  function stores(start = 1001) {
    let time = start;
    const storage = memoryKeyValueStore();
    const progress = createProgressStore({ storage, now: () => time });
    const played = createPlayedVideos({ storage, now: () => time });
    return { progress, played, setTime: (ms: number) => (time = ms) };
  }

  it('lists progress with the card that played, and never a filled-in card', async () => {
    const { progress, played } = stores();
    const part = watchPart('main', progress, played);
    expect(part.document).toBe('p/main/watch');
    await part.load();
    progress.record({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 600,
      duration: 6000,
    });
    played.record({
      videoId: 'tt1',
      metaId: 'tt1',
      type: 'movie',
      name: 'One',
      description: 'word '.repeat(100),
    });
    progress.record({
      metaId: 'tt2',
      type: 'series',
      videoId: 'tt2:1:1',
      position: 60,
      duration: 3000,
      continueRow: false,
    });
    played.record(
      { videoId: 'tt2:1:1', metaId: 'tt2', type: 'series', name: 'Two' },
      { filled: true },
    );
    const snapshot = part.snapshot();
    const one = snapshot.get('tt1')!;
    expect(one.t).toBe(1001);
    const value = one.v as { card: { name: string; description: string } };
    expect(value).toMatchObject({
      metaId: 'tt1',
      type: 'movie',
      position: 600,
      duration: 6000,
      watched: false,
      card: { name: 'One' },
    });
    expect(value.card.description.length).toBeLessThanOrEqual(CARD_DESCRIPTION_LENGTH);
    expect(value.card.description).toMatch(/^word word .*word…$/);
    expect(snapshot.get('tt2:1:1')!.v).toEqual({
      metaId: 'tt2',
      type: 'series',
      position: 60,
      duration: 3000,
      watched: false,
      continueRow: false,
    });
  });

  it('compares the progress and whether there is a card, not what the card says', () => {
    const { progress, played } = stores();
    const part = watchPart('main', progress, played);
    const base = { metaId: 'tt1', type: 'movie', position: 1, duration: 2, watched: false };
    expect(part.compare!('tt1', { ...base, card: { name: 'A' } })).toEqual(
      part.compare!('tt1', { ...base, card: { name: 'B', poster: 'p' } }),
    );
    expect(part.compare!('tt1', { ...base, card: { name: 'A' } })).not.toEqual(
      part.compare!('tt1', base),
    );
    expect(part.compare!('tt1', base)).not.toEqual(part.compare!('tt1', { ...base, position: 5 }));
  });

  it("writes the account's progress and cards at the item's time", async () => {
    const { progress, played } = stores();
    const part = watchPart('main', progress, played);
    await part.load();
    await part.adopt(
      change({
        'tt3:1:2': {
          t: 7000,
          v: {
            metaId: 'tt3',
            type: 'series',
            position: 120,
            duration: 2400,
            watched: true,
            card: { name: 'Three', season: 1, episode: 2, videoId: 'ignored' },
          },
        },
        tt4: { t: 6000, v: { metaId: 'tt4', type: 'movie', position: 10, duration: 100 } },
      }),
    );
    expect(progress.get('tt3:1:2')).toEqual({
      metaId: 'tt3',
      type: 'series',
      videoId: 'tt3:1:2',
      position: 120,
      duration: 2400,
      updatedAt: 7000,
      watched: true,
    });
    expect(played.get('tt3:1:2')).toEqual({
      videoId: 'tt3:1:2',
      metaId: 'tt3',
      type: 'series',
      name: 'Three',
      season: 1,
      episode: 2,
      updatedAt: 7000,
    });
    expect(progress.recent().map((entry) => entry.videoId)).toEqual(['tt3:1:2', 'tt4']);
    expect(played.get('tt4')).toBeUndefined();
  });

  it('takes a card away with its progress', async () => {
    const { progress, played } = stores();
    const part = watchPart('main', progress, played);
    await part.load();
    progress.record({ metaId: 'tt1', type: 'movie', videoId: 'tt1', position: 60, duration: 600 });
    played.record({ videoId: 'tt1', metaId: 'tt1', type: 'movie', name: 'One' });
    await part.adopt({ ...change({}, ['tt1']), reset: true });
    expect(progress.get('tt1')).toBeUndefined();
    expect(played.get('tt1')).toBeUndefined();
  });

  it('sends when a video was last marked not watched, compares it, and hands it on', async () => {
    const { progress, played } = stores();
    const unwatched = {
      metaId: 'tt5',
      type: 'movie' as const,
      videoId: 'tt5',
      position: 0,
      duration: 6000,
      updatedAt: 4000,
      watched: false,
      unmarkedAt: 4000,
    };
    // The progress store keeps the field once the Mark as unwatched work lands; here it is shown one.
    const shown = { ...progress, recent: () => [unwatched], get: () => unwatched };
    const part = watchPart('main', shown, played);
    expect(part.snapshot().get('tt5')!.v).toEqual({
      metaId: 'tt5',
      type: 'movie',
      position: 0,
      duration: 6000,
      watched: false,
      unmarkedAt: 4000,
    });
    const base = { metaId: 'tt5', type: 'movie', position: 0, duration: 6000, watched: false };
    expect(part.compare!('tt5', { ...base, unmarkedAt: 4000 })).not.toEqual(
      part.compare!('tt5', base),
    );

    const adopt = vi.spyOn(progress, 'adopt');
    const plain = watchPart('main', progress, played);
    await plain.load();
    await plain.adopt(
      change({
        tt5: { t: 4000, v: { ...base, unmarkedAt: 4000 } },
        tt6: { t: 4100, v: { ...base, metaId: 'tt6', unmarkedAt: 'soon' } },
      }),
    );
    const handed = adopt.mock.calls[0]![0].set!;
    expect(handed.find((entry) => entry.videoId === 'tt5')!.unmarkedAt).toBe(4000);
    expect('unmarkedAt' in handed.find((entry) => entry.videoId === 'tt6')!).toBe(false);
  });

  it("marks Trakt's progress and leaves it out of the person's own data", async () => {
    const { progress, played, setTime } = stores(3000);
    const part = watchPart('main', progress, played);
    await part.load();
    progress.record({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 600,
      duration: 6000,
    });
    expect(part.ownData!()).toBe(false);
    setTime(3333);
    progress.record({
      metaId: 'tt2',
      type: 'movie',
      videoId: 'tt2',
      position: 600,
      duration: 6000,
    });
    expect(part.ownData!()).toBe(true);
    await part.markTrakt!(['tt2']);
    expect(part.ownData!()).toBe(false);
    expect(part.snapshot().get('tt2')!.trakt).toBe(true);
  });
});

describe('mergeRowOrder', () => {
  it("takes the account's order and keeps rows only this screen has after their neighbour", () => {
    expect(mergeRowOrder(['a', 'b', 'c'], ['b', 'x', 'a', 'y'])).toEqual(['a', 'y', 'b', 'x', 'c']);
    expect(mergeRowOrder(['a', 'b'], ['x', 'a'])).toEqual(['x', 'a', 'b']);
    expect(mergeRowOrder([], ['x', 'y'])).toEqual(['x', 'y']);
    expect(mergeRowOrder(['a', 'a', '', 3 as unknown as string], [])).toEqual(['a']);
  });
});

describe('homeLayoutPart', () => {
  it('lists the order and hidden rows, and adopts them without losing rows only here', async () => {
    const layout = createHomeLayout({ storage: memoryKeyValueStore() });
    const part = homeLayoutPart('main', layout);
    expect(part.document).toBe('p/main/settings');
    expect(part.prefixes).toEqual(['home/order', 'home/hidden']);
    await part.load();
    expect(part.snapshot().size).toBe(0);
    await layout.update(() => ({ order: ['local', 'a'], hidden: ['h1'] }));
    expect(part.snapshot()).toEqual(
      new Map([
        ['home/order', { v: ['local', 'a'] }],
        ['home/hidden', { v: ['h1'] }],
      ]),
    );
    await part.adopt(
      change({ 'home/order': { t: 5, v: ['b', 'a'] }, 'home/hidden': { t: 5, v: ['h2'] } }),
    );
    expect(layout.get()).toEqual({ order: ['local', 'b', 'a'], hidden: ['h2'] });
    await part.adopt(change({}, ['home/hidden']));
    expect(layout.get().hidden).toEqual([]);
  });

  it('leaves the layout as it is when the account changes nothing', async () => {
    const layout = createHomeLayout({ storage: memoryKeyValueStore() });
    const part = homeLayoutPart('main', layout);
    await part.load();
    await layout.update(() => ({ order: ['a'], hidden: [] }));
    const before = layout.get();
    const listener = vi.fn();
    part.subscribe(listener);
    await part.adopt(change({ 'home/order': { t: 5, v: ['a'] } }));
    expect(layout.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('trackMemoryPart and subtitleOffsetsPart', () => {
  it('carry track choices per title, subtitles off included', async () => {
    const memory = createTrackMemory({ storage: memoryKeyValueStore() });
    const part = trackMemoryPart('main', memory);
    expect(part.prefixes).toEqual(['track/']);
    await part.load();
    await memory.rememberAudio('tt1', 'fr');
    await memory.rememberSubtitle('tt2', null);
    expect(part.snapshot()).toEqual(
      new Map([
        ['track/tt1', { v: { a: 'fr' } }],
        ['track/tt2', { v: { s: null } }],
      ]),
    );
    await part.adopt(change({ 'track/tt3': { t: 1, v: { a: 'de', s: 'en' } } }, ['track/tt1']));
    expect(memory.get('tt1')).toBeUndefined();
    expect(memory.get('tt3')).toEqual({ metaId: 'tt3', audio: 'de', subtitle: 'en' });
  });

  it('carry subtitle timings, where a timing put back to 0 is gone', async () => {
    const offsets = createSubtitleOffsets({ storage: memoryKeyValueStore() });
    const part = subtitleOffsetsPart('main', offsets);
    expect(part.prefixes).toEqual(['offset/']);
    await part.load();
    await offsets.remember('k1', 1.5);
    expect(part.snapshot()).toEqual(new Map([['offset/k1', { v: 1.5 }]]));
    await offsets.remember('k1', 0);
    expect(part.snapshot().size).toBe(0);
    await part.adopt(change({ 'offset/k2': { t: 1, v: -2 }, 'offset/k3': { t: 1, v: 'x' } }));
    expect(offsets.offsets()).toEqual([{ key: 'k2', offset: -2 }]);
  });
});

describe('collectionPart', () => {
  const EXTRA_URL = 'https://addon.example.com/manifest.json';
  const EXTRA_MANIFEST = {
    id: 'org.example',
    version: '1.0.0',
    name: 'Example',
    types: ['movie'],
    resources: ['stream'],
  };

  function setup() {
    const fetchJson = vi.fn<(url: string) => Promise<unknown>>(() =>
      Promise.resolve(EXTRA_MANIFEST),
    );
    const collection = createAddonCollection({
      storage: memoryKeyValueStore(),
      fetchJson,
      defaults: DEFAULT_ADDONS,
      now: () => 1000,
    });
    return { collection, fetchJson, part: collectionPart(collection) };
  }

  it('waits for the app to load the collection rather than loading it again', async () => {
    const { collection, part } = setup();
    let loaded = false;
    void part.load().then(() => (loaded = true));
    await Promise.resolve();
    expect(loaded).toBe(false);
    await collection.load();
    await Promise.resolve();
    expect(loaded).toBe(true);
  });

  it('lists each install by its name and the order, comparing only address and official', async () => {
    const { collection, part } = setup();
    await collection.load();
    const snapshot = part.snapshot();
    const ids = collection.get().addons.map((addon) => installIdOf(addon));
    expect(snapshot.get('order')).toEqual({ v: ids });
    const first = snapshot.get(`a/${ids[0]}`)!;
    expect(first.v).toMatchObject({ u: BANNERTV_DEMO_URL, o: true });
    expect(part.compare!(`a/${ids[0]}`, first.v)).toEqual({ u: BANNERTV_DEMO_URL, o: true });
    expect(part.snapshot().get(`a/${ids[0]}`)).toBe(first);
    expect(part.ownData!()).toBe(false);
    expect(part.removedDefaults!()).toEqual([]);
  });

  it("adopts the account's addons and order without asking any addon", async () => {
    const { collection, fetchJson, part } = setup();
    await collection.load();
    const [demo, cinemeta] = collection.toStored();
    await part.adopt(
      change(
        {
          'a/extra1': { t: 5, v: { u: EXTRA_URL, o: false, m: EXTRA_MANIFEST } },
          order: { t: 5, v: ['extra1', cinemeta!.installId!] },
        },
        [`a/${demo!.installId}`],
      ),
    );
    expect(fetchJson).not.toHaveBeenCalled();
    expect(collection.get().addons.map((addon) => addon.transportUrl)).toEqual([
      EXTRA_URL,
      CINEMETA_URL,
      DEFAULT_ADDONS[2]!.transportUrl,
    ]);
    expect(part.ownData!()).toBe(true);
    expect(part.removedDefaults!()).toEqual([`a/${demo!.installId}`]);
  });

  it('sees no change from a daily refresh that finds the same manifests, which still saves the time', async () => {
    // As from the network: equal JSON, never the same objects.
    const fetchJson = vi.fn((url: string) => {
      const addon = DEFAULT_ADDONS.find((a) => a.transportUrl === url)!;
      return Promise.resolve(JSON.parse(JSON.stringify(addon.manifest)) as unknown);
    });
    const storage = memoryKeyValueStore();
    let time = 1000;
    const collection = createAddonCollection({
      storage,
      fetchJson,
      defaults: DEFAULT_ADDONS,
      now: () => time,
    });
    const part = collectionPart(collection);
    await collection.load();
    const before = part.snapshot();
    const listener = vi.fn();
    part.subscribe(listener);
    time = 5000;
    await collection.refreshManifests(1000);

    expect(fetchJson).toHaveBeenCalledTimes(DEFAULT_ADDONS.length);
    expect(listener).not.toHaveBeenCalled();
    const after = part.snapshot();
    before.forEach((item, key) => {
      if (key !== 'order') expect(after.get(key)).toBe(item);
    });
    expect(after.get('order')).toEqual(before.get('order'));
    expect(collection.toStored().map((item) => item.fetchedAt)).toEqual(
      DEFAULT_ADDONS.map(() => 5000),
    );
    const saved = (await storage.get('addons')) as StoredAddon[];
    expect(saved.map((item) => item.fetchedAt)).toEqual(DEFAULT_ADDONS.map(() => 5000));
  });

  it('counts defaults by address, whatever the given list', async () => {
    const { collection } = setup();
    await collection.load();
    const defaults: StoredAddon[] = [DEFAULT_ADDONS[1]!];
    const part = collectionPart(collection, { defaults });
    expect(part.ownData!()).toBe(true);
    expect(part.removedDefaults!()).toEqual([]);
  });
});

describe('profileParts', () => {
  it("builds a profile's parts over its own keys", async () => {
    const kv = memoryKeyValueStore();
    const storage = profileKeyValueStore(kv, Promise.resolve(profileKeyPrefix('abc123')));
    const stores = createProfileStores(storage);
    const parts = profileParts('abc123', stores);
    expect(parts.map((part) => part.document)).toEqual([
      'p/abc123/list',
      'p/abc123/watch',
      'p/abc123/settings',
      'p/abc123/settings',
      'p/abc123/settings',
    ]);
    await Promise.all(parts.map((part) => part.load()));
    await parts[0]!.adopt(change({ tt1: { t: 9, v: { type: 'movie', name: 'One' } } }));
    const again = createProfileStores(storage);
    await again.library.load();
    expect(again.library.get('tt1')?.addedAt).toBe(9);
    // Main's keys are untouched.
    expect(await kv.get('library')).toBeUndefined();
  });
});

describe('every part', () => {
  /** A store whose saves wait until `release`, as a slow IndexedDB's. */
  function slowStorage() {
    const storage = memoryKeyValueStore();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow: KeyValueStore = {
      ...storage,
      set: (key, value) => held.then(() => storage.set(key, value)),
    };
    return { storage: slow, release };
  }

  it('makes its whole change, trimming included, before adopt() returns', async () => {
    const { storage, release } = slowStorage();
    const stores = createProfileStores(storage);
    const parts = profileParts('main', stores);
    await Promise.all(parts.map((part) => part.load()));
    const [library, watch, layout, tracks, offsets] = parts;

    // My List keeps its newest thousand: the oldest added here is cut at once.
    const titles: { [id: string]: LiveItem } = {};
    for (let i = 0; i <= 1000; i++) {
      titles[`tt${i}`] = { t: 5000 + i, v: { type: 'movie', name: `Title ${i}` } };
    }
    const saving = [library!.adopt(change(titles))];
    const kept = library!.snapshot();
    expect(kept.size).toBe(1000);
    expect(kept.has('tt0')).toBe(false);

    saving.push(
      watch!.adopt(
        change({
          tt1: {
            t: 7000,
            v: { metaId: 'tt1', type: 'movie', position: 5, duration: 9, card: { name: 'One' } },
          },
        }),
      ),
    );
    expect(watch!.snapshot().get('tt1')).toMatchObject({ t: 7000, v: { card: { name: 'One' } } });
    saving.push(layout!.adopt(change({ 'home/hidden': { t: 1, v: ['h'] } })));
    expect(layout!.snapshot().get('home/hidden')).toEqual({ v: ['h'] });
    saving.push(tracks!.adopt(change({ 'track/tt1': { t: 1, v: { a: 'fr' } } })));
    expect(tracks!.snapshot().get('track/tt1')).toEqual({ v: { a: 'fr' } });
    saving.push(offsets!.adopt(change({ 'offset/k': { t: 1, v: 2 } })));
    expect(offsets!.snapshot().get('offset/k')).toEqual({ v: 2 });

    // Only the saves were waited for.
    let saved = false;
    void Promise.all(saving).then(() => (saved = true));
    await Promise.resolve();
    expect(saved).toBe(false);
    release();
    await Promise.all(saving);
  });

  it('and the collection too', async () => {
    const collection = createAddonCollection({
      storage: memoryKeyValueStore(),
      fetchJson: () => Promise.reject(new Error('unused')),
      defaults: DEFAULT_ADDONS,
    });
    await collection.load();
    const part = collectionPart(collection);
    const [demo] = collection.toStored();
    const adopted = part.adopt(change({}, [`a/${demo!.installId}`]));
    expect(part.snapshot().has(`a/${demo!.installId}`)).toBe(false);
    await adopted;
  });
});
