import type { InstalledAddon, Store } from '@bannertv/core';
import { type ManifestCatalog, parseManifest, parseMetaPreview } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What the app keeps, in memory.
const saved = vi.hoisted(() => new Map<string, unknown>());

vi.mock('./storage', () => ({
  storage: {
    kv: {
      get: (key: string) => Promise.resolve(saved.get(key)),
      set: (key: string, value: unknown) => {
        saved.set(key, value);
        return Promise.resolve();
      },
    },
  },
}));

vi.mock('./addons', async () => {
  const { createStore } = await import('@bannertv/core');
  return {
    addonCollection: createStore({ ready: false, addons: [] }),
    addonClient: {},
  };
});

type Collection = Store<{ ready: boolean; addons: readonly InstalledAddon[] }>;

const FOOTBALL = { type: 'tv', id: 'football', name: 'Football' };
// Named after a view only: a sports catalog once its first page looked like matches.
const LIVE = { type: 'tv', id: 'now', name: 'Live' };
const SEARCH = {
  type: 'tv',
  id: 'search',
  name: 'Search',
  extra: [{ name: 'search', isRequired: true }],
};

function install(id: string, transportUrl: string, catalogs: object[]): InstalledAddon {
  return {
    transportUrl,
    manifest: parseManifest({
      id,
      version: '1.0.0',
      name: 'Test Sports',
      resources: ['catalog', 'meta', 'stream'],
      types: ['tv'],
      catalogs,
    }),
    official: false,
    fetchedAt: 0,
  };
}

const catalogOf = (addon: InstalledAddon, id: string): ManifestCatalog =>
  addon.manifest.catalogs.find((catalog) => catalog.id === id)!;

const matches = ['Arsenal vs Chelsea', 'Celtic vs Rangers', 'Ajax vs PSV'].map((name, i) =>
  parseMetaPreview({ id: `x:${i}`, type: 'tv', name })!,
);

/** A fresh copy of the module, following a collection that is ready with `addons`. */
async function start(addons: InstalledAddon[]) {
  vi.resetModules();
  const sports = await import('./sports');
  const collection = (await import('./addons')).addonCollection as unknown as Collection;
  await sports.startSports();
  collection.set({ ready: true, addons });
  return { sports, collection };
}

beforeEach(() => {
  saved.clear();
  vi.stubGlobal('window', globalThis);
  // The team and league data never arrives: grouping goes by what addons say.
  vi.stubGlobal('document', {
    createElement: () => ({ remove: () => undefined }),
    head: { appendChild: () => undefined },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('an addon set up again with other settings', () => {
  // The new manifest id differs only by its settings hash, which the collection accepts.
  const before = install('org.x.sports.ab12cd34ef56', 'https://x.example.com/ab12/manifest.json', [
    FOOTBALL,
    LIVE,
  ]);
  const after = install('org.x.sports.99887766aabb', 'https://x.example.com/9988/manifest.json', [
    FOOTBALL,
    LIVE,
  ]);

  it('keeps its Show in Sports', async () => {
    const { sports, collection } = await start([before]);
    sports.setSportsSetting(before, 'no');
    expect(sports.sportsState.get().shown).toBe(false);

    collection.set({ ready: true, addons: [after] });
    expect(sports.sportsSetting(after)).toBe('no');
    expect(sports.sportsState.get().shown).toBe(false);
    expect(saved.get('sports.settings')).toEqual({ 'org.x.sports.99887766aabb': 'no' });
  });

  it('keeps what its first pages looked like', async () => {
    const { sports, collection } = await start([before]);
    sports.noteFirstPage(before, catalogOf(before, 'now'), matches);
    expect(sports.sportsState.get().catalogs.map((entry) => entry.catalog.id)).toEqual([
      'football',
      'now',
    ]);

    collection.set({ ready: true, addons: [after] });
    const catalogs = sports.sportsState.get().catalogs;
    expect(catalogs.map((entry) => [entry.addon, entry.catalog.id])).toEqual([
      [after, 'football'],
      [after, 'now'],
    ]);
    expect(JSON.stringify(saved.get('sports.evidence'))).not.toContain('ab12cd34ef56');
  });

  it('keeps the kick-offs it saw, under its new id', async () => {
    const { sports, collection } = await start([before]);
    const at = Date.parse('2026-10-28T20:00:00Z');
    sports.kickoffs.note(before.manifest.id, 'x:0', { at, sure: true, source: 'released' });
    await sports.kickoffs.flush();

    collection.set({ ready: true, addons: [after] });
    expect(sports.kickoffs.get(after.manifest.id, 'x:0')?.at).toBe(at);
    expect(sports.kickoffs.get(before.manifest.id, 'x:0')).toBeUndefined();
    await sports.kickoffs.flush();
    const rows = JSON.stringify(saved.get('sports.kickoffs'));
    expect(rows).toContain(after.manifest.id);
    expect(rows).not.toContain('ab12cd34ef56');
  });

  it('forgets everything about an addon removed', async () => {
    const { sports, collection } = await start([before]);
    sports.setSportsSetting(before, 'yes');
    sports.noteFirstPage(before, catalogOf(before, 'now'), matches);
    sports.kickoffs.note(before.manifest.id, 'x:0', {
      at: Date.parse('2026-10-28T20:00:00Z'),
      sure: true,
      source: 'released',
    });
    await sports.kickoffs.flush();
    expect(JSON.stringify(saved.get('sports.kickoffs'))).toContain(before.manifest.id);

    collection.set({ ready: true, addons: [] });
    await sports.kickoffs.flush();
    expect(saved.get('sports.settings')).toEqual({});
    expect(saved.get('sports.evidence')).toEqual([]);
    expect(saved.get('sports.kickoffs')).toEqual([]);
  });
});

describe('events read from a search of a sports addon', () => {
  it('reads clock times in the zone the install address names', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
    const addon = install(
      'org.x.sports',
      'https://x.example.com/manifest.json?timezone=America%2FArgentina%2FBuenos_Aires',
      [FOOTBALL, SEARCH],
    );
    const { sports } = await start([addon]);
    const item = parseMetaPreview({
      id: 'x:9',
      type: 'tv',
      name: 'Arsenal vs Chelsea',
      releaseInfo: '20:00',
    })!;

    const [event] = sports.eventsFromItems(addon, catalogOf(addon, 'search'), [item]);
    // 20:00 in Buenos Aires (UTC-3), as the Sports screen reads the same item.
    expect(event?.kickOff?.at).toBe(Date.parse('2026-10-28T23:00:00Z'));
    expect(sports.eventsFromItems(addon, catalogOf(addon, 'football'), [item])[0]?.kickOff).toEqual(
      event?.kickOff,
    );
  });

  it('reads clock times past midnight on the next day, as the Sports screen does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
    const addon = install(
      'org.x.sports',
      'https://x.example.com/manifest.json?timezone=Europe%2FLondon',
      [FOOTBALL, SEARCH],
    );
    const { sports } = await start([addon]);
    const items = [
      ['Arsenal vs Chelsea', '22:00'],
      ['Celtic vs Rangers', '23:45'],
      ['Ajax vs PSV', '00:30'],
    ].map(([name, releaseInfo], i) =>
      parseMetaPreview({ id: `x:${i}`, type: 'tv', name, releaseInfo })!,
    );

    const events = sports.eventsFromItems(addon, catalogOf(addon, 'search'), items);
    const kickOff = (id: string) =>
      events.find((event) => event.sources.some((source) => source.id === id))?.kickOff?.at;
    expect([kickOff('x:0'), kickOff('x:1'), kickOff('x:2')]).toEqual([
      Date.parse('2026-10-28T22:00:00Z'),
      Date.parse('2026-10-28T23:45:00Z'),
      Date.parse('2026-10-29T00:30:00Z'),
    ]);
  });
});

describe('a match opened from its catalog in Discover', () => {
  it('reads the time with the list it is in, so 00:30 after 23:45 is tomorrow', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-28T23:30:00Z'));
    const addon = install(
      'org.x.sports',
      'https://x.example.com/manifest.json?timezone=Europe%2FLondon',
      [FOOTBALL, SEARCH],
    );
    const { sports } = await start([addon]);
    const items = [
      ['Arsenal vs Chelsea', '22:00'],
      ['Celtic vs Rangers', '23:45'],
      ['Ajax vs PSV', '00:30'],
    ].map(([name, releaseInfo], i) =>
      parseMetaPreview({ id: `x:${i}`, type: 'tv', name, releaseInfo })!,
    );
    const football = catalogOf(addon, 'football');

    // Pressed before the list is read, the tile goes alone: this morning's.
    const early = sports.eventForItem(addon, football, items, items[2]!);
    expect(early?.kickOff?.at).toBe(Date.parse('2026-10-28T00:30:00Z'));
    sports.prepareItems(addon, football, items);
    vi.runAllTimers();
    const event = sports.eventForItem(addon, football, items, items[2]!);
    expect(event?.sources.map((source) => source.id)).toEqual(['x:2']);
    expect(event?.kickOff?.at).toBe(Date.parse('2026-10-29T00:30:00Z'));
  });

  it('reads a tile on the day remembered for it, list or not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T23:30:00Z'));
    const addon = install(
      'org.x.sports',
      'https://x.example.com/manifest.json?timezone=Europe%2FLondon',
      [FOOTBALL, SEARCH],
    );
    const { sports } = await start([addon]);
    const item = parseMetaPreview({
      id: 'x:2',
      type: 'tv',
      name: 'Ajax vs PSV',
      releaseInfo: '00:30',
    })!;
    // The Sports screen saw it tomorrow at 00:30.
    sports.kickoffs.note('org.x.sports', 'x:2', {
      at: Date.parse('2026-10-29T00:30:00Z'),
      sure: true,
      source: 'clock',
    });
    const event = sports.eventForItem(addon, catalogOf(addon, 'football'), [item], item);
    expect(event?.kickOff?.at).toBe(Date.parse('2026-10-29T00:30:00Z'));
  });

  it('opens the tile pressed, not an earlier one it would merge with', async () => {
    const addon = install(
      'org.x.sports',
      'https://x.example.com/manifest.json?timezone=Europe%2FLondon',
      [FOOTBALL, SEARCH],
    );
    const { sports } = await start([addon]);
    // The home and away games of a season, neither dated.
    const items = ['Arsenal vs Chelsea', 'Liverpool vs Everton', 'Chelsea vs Arsenal'].map(
      (name, i) => parseMetaPreview({ id: `r:${i}`, type: 'tv', name })!,
    );
    const event = sports.eventForItem(addon, catalogOf(addon, 'football'), items, items[2]!);
    expect(event?.sources.map((source) => source.id)).toEqual(['r:2']);
    expect(event?.home).toBe('Chelsea');
  });
});
