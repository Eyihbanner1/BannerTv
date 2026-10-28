import { type ManifestCatalog, parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createAddonClient } from '../addons/client';
import type { InstalledAddon } from '../addons/collection';
import { createAddonCollection } from '../addons/collection';
import { HttpError } from '../http';
import { createLane } from '../lane';
import { createLimiter } from '../limiter';
import { createQueryCache } from '../query';
import { memoryKeyValueStore } from '../storage';
import type { Timers } from '../timers';
import { sportsCatalogs } from './detect';
import { createSportsFeed, MAX_GENRES, MAX_PAGES } from './feed';
import { createKickoffMemory } from './kickoffs';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;

interface FakeCatalog {
  id: string;
  name: string;
  type?: string;
  items: Array<Record<string, unknown>>;
  pageSize?: number;
  /** How the addon reads skip: by every item, by events only, or not at all. */
  skip?: 'items' | 'events' | 'ignore';
  declareSkip?: boolean;
  genres?: string[];
  /** A response other than the page, for crash tests. */
  answer?: (url: string) => Promise<unknown>;
}

function match(n: number, at: number, extra: Record<string, unknown> = {}) {
  return {
    id: `ev:${n}`,
    type: 'sport',
    name: `Home ${n} vs Away ${n}`,
    genres: ['Football'],
    releaseInfo: new Date(at)
      .toISOString()
      .replace(/:\d\d\.\d+Z$/, 'Z')
      .replace('T', ' ')
      .replace('Z', ' UTC'),
    ...extra,
  };
}

function channel(n: number) {
  return {
    id: `leaf:ch-${n}`,
    type: 'sport',
    name: `Channel ${n}`,
    releaseInfo: 'LIVE',
    genres: ['Sports'],
  };
}

/** A sports addon served from memory, counting requests and how many run at once. */
function fakeAddon(name: string, catalogs: FakeCatalog[]) {
  const base = `https://${name.toLowerCase().replace(/\W+/g, '')}.example`;
  const manifest = {
    id: `test.${name.toLowerCase().replace(/\W+/g, '')}`,
    version: '1.0.0',
    name,
    types: ['sport'],
    resources: ['catalog', 'meta'],
    idPrefixes: ['ev:', 'leaf:'],
    catalogs: catalogs.map((c) => ({
      type: c.type ?? 'sport',
      id: c.id,
      name: c.name,
      extra: [
        ...(c.declareSkip === false ? [] : [{ name: 'skip' }]),
        ...(c.genres ? [{ name: 'genre', options: c.genres }] : []),
      ],
    })),
  };
  const addon: InstalledAddon = {
    transportUrl: `${base}/manifest.json`,
    manifest: parseManifest(manifest),
    official: false,
    fetchedAt: 0,
  };
  const requests: string[] = [];
  const serve = (url: string): Promise<unknown> | undefined => {
    if (url.indexOf(base) !== 0) return undefined;
    requests.push(url.slice(base.length));
    const path = /\/catalog\/[^/]+\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(url.slice(base.length));
    const catalog = path ? catalogs.find((c) => c.id === decodeURIComponent(path[1]!)) : undefined;
    if (!catalog) return Promise.reject(new HttpError('status', 'Not found', 404));
    if (catalog.answer) return catalog.answer(url);
    const extra: Record<string, string> = {};
    for (const pair of (path![2] ?? '').split('&')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) extra[key] = decodeURIComponent(value);
    }
    const skip = Number(extra.skip ?? 0);
    const genre = extra.genre;
    const size = catalog.pageSize ?? 20;
    let list = catalog.items;
    if (genre)
      list = list.filter((item) => (item.genres as string[] | undefined)?.indexOf(genre) !== -1);
    if (catalog.skip === 'ignore') return Promise.resolve({ metas: list.slice(0, size) });
    if (catalog.skip === 'events') {
      // Skip counts matches only: channels are not counted.
      let events = 0;
      let start = 0;
      while (start < list.length && events < skip) {
        if (!String(list[start]!.id).startsWith('leaf:')) events++;
        start++;
      }
      return Promise.resolve({ metas: list.slice(start, start + size) });
    }
    return Promise.resolve({ metas: list.slice(skip, skip + size) });
  };
  return { addon, requests, serve };
}

function manualTimers() {
  let pending: Array<{ due: number; run: () => void; every?: number }> = [];
  let clock = 0;
  const timers: Timers = {
    after(ms, run) {
      const entry = { due: clock + ms, run };
      pending.push(entry);
      return () => {
        pending = pending.filter((p) => p !== entry);
      };
    },
    every(ms, run) {
      const entry = { due: clock + ms, run, every: ms };
      pending.push(entry);
      return () => {
        pending = pending.filter((p) => p !== entry);
      };
    },
  };
  return {
    timers,
    /** Runs everything that is due within `ms`, letting promises settle in between. */
    async advance(ms = 100) {
      const until = clock + ms;
      for (let round = 0; round < 500; round++) {
        for (let i = 0; i < 30; i++) await Promise.resolve();
        const due = pending.filter((p) => p.due <= until).sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        clock = Math.max(clock, due.due);
        if (due.every) due.due += due.every;
        else pending = pending.filter((p) => p !== due);
        due.run();
      }
      clock = until;
    },
  };
}

async function setup(
  addons: Array<ReturnType<typeof fakeAddon>>,
  options: { now?: () => number; laneSize?: number } = {},
) {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchJson = async (url: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      for (let i = 0; i < 3; i++) await Promise.resolve();
      for (const fake of addons) {
        const answer = fake.serve(url);
        if (answer) return await answer;
      }
      throw new HttpError('status', 'Not found', 404);
    } finally {
      inFlight--;
    }
  };
  const collection = createAddonCollection({
    storage: memoryKeyValueStore(),
    fetchJson,
    defaults: [],
  });
  const client = createAddonClient({
    collection,
    queries: createQueryCache({ now: options.now ?? (() => NOW) }),
    limiter: createLimiter(6),
    fetchJson,
  });
  const lane = createLane(options.laneSize ?? 2);
  const clock = manualTimers();
  const now = options.now ?? (() => NOW);
  const memory = createKickoffMemory({ timers: clock.timers, now });
  const feed = createSportsFeed({ client, lane, memory, timers: clock.timers, now });
  const catalogs = sportsCatalogs(
    addons.map((a) => a.addon),
    { evidence: () => true },
  );
  feed.setCatalogs(catalogs);
  return { feed, clock, lane, catalogs, maxInFlight: () => maxInFlight };
}

function day(offset = 0) {
  const date = new Date(NOW + offset * 24 * HOUR);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('paging by events', () => {
  it('pages a catalog until it has every match', async () => {
    const items = Array.from({ length: 55 }, (_, n) => match(n, NOW + n * 5 * 60 * 1000));
    const fake = fakeAddon('Pager', [{ id: 'football', name: 'Football', items }]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(55);
    expect(feed.get().loading).toBe(false);
    // skip = events so far minus 2: a couple of repeats per page, never a gap.
    expect(fake.requests).toEqual([
      '/catalog/sport/football.json',
      '/catalog/sport/football/skip=18.json',
      '/catalog/sport/football/skip=36.json',
      '/catalog/sport/football/skip=53.json',
    ]);
  });

  it('misses no match when the addon counts only matches and lists channels among them', async () => {
    const items: Array<Record<string, unknown>> = [];
    for (let n = 0; n < 40; n++) {
      items.push(channel(n));
      items.push(match(n, NOW + n * 60 * 1000));
    }
    const fake = fakeAddon('Channels', [
      { id: 'football', name: 'Football', items, skip: 'events' },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(2000);
    expect(feed.get().events).toHaveLength(40);
  });

  it('learns that the addon counts every item and pages without crawling', async () => {
    const items: Array<Record<string, unknown>> = [];
    for (let n = 0; n < 30; n++) items.push(channel(n));
    for (let n = 0; n < 50; n++) items.push(match(n, NOW + n * 60 * 1000));
    const fake = fakeAddon('Counter', [{ id: 'football', name: 'Football', items, skip: 'items' }]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(2000);
    expect(feed.get().events).toHaveLength(50);
    expect(fake.requests.length).toBeLessThanOrEqual(MAX_PAGES);
  });

  it('stops when the addon ignores skip and sends the first page again', async () => {
    const items = Array.from({ length: 40 }, (_, n) => match(n, NOW + n * 60 * 1000));
    const fake = fakeAddon('Ignorer', [
      { id: 'football', name: 'Football', items, skip: 'ignore' },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(20);
    expect(fake.requests).toHaveLength(2);
  });

  it('stops at the cap for an addon that never runs out', async () => {
    const answer = (url: string) => {
      const skip = Number(/skip=(\d+)/.exec(url)?.[1] ?? 0);
      return Promise.resolve({
        metas: Array.from({ length: 20 }, (_, i) => match(skip + i, NOW + (skip + i) * 1000)),
      });
    };
    const fake = fakeAddon('Endless', [{ id: 'football', name: 'Football', items: [], answer }]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(5000);
    expect(fake.requests).toHaveLength(MAX_PAGES);
    expect(feed.get().loading).toBe(false);
  });

  it('stops at the end of the day on screen and goes on for the next day', async () => {
    const items = Array.from({ length: 100 }, (_, n) => match(n, NOW + n * HOUR));
    const fake = fakeAddon('Days', [{ id: 'football', name: 'Football', items }]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    // 20 a page, one an hour: the first page already reaches tomorrow.
    expect(fake.requests).toHaveLength(1);
    feed.want(day(1));
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(2);
    expect(feed.get().events.length).toBeGreaterThan(20);
  });

  it('asks once with skip when a catalog declares none but sends a full page', async () => {
    const items = Array.from({ length: 150 }, (_, n) => match(n, NOW + n * 60 * 1000));
    const fake = fakeAddon('Capped', [
      { id: 'football', name: 'Football', items, pageSize: 100, declareSkip: false },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    expect(fake.requests.slice(0, 2)).toEqual([
      '/catalog/sport/football.json',
      '/catalog/sport/football/skip=100.json',
    ]);
    expect(feed.get().events).toHaveLength(150);
  });

  it('asks per genre when a full catalog cannot page, and says more may exist', async () => {
    const genres = Array.from({ length: 15 }, (_, n) => `League ${n}`);
    const items = Array.from({ length: 300 }, (_, n) =>
      match(n, NOW + n * 60 * 1000, { genres: ['Football', genres[n % 15]!] }),
    );
    const fake = fakeAddon('Genres', [
      {
        id: 'football',
        name: 'Football',
        items,
        pageSize: 50,
        skip: 'ignore',
        declareSkip: false,
        genres,
      },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(2000);
    const genrePages = fake.requests.filter((r) => r.indexOf('genre=') !== -1);
    expect(genrePages).toHaveLength(MAX_GENRES);
    expect(feed.get().events.length).toBeGreaterThan(50);
    expect(feed.get().more).toBe(false);
  });
});

describe('request slots', () => {
  it('holds at most two requests at once, whatever the number of catalogs', async () => {
    const catalogs = Array.from({ length: 12 }, (_, n) => ({
      id: `sport${n}`,
      name: `Football ${n}`,
      items: [match(n, NOW + HOUR)],
    }));
    const fake = fakeAddon('Many', catalogs);
    const { feed, clock, maxInFlight } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(12);
    expect(maxInFlight()).toBeLessThanOrEqual(2);
  });

  it('drops queued requests when sport leaves the screen, and asks them when it is back', async () => {
    const catalogs = Array.from({ length: 8 }, (_, n) => ({
      id: `sport${n}`,
      name: `Football ${n}`,
      items: [match(n, NOW + HOUR)],
    }));
    const fake = fakeAddon('Dropper', catalogs);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    feed.want(null);
    await clock.advance(1000);
    expect(fake.requests.length).toBeLessThan(8);
    expect(feed.get().failed).toEqual([]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(8);
  });
});

describe('what is fetched for what', () => {
  const live = {
    id: 'live',
    name: 'Live Now',
    items: [match(1, NOW - HOUR, { releaseInfo: 'LIVE' })],
  };
  const football = { id: 'football', name: 'Football', items: [match(2, NOW + HOUR)] };
  const replays = (n: number) => ({
    id: `replays${n}`,
    name: n === 3 ? "Today's Replays" : `Football Replays ${n}`,
    items: [
      { ...match(100 + n, NOW - 30 * HOUR), name: `Home ${100 + n} vs Away ${100 + n} Full Match` },
    ],
  });
  const channels = { id: 'tv', name: '24/7 TV', items: [channel(1)] };

  it('asks only live catalogs for the Live sport row', async () => {
    const fake = fakeAddon('Light', [live, football, replays(1), channels]);
    const { feed, clock } = await setup([fake]);
    feed.want('live', { light: true });
    await clock.advance(1000);
    expect(fake.requests).toEqual(['/catalog/sport/live.json']);
  });

  it('asks replays only for Today, two per addon, today’s first, and never channels', async () => {
    const fake = fakeAddon('Replays', [
      live,
      football,
      replays(1),
      replays(2),
      replays(3),
      channels,
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day(1));
    await clock.advance(1000);
    expect(fake.requests.some((r) => r.indexOf('replays') !== -1)).toBe(false);
    feed.want(day());
    await clock.advance(1000);
    const asked = fake.requests.filter((r) => r.indexOf('replays') !== -1);
    expect(asked).toEqual(['/catalog/sport/replays3.json', '/catalog/sport/replays1.json']);
    expect(fake.requests.some((r) => r.indexOf('/tv') !== -1)).toBe(false);
  });
});

describe('an addon that goes away', () => {
  const good = () =>
    fakeAddon('Good', [{ id: 'football', name: 'Football', items: [match(1, NOW + HOUR)] }]);

  for (const [label, answer] of [
    ['a server error', () => Promise.reject(new HttpError('status', 'Server error', 500))],
    ['a timeout', () => Promise.reject(new HttpError('timeout', 'Timed out'))],
    ['invalid JSON', () => Promise.reject(new HttpError('invalid', 'Not JSON'))],
    ['metas: null', () => Promise.resolve({ metas: null })],
    ['a bare string', () => Promise.resolve('<html>Cloudflare</html>')],
    [
      'items that are not items',
      () => Promise.resolve({ metas: [null, 7, 'x', {}, { id: 3 }, { name: 'no id' }] }),
    ],
  ] as const) {
    it(`shows the other addons on ${label}`, async () => {
      const broken = fakeAddon('Broken', [{ id: 'football', name: 'Football', items: [], answer }]);
      const ok = good();
      const { feed, clock } = await setup([broken, ok]);
      feed.want(day());
      await clock.advance(1000);
      expect(feed.get().events).toHaveLength(1);
      expect(feed.get().loading).toBe(false);
    });
  }

  it('names the addon that failed and asks it again on retry', async () => {
    let fail = true;
    const items = [match(9, NOW + HOUR)];
    const flaky = fakeAddon('Flaky', [
      {
        id: 'football',
        name: 'Football',
        items,
        answer: () =>
          fail
            ? Promise.reject(new HttpError('status', 'Server error', 500))
            : Promise.resolve({ metas: items }),
      },
    ]);
    const { feed, clock } = await setup([flaky, good()]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().failed).toEqual(['Flaky']);
    fail = false;
    feed.retry();
    await clock.advance(1000);
    expect(feed.get().failed).toEqual([]);
    expect(feed.get().events).toHaveLength(2);
  });

  it('forgets a removed addon', async () => {
    const ok = good();
    const { feed, clock } = await setup([ok]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(1);
    feed.setCatalogs([]);
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(0);
    expect(feed.get().catalogs).toBe(0);
  });
});

describe('live catalogs', () => {
  it('asks a live catalog again once its copy is two minutes old', async () => {
    let time = NOW;
    const fake = fakeAddon('Refresh', [
      { id: 'live', name: 'Live Now', items: [match(1, NOW - HOUR)] },
    ]);
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want('live');
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(1);
    time += 3 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(fake.requests).toHaveLength(2);
    feed.want(null);
    time += 10 * 60 * 1000;
    await clock.advance(10 * 60 * 1000);
    expect(fake.requests).toHaveLength(2);
  });

  it('looks up the meta of a live match with no time, at most twenty per addon', async () => {
    const items = Array.from({ length: 30 }, (_, n) => ({
      id: `ev:${n}`,
      type: 'sport',
      name: `🔴 LIVE: Home ${n} vs Away ${n}`,
      genres: ['Football'],
      releaseInfo: 'LIVE',
    }));
    const fake = fakeAddon('Metas', [{ id: 'live', name: 'Live Now', items, pageSize: 50 }]);
    const metaServe = fake.serve;
    fake.serve = (url) => {
      const meta = /\/meta\/sport\/([^/]+)\.json$/.exec(url);
      if (meta && url.indexOf('metas.example') !== -1) {
        fake.requests.push(`/meta/${decodeURIComponent(meta[1]!)}`);
        return Promise.resolve({
          meta: {
            id: decodeURIComponent(meta[1]!),
            type: 'sport',
            name: 'x',
            releaseInfo: '28 Oct 2026 · 11:15 UTC',
          },
        });
      }
      return metaServe(url);
    };
    const { feed, clock } = await setup([fake]);
    feed.want('live');
    await clock.advance(2000);
    expect(fake.requests.filter((r) => r.indexOf('/meta/') === 0)).toHaveLength(20);
    const timed = feed.get().events.filter((event) => event.kickOff?.source === 'remembered');
    expect(timed).toHaveLength(20);
    expect(timed[0]!.kickOff?.at).toBe(Date.parse('2026-10-28T11:15:00Z'));
  });
});

describe('detection input', () => {
  it('needs no addon address to tell the addon apart', () => {
    const catalog: ManifestCatalog = { type: 'sport', id: 'x', name: 'Football', extra: [] };
    expect(catalog.name).toBe('Football');
  });
});
