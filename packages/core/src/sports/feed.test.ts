import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createAddonClient } from '../addons/client';
import type { InstalledAddon } from '../addons/collection';
import { createAddonCollection } from '../addons/collection';
import { HttpError } from '../http';
import { createLane } from '../lane';
import { createLimiter } from '../limiter';
import { createQueryCache } from '../query';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import type { Timers } from '../timers';
import { catalogView, isSportsCatalog, sportsCatalogs } from './detect';
import { createSportsFeed, FULL_PAGE, MAX_GENRES, MAX_PAGES } from './feed';
import { createKickoffMemory } from './kickoffs';
import { localDate } from './time';
import { eventState } from './view';

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
  /**
   * Answers any page asked with `skip` with an error, as addons that do not
   * expect it may: 404, or the status given.
   */
  rejectSkip?: boolean | number;
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

/** A match whose time the addon replaced with LIVE. */
function liveMatch(n: number) {
  return {
    id: `ev:${n}`,
    type: 'sport',
    name: `🔴 LIVE: Home ${n} vs Away ${n}`,
    genres: ['Football'],
    releaseInfo: 'LIVE',
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
function fakeAddon(name: string, catalogs: FakeCatalog[], options: { base?: string } = {}) {
  const base = options.base ?? `https://${name.toLowerCase().replace(/\W+/g, '')}.example`;
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
    if (catalog.rejectSkip && extra.skip !== undefined) {
      const status = catalog.rejectSkip === true ? 404 : catalog.rejectSkip;
      return Promise.reject(new HttpError('status', `Status ${status}`, status));
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

/** Answers the fake's meta pages with `reply`, which gets the item id. */
function serveMeta(fake: ReturnType<typeof fakeAddon>, reply: (id: string) => Promise<unknown>) {
  const pages = fake.serve;
  fake.serve = (url) => {
    const meta = /\/meta\/sport\/([^/]+)\.json$/.exec(url);
    if (!meta || url.indexOf(fake.addon.transportUrl.replace(/manifest\.json$/, '')) !== 0) {
      return pages(url);
    }
    const id = decodeURIComponent(meta[1]!);
    fake.requests.push(`/meta/${id}`);
    return reply(id);
  };
}

/** Meta pages that give a kick-off once `release` is called. */
function heldMeta(fake: ReturnType<typeof fakeAddon>, at: number) {
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  serveMeta(fake, (id) =>
    held.then(() => ({
      meta: { id, type: 'sport', name: 'x', released: new Date(at).toISOString() },
    })),
  );
  return () => release();
}

function metaRequests(fake: ReturnType<typeof fakeAddon>): string[] {
  return fake.requests.filter((r) => r.indexOf('/meta/') === 0);
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
    /** How far the timers have run, in ms. */
    elapsed: () => clock,
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
  options: {
    now?: () => number;
    /** The clock moves with the timers, so an answer can take time to come. */
    timed?: boolean;
    laneSize?: number;
    store?: KeyValueStore;
  } = {},
) {
  const clock = manualTimers();
  const now = options.now ?? (options.timed ? () => NOW + clock.elapsed() : () => NOW);
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
    queries: createQueryCache({ now }),
    limiter: createLimiter(6),
    fetchJson,
  });
  const lane = createLane(options.laneSize ?? 2);
  const memory = createKickoffMemory({ store: options.store, timers: clock.timers, now });
  const feed = createSportsFeed({ client, lane, memory, timers: clock.timers, now });
  const catalogs = sportsCatalogs(
    addons.map((a) => a.addon),
    { evidence: () => true },
  );
  feed.setCatalogs(catalogs);
  return { feed, clock, lane, memory, catalogs, maxInFlight: () => maxInFlight };
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
    // The second page starts one item on: skip counts items, so it jumps a page at a time.
    expect(fake.requests).toEqual([
      '/catalog/sport/football.json',
      '/catalog/sport/football/skip=1.json',
      '/catalog/sport/football/skip=19.json',
      '/catalog/sport/football/skip=37.json',
      '/catalog/sport/football/skip=55.json',
      '/catalog/sport/football/skip=73.json',
    ]);
  });

  it('learns that the addon counts every item when a placeholder comes first', async () => {
    const items: Array<Record<string, unknown>> = [
      { id: 'note:update', type: 'sport', name: 'Please update the addon for more', genres: [] },
    ];
    for (let n = 0; n < 30; n++) items.push(channel(n));
    for (let n = 0; n < 50; n++) items.push(match(n, NOW + n * 60 * 1000));
    const fake = fakeAddon('Counter', [{ id: 'football', name: 'Football', items, skip: 'items' }]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(2000);
    expect(feed.get().events).toHaveLength(50);
    expect(fake.requests).toEqual([
      '/catalog/sport/football.json',
      '/catalog/sport/football/skip=1.json',
      '/catalog/sport/football/skip=19.json',
      '/catalog/sport/football/skip=37.json',
      '/catalog/sport/football/skip=55.json',
      '/catalog/sport/football/skip=73.json',
    ]);
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

  it('keeps every page when an addon refresh brings back the same catalogs', async () => {
    const items = Array.from({ length: 100 }, (_, n) => match(n, NOW + n * HOUR));
    const fake = fakeAddon('Days', [{ id: 'football', name: 'Football', items }]);
    const { feed, clock } = await setup([fake]);
    feed.want(day(1));
    await clock.advance(1000);
    const events = feed.get().events.length;
    expect(fake.requests).toHaveLength(2);
    // The manifest was fetched again: new objects, same catalogs.
    const refreshed: InstalledAddon = {
      ...fake.addon,
      manifest: {
        ...fake.addon.manifest,
        catalogs: fake.addon.manifest.catalogs.map((catalog) => ({ ...catalog })),
      },
      fetchedAt: 1,
    };
    feed.setCatalogs(sportsCatalogs([refreshed], { evidence: () => true }));
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(events);
    expect(fake.requests).toHaveLength(2);
  });

  it('goes on paging when a first page comes straight from the cache', async () => {
    const items = Array.from({ length: 100 }, (_, n) => match(n, NOW + n * HOUR));
    const fake = fakeAddon('Days', [{ id: 'football', name: 'Football', items }]);
    const { feed, clock, catalogs } = await setup([fake]);
    feed.want(day(1));
    await clock.advance(1000);
    const events = feed.get().events.length;
    expect(events).toBeGreaterThan(20);
    // Gone and back: the first page is still fresh in the cache and answers at once.
    feed.setCatalogs([]);
    feed.setCatalogs(catalogs);
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(events);
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

  it('asks per genre, at most twelve, when a full catalog cannot page', async () => {
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
    // Twenty matches a genre: every genre page has them all.
    expect(feed.get().more).toBe(false);
  });

  it('says more may exist while a genre page is still full, for the catalogs on screen', async () => {
    const genres = ['League A', 'League B', 'League C'];
    const items = Array.from({ length: 300 }, (_, n) =>
      match(n, NOW + n * 60 * 1000, { genres: ['Football', genres[n % 3]!] }),
    );
    const fake = fakeAddon('Crowded', [
      { id: 'live', name: 'Live Now', items: [match(1000, NOW - HOUR)] },
      {
        id: 'football',
        name: 'Football',
        items,
        pageSize: FULL_PAGE,
        skip: 'ignore',
        declareSkip: false,
        genres,
      },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(2000);
    expect(fake.requests.filter((r) => r.indexOf('genre=') !== -1)).toHaveLength(3);
    expect(feed.get().more).toBe(true);
    // The Live sport row asks the live catalog only: the note is not for it.
    feed.want('live', { light: true });
    await clock.advance(1000);
    expect(feed.get().more).toBe(false);
  });

  it.each([404, 500])(
    'keeps an addon that answers the skip probe with %i, and asks per genre',
    async (status) => {
      const genres = ['League A', 'League B'];
      const items = Array.from({ length: FULL_PAGE }, (_, n) =>
        match(n, NOW + n * 60 * 1000, { genres: ['Football', genres[n % 2]!] }),
      );
      const fake = fakeAddon('Strict', [
        {
          id: 'football',
          name: 'Football',
          items,
          pageSize: FULL_PAGE,
          declareSkip: false,
          rejectSkip: status,
          genres,
        },
      ]);
      const { feed, clock } = await setup([fake]);
      feed.want(day());
      await clock.advance(2000);
      expect(feed.get().events).toHaveLength(FULL_PAGE);
      expect(feed.get().failed).toEqual([]);
      expect(fake.requests).toEqual([
        '/catalog/sport/football.json',
        `/catalog/sport/football/skip=${FULL_PAGE}.json`,
        '/catalog/sport/football/genre=League%20A.json',
        '/catalog/sport/football/genre=League%20B.json',
      ]);
      // Try again is for addons that did not answer: the guess is not asked again.
      feed.retry();
      await clock.advance(1000);
      expect(fake.requests).toHaveLength(4);
    },
  );
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

  it('looks up the meta of a live match with no time, at most twenty per addon and refresh', async () => {
    let time = NOW;
    const items = Array.from({ length: 30 }, (_, n) => liveMatch(n));
    const fake = fakeAddon('Metas', [{ id: 'live', name: 'Live Now', items, pageSize: 50 }]);
    serveMeta(fake, (id) =>
      Promise.resolve({
        meta: { id, type: 'sport', name: 'x', releaseInfo: '28 Oct 2026 · 11:15 UTC' },
      }),
    );
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want('live');
    await clock.advance(2000);
    expect(metaRequests(fake)).toHaveLength(20);
    const timed = () => feed.get().events.filter((e) => e.kickOff?.source === 'remembered');
    expect(timed()).toHaveLength(20);
    expect(timed()[0]!.kickOff?.at).toBe(Date.parse('2026-10-28T11:15:00Z'));
    // The next refresh looks up the ten left.
    time += 3 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(metaRequests(fake)).toHaveLength(30);
    expect(timed()).toHaveLength(30);
  });

  it('asks a meta lookup that timed out again after the next refresh, not one the addon lacks', async () => {
    let time = NOW;
    let timeouts = 1;
    const fake = fakeAddon('Slow', [
      { id: 'live', name: 'Live Now', items: [liveMatch(1), liveMatch(2)] },
    ]);
    serveMeta(fake, (id) => {
      if (id === 'ev:2') return Promise.reject(new HttpError('status', 'Not found', 404));
      if (timeouts-- > 0) return Promise.reject(new HttpError('timeout', 'Timed out'));
      return Promise.resolve({
        meta: { id, type: 'sport', name: 'x', releaseInfo: '28 Oct 2026 · 11:15 UTC' },
      });
    });
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want('live');
    await clock.advance(1000);
    expect(metaRequests(fake)).toEqual(['/meta/ev:1', '/meta/ev:2']);
    time += 3 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(metaRequests(fake)).toEqual(['/meta/ev:1', '/meta/ev:2', '/meta/ev:1']);
    const ev1 = feed.get().events.find((e) => e.sources[0]!.id === 'ev:1');
    expect(ev1?.kickOff?.source).toBe('remembered');
  });

  it('asks dropped meta lookups again when sport is back on screen', async () => {
    const items = Array.from({ length: 10 }, (_, n) => liveMatch(n));
    const fake = fakeAddon('Held', [{ id: 'live', name: 'Live Now', items }]);
    const release = heldMeta(fake, NOW - HOUR);
    const { feed, clock } = await setup([fake]);
    feed.want('live');
    await clock.advance(1000);
    // Two lookups run and eight wait in the lane; the viewer opens an event page.
    expect(metaRequests(fake)).toHaveLength(2);
    feed.want(null);
    await clock.advance(1000);
    feed.want('live');
    release();
    await clock.advance(2000);
    expect(new Set(metaRequests(fake)).size).toBe(10);
    const timed = feed.get().events.filter((e) => e.kickOff?.source === 'remembered');
    expect(timed).toHaveLength(10);
  });

  it('pages a live catalog again when it grows after its first visit', async () => {
    let time = NOW;
    const items = Array.from({ length: 5 }, (_, n) => match(n, NOW - 2 * HOUR + n * 2 * 60 * 1000));
    const fake = fakeAddon('Growing', [{ id: 'live', name: 'Live Now', items }]);
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want('live');
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(5);
    // Saturday evening: forty more kick off.
    for (let n = 5; n < 45; n++) items.push(match(n, NOW - 2 * HOUR + n * 2 * 60 * 1000));
    time += 3 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(feed.get().events).toHaveLength(45);
    expect(fake.requests).toEqual([
      '/catalog/sport/live.json',
      '/catalog/sport/live.json',
      '/catalog/sport/live/skip=18.json',
      '/catalog/sport/live/skip=36.json',
    ]);
  });

  it('pages a live catalog from where its first page ends now, after matches left the top', async () => {
    let time = NOW;
    const items = Array.from({ length: 60 }, (_, n) =>
      match(n, NOW - 2 * HOUR + n * 2 * 60 * 1000),
    );
    const fake = fakeAddon('Shifting', [{ id: 'live', name: 'Live Now', items }]);
    const { feed, clock } = await setup([fake], { now: () => time });
    // Home's Live sport row asks the first page only.
    feed.want('live', { light: true });
    await clock.advance(1000);
    // Five matches end and leave the list; the next refresh reads the first page again.
    items.splice(0, 5);
    time += 3 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(fake.requests).toEqual(['/catalog/sport/live.json', '/catalog/sport/live.json']);
    feed.want('live');
    await clock.advance(2000);
    expect(fake.requests[2]).toBe('/catalog/sport/live/skip=18.json');
    const ids = feed.get().events.map((event) => event.sources[0]!.id);
    for (let n = 5; n < 60; n++) expect(ids).toContain(`ev:${n}`);
  });

  it('asks a stale live catalog again as soon as sport is back on screen', async () => {
    let time = NOW;
    const fake = fakeAddon('Back', [
      { id: 'live', name: 'Live Now', items: [match(1, NOW - HOUR)] },
    ]);
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want('live');
    await clock.advance(1000);
    // The viewer watches a match for ninety minutes, then presses Back.
    feed.want(null);
    time += 90 * 60 * 1000;
    await clock.advance(90 * 60 * 1000);
    expect(fake.requests).toHaveLength(1);
    feed.want('live');
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(2);
  });

  it('places a LIVE match with no time between two close kick-offs in Live now', async () => {
    const items = [
      match(1, NOW - HOUR),
      liveMatch(2),
      match(3, NOW - 30 * 60 * 1000),
      match(4, NOW + 30 * 60 * 1000),
      // Too far apart to tell when this one started.
      liveMatch(5),
      match(6, NOW + 4 * HOUR),
    ];
    const fake = fakeAddon('Sorted', [{ id: 'football', name: 'Football', items }]);
    const { feed, clock } = await setup([fake]);
    feed.want('live', { light: true });
    await clock.advance(1000);
    const event = (id: string) => feed.get().events.find((e) => e.sources[0]!.id === id)!;
    expect(event('ev:2').kickOff).toEqual({ at: NOW - HOUR, sure: false, source: 'estimated' });
    expect(eventState(event('ev:2'), { now: NOW })).toBe('live');
    expect(event('ev:5').kickOff).toBeUndefined();
  });
});

describe('catalogs that are not live', () => {
  it('asks a catalog again once its copy is fifteen minutes old, while it is on screen', async () => {
    let time = NOW;
    const items = [match(1, NOW + HOUR)];
    const fake = fakeAddon('Today', [{ id: 'football', name: 'Football', items }]);
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want(day());
    await clock.advance(1000);
    items.push(match(2, NOW + 2 * HOUR));
    time += 10 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(fake.requests).toHaveLength(1);
    time += 6 * 60 * 1000;
    await clock.advance(2 * 60 * 1000);
    expect(fake.requests).toHaveLength(2);
    expect(feed.get().events).toHaveLength(2);
  });

  it('shows no copy older than six hours, and asks for a new one when sport is back', async () => {
    let time = NOW;
    let down = false;
    const items = [match(1, NOW + 8 * HOUR)];
    const fake = fakeAddon('Old', [
      {
        id: 'football',
        name: 'Football',
        items,
        answer: () =>
          down
            ? Promise.reject(new HttpError('status', 'Server error', 500))
            : Promise.resolve({ metas: items }),
      },
    ]);
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(1);
    feed.want(null);
    time += 7 * HOUR;
    down = true;
    feed.want(day());
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(2);
    expect(feed.get().events).toHaveLength(0);
    expect(feed.get().failed).toEqual(['Old']);
    down = false;
    items.push(match(2, NOW + 9 * HOUR));
    feed.retry();
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(2);
  });
});

describe('addons that move or go', () => {
  it('asks the meta of a live match only of the addon that listed it, after one above is removed', async () => {
    const extra = fakeAddon('Extra', [
      { id: 'football', name: 'Football', items: [match(9, NOW + HOUR)] },
    ]);
    const alpha = fakeAddon('Alpha', [
      { id: 'live', name: 'Live Now', items: [liveMatch(1), liveMatch(2)] },
    ]);
    const beta = fakeAddon('Beta', [
      { id: 'football', name: 'Football', items: [match(3, NOW + HOUR)] },
    ]);
    for (const fake of [alpha, beta]) {
      serveMeta(fake, () => Promise.reject(new HttpError('status', 'Not found', 404)));
    }
    const { feed, clock } = await setup([extra, alpha, beta]);
    feed.want('live', { light: true });
    await clock.advance(1000);
    feed.setCatalogs(sportsCatalogs([alpha.addon, beta.addon], { evidence: () => true }));
    feed.want('live');
    await clock.advance(1000);
    expect(metaRequests(beta)).toEqual([]);
    expect(metaRequests(alpha)).toEqual(['/meta/ev:1', '/meta/ev:2']);
    const own = feed.get().events.filter((e) => e.sources[0]!.addonId === alpha.addon.manifest.id);
    expect(own.map((e) => e.sources[0]!.addonIndex)).toEqual([0, 0]);
  });

  it('keeps nothing from a meta lookup that ends after its addon is removed', async () => {
    const gone = fakeAddon('Gone', [{ id: 'live', name: 'Live Now', items: [liveMatch(1)] }]);
    const release = heldMeta(gone, NOW - HOUR);
    const { feed, clock, memory } = await setup([gone]);
    feed.want('live');
    await clock.advance(1000);
    expect(metaRequests(gone)).toHaveLength(1);
    // Removed in Addons settings while its lookup runs, as the app does it.
    memory.forget(gone.addon.manifest.id);
    feed.setCatalogs([]);
    release();
    await clock.advance(1000);
    expect(memory.get(gone.addon.manifest.id, 'ev:1')).toBeUndefined();
    expect(memory.firstSeen(gone.addon.manifest.id, 'ev:1')).toBeUndefined();
  });
});

describe('addon addresses', () => {
  it('tell sports catalogs apart without the address, which nothing keeps', async () => {
    const SECRET = 'k3y-0f-the-v1ewer';
    const catalogs = (): FakeCatalog[] => [
      { id: 'football', name: 'Football', items: [match(1, NOW + HOUR)] },
      { id: 'live', name: 'Live Now', items: [liveMatch(2)] },
      // An error that quotes the address it was for.
      {
        id: 'upcoming',
        name: 'Upcoming',
        items: [],
        answer: (url) => Promise.reject(new HttpError('status', `Not found: ${url}`, 404)),
      },
    ];
    const plain = fakeAddon('Keyed', catalogs());
    const keyed = fakeAddon('Keyed', catalogs(), { base: `https://keyed.example/${SECRET}` });
    // The same addon installed with a key in its address answers the same.
    const describeAll = (addon: InstalledAddon) =>
      addon.manifest.catalogs.map((catalog) => [
        isSportsCatalog(addon, catalog),
        catalogView(catalog),
      ]);
    expect(describeAll(keyed.addon)).toEqual(describeAll(plain.addon));
    const shape = (addon: InstalledAddon) =>
      sportsCatalogs([addon]).map(({ key, view, pageable, genres }) => ({
        key,
        view,
        pageable,
        genres,
      }));
    expect(shape(keyed.addon)).toEqual(shape(plain.addon));

    const store = memoryKeyValueStore();
    const { feed, clock, memory } = await setup([keyed], { store });
    feed.want('live');
    await clock.advance(2000);
    expect(feed.get().events).toHaveLength(2);
    expect(feed.get().failed).toEqual(['Keyed']);
    await memory.flush();
    const stored = JSON.stringify(await store.get('sports.kickoffs'));
    expect(stored).toContain(keyed.addon.manifest.id);
    expect(stored).not.toContain(SECRET);
  });
});

describe('clock-only times', () => {
  const EVENING = Date.parse('2026-10-28T21:00:00Z');
  // The zone comes from the addon's own settings, in its address.
  const base = 'https://clocks.example/tz=Europe%2FLondon';
  const clockMatch = (n: number, clockTime: string) => ({
    ...match(n, EVENING),
    releaseInfo: clockTime,
  });
  const at = (iso: string) => Date.parse(iso);

  it('puts the times after a wrap past midnight on the next day, and remembers that day', async () => {
    const items = ['20:00', '22:00', '23:45', '00:30', '02:00'].map((t, n) => clockMatch(n, t));
    const fake = fakeAddon('Clocks', [{ id: 'football', name: 'Football', items }], { base });
    const { feed, clock, memory } = await setup([fake], { now: () => EVENING });
    feed.want(day());
    await clock.advance(1000);
    const event = (id: string) => feed.get().events.find((e) => e.sources[0]!.id === id)!;
    expect(event('ev:2').kickOff?.at).toBe(at('2026-10-28T23:45:00Z'));
    expect(event('ev:3').kickOff?.at).toBe(at('2026-10-29T00:30:00Z'));
    expect(event('ev:4').kickOff?.at).toBe(at('2026-10-29T02:00:00Z'));
    expect(eventState(event('ev:3'), { now: EVENING })).toBe('upcoming');
    // Kept for when the addon swaps the time for LIVE: tomorrow's, not this morning's.
    expect(memory.get(fake.addon.manifest.id, 'ev:3')?.at).toBe(at('2026-10-29T00:30:00Z'));
  });

  it('keeps the same list on last night when it is seen after midnight', async () => {
    const night = Date.parse('2026-10-29T01:00:00Z');
    const items = ['20:00', '22:00', '23:45', '00:30', '02:00'].map((t, n) => clockMatch(n, t));
    const fake = fakeAddon('Clocks', [{ id: 'football', name: 'Football', items }], { base });
    const { feed, clock, memory } = await setup([fake], { now: () => night });
    feed.want(localDate(night));
    await clock.advance(1000);
    const event = (id: string) => feed.get().events.find((e) => e.sources[0]!.id === id)!;
    expect(event('ev:0').kickOff?.at).toBe(at('2026-10-28T20:00:00Z'));
    expect(event('ev:2').kickOff?.at).toBe(at('2026-10-28T23:45:00Z'));
    // Under way for half an hour, and an hour away: neither is tomorrow's.
    expect(event('ev:3').kickOff?.at).toBe(at('2026-10-29T00:30:00Z'));
    expect(event('ev:4').kickOff?.at).toBe(at('2026-10-29T02:00:00Z'));
    expect(eventState(event('ev:4'), { now: night })).toBe('upcoming');
    expect(memory.get(fake.addon.manifest.id, 'ev:3')?.at).toBe(at('2026-10-29T00:30:00Z'));
  });

  it('keeps a live-first list on its days around midnight, and live once a time turns LIVE', async () => {
    let time = Date.parse('2026-10-29T00:20:00Z');
    // 00:10 and last night's 23:50 are under way, live first; 00:30 and 01:00 are to come.
    const items = ['00:10', '23:50', '00:30', '01:00'].map((t, n) => clockMatch(n, t));
    const fake = fakeAddon('Clocks', [{ id: 'football', name: 'Football', items }], { base });
    const { feed, clock, memory } = await setup([fake], { now: () => time });
    feed.want(localDate(time));
    await clock.advance(1000);
    const event = (id: string) => feed.get().events.find((e) => e.sources[0]!.id === id)!;
    expect(event('ev:1').kickOff?.at).toBe(at('2026-10-28T23:50:00Z'));
    expect(eventState(event('ev:1'), { now: time })).toBe('live');
    expect(event('ev:2').kickOff?.at).toBe(at('2026-10-29T00:30:00Z'));
    expect(event('ev:3').kickOff?.at).toBe(at('2026-10-29T01:00:00Z'));
    expect(memory.get(fake.addon.manifest.id, 'ev:2')?.at).toBe(at('2026-10-29T00:30:00Z'));
    // The addon swaps the 00:30's time for LIVE once it starts: memory keeps its day.
    time = Date.parse('2026-10-29T00:40:00Z');
    items[2] = { ...items[2]!, releaseInfo: 'LIVE' };
    feed.refresh();
    await clock.advance(3 * 60 * 1000);
    expect(event('ev:2').kickOff).toMatchObject({
      at: at('2026-10-29T00:30:00Z'),
      source: 'remembered',
    });
    expect(eventState(event('ev:2'), { now: time })).toBe('live');
  });

  it('reads a wrap across pages, and stops paging once the list reaches tomorrow', async () => {
    // Every quarter of an hour from 17:00: the last two are at 00:00 and 00:15.
    const items = Array.from({ length: 30 }, (_, n) => {
      const minutes = 17 * 60 + n * 15;
      const pad = (value: number) => String(value).padStart(2, '0');
      return clockMatch(n, `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`);
    });
    const fake = fakeAddon('Clocks', [{ id: 'football', name: 'Football', items }], { base });
    const { feed, clock, memory } = await setup([fake], { now: () => EVENING });
    feed.want(day());
    await clock.advance(1000);
    const event = (id: string) => feed.get().events.find((e) => e.sources[0]!.id === id)!;
    expect(event('ev:19').kickOff?.at).toBe(at('2026-10-28T21:45:00Z'));
    expect(event('ev:28').kickOff?.at).toBe(at('2026-10-29T00:00:00Z'));
    expect(event('ev:29').kickOff?.at).toBe(at('2026-10-29T00:15:00Z'));
    expect(memory.get(fake.addon.manifest.id, 'ev:29')?.at).toBe(at('2026-10-29T00:15:00Z'));
    expect(fake.requests).toEqual([
      '/catalog/sport/football.json',
      '/catalog/sport/football/skip=18.json',
    ]);
  });
});

describe('pages that could not answer', () => {
  const timedOut = () => Promise.reject(new HttpError('timeout', 'Timed out'));
  const skipOf = (url: string) => Number(/skip=(\d+)/.exec(url)?.[1] ?? 0);

  it('names the addon when a later page fails, and asks it again on retry or after a while', async () => {
    let time = NOW;
    let down = true;
    const items = Array.from({ length: 55 }, (_, n) => match(n, NOW + n * 5 * 60 * 1000));
    const answer = (url: string) => {
      const skip = skipOf(url);
      if (skip > 0 && down) return timedOut();
      return Promise.resolve({ metas: items.slice(skip, skip + 20) });
    };
    const fake = fakeAddon('Pager', [{ id: 'football', name: 'Football', items: [], answer }]);
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(20);
    expect(feed.get().failed).toEqual(['Pager']);
    // Not asked again before a fresh copy would be.
    time += 5 * 60 * 1000;
    await clock.advance(60 * 1000);
    expect(fake.requests).toHaveLength(2);
    feed.retry();
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(3);
    expect(feed.get().failed).toEqual(['Pager']);
    // The addon is back: the next look after fifteen minutes asks it again.
    down = false;
    time += 16 * 60 * 1000;
    await clock.advance(60 * 1000);
    expect(feed.get().events).toHaveLength(55);
    expect(feed.get().failed).toEqual([]);
  });

  it('keeps a skip probe that did not answer in time, and pages once it answers', async () => {
    let timeouts = 1;
    const items = Array.from({ length: 120 }, (_, n) => match(n, NOW + n * 5 * 60 * 1000));
    const answer = (url: string) => {
      const skip = skipOf(url);
      if (skip > 0 && timeouts-- > 0) return timedOut();
      return Promise.resolve({ metas: items.slice(skip, skip + FULL_PAGE) });
    };
    const fake = fakeAddon('Capped', [
      { id: 'football', name: 'Football', items: [], answer, declareSkip: false },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(FULL_PAGE);
    expect(feed.get().failed).toEqual(['Capped']);
    feed.retry();
    await clock.advance(1000);
    expect(feed.get().events).toHaveLength(120);
    expect(feed.get().failed).toEqual([]);
  });

  it('gives up the skip probe when it does not answer twice, and asks per genre', async () => {
    const genres = ['League A', 'League B'];
    const items = Array.from({ length: FULL_PAGE }, (_, n) =>
      match(n, NOW + n * 60 * 1000, { genres: ['Football', genres[n % 2]!] }),
    );
    const answer = (url: string) =>
      skipOf(url) > 0
        ? timedOut()
        : Promise.resolve({
            metas: items.filter((item) => {
              const genre = /genre=([^/.]+)/.exec(url)?.[1];
              return !genre || (item.genres as string[])[1] === decodeURIComponent(genre);
            }),
          });
    const fake = fakeAddon('Slow', [
      { id: 'football', name: 'Football', items: [], answer, declareSkip: false, genres },
    ]);
    const { feed, clock } = await setup([fake]);
    feed.want(day());
    await clock.advance(1000);
    expect(feed.get().failed).toEqual(['Slow']);
    feed.retry();
    await clock.advance(1000);
    expect(feed.get().failed).toEqual([]);
    expect(feed.get().events).toHaveLength(FULL_PAGE);
    expect(fake.requests.filter((r) => r.indexOf('skip=') !== -1)).toHaveLength(2);
    expect(fake.requests.filter((r) => r.indexOf('genre=') !== -1)).toHaveLength(2);
    feed.retry();
    await clock.advance(1000);
    expect(fake.requests.filter((r) => r.indexOf('skip=') !== -1)).toHaveLength(2);
  });

  it('asks catalogs that stopped answering no more often than a fresh copy, on ticks and day changes', async () => {
    let time = NOW;
    let down = false;
    const items = [match(1, NOW + HOUR)];
    const answer = () => (down ? timedOut() : Promise.resolve({ metas: items }));
    const fake = fakeAddon(
      'Down',
      ['Football', 'Basketball', 'Tennis'].map((name) => ({
        id: name.toLowerCase(),
        name,
        items,
        answer,
      })),
    );
    const { feed, clock } = await setup([fake], { now: () => time });
    feed.want(day());
    await clock.advance(1000);
    expect(fake.requests).toHaveLength(3);
    down = true;
    for (let i = 0; i < 15; i++) {
      time += 2 * 60 * 1000;
      await clock.advance(2 * 60 * 1000);
    }
    // Asked once each when the copies turned stale at fifteen minutes, then left for fifteen more.
    expect(fake.requests).toHaveLength(6);
    // The viewer looks along the day strip and back.
    for (let n = 1; n <= 6; n++) {
      feed.want(day(n));
      await clock.advance(500);
    }
    feed.want(day());
    await clock.advance(500);
    expect(fake.requests).toHaveLength(6);
    time += 2 * 60 * 1000;
    await clock.advance(30 * 1000);
    expect(fake.requests).toHaveLength(9);
    // The copy is not six hours old: still shown, and nothing says the addon failed.
    expect(feed.get().events).toHaveLength(1);
    expect(feed.get().failed).toEqual([]);
  });
});

describe('copies no longer followed', () => {
  it('stops showing a catalog once its copy is six hours old, and asks it when it is back', async () => {
    let time = NOW;
    const fake = fakeAddon('Old', [
      { id: 'live', name: 'Live Now', items: [match(1, NOW - HOUR)] },
      { id: 'football', name: 'Football', items: [match(2, NOW + 7 * HOUR)] },
    ]);
    const { feed, clock } = await setup([fake], { now: () => time });
    const ids = () => feed.get().events.map((e) => e.sources[0]!.id);
    feed.want(day());
    await clock.advance(1000);
    expect(ids()).toContain('ev:2');
    // Home's Live sport row for the rest of the day asks only the live catalog.
    feed.want('live', { light: true });
    for (let i = 0; i < 11; i++) {
      time += 30 * 60 * 1000;
      await clock.advance(30 * 60 * 1000);
    }
    expect(ids()).toContain('ev:2');
    time += 60 * 60 * 1000;
    await clock.advance(30 * 60 * 1000);
    expect(ids()).toEqual(['ev:1']);
    expect(fake.requests.filter((r) => r.indexOf('football') !== -1)).toHaveLength(1);
    feed.want(day());
    await clock.advance(1000);
    expect(ids()).toContain('ev:2');
    expect(fake.requests.filter((r) => r.indexOf('football') !== -1)).toHaveLength(2);
  });
});

describe('how often live catalogs are asked', () => {
  /** A live catalog whose answers take two seconds, with the cache hints given. */
  function slowLive(hints: Record<string, number> = {}) {
    const asked: number[] = [];
    let after: Timers['after'] = () => () => undefined;
    let elapsed = () => 0;
    const fake = fakeAddon('Slow', [
      {
        id: 'live',
        name: 'Live Now',
        items: [],
        answer: () => {
          asked.push(elapsed());
          return new Promise((resolve) =>
            after(2000, () => resolve({ metas: [match(1, NOW - HOUR)], ...hints })),
          );
        },
      },
    ]);
    return {
      fake,
      asked,
      bind(clock: ReturnType<typeof manualTimers>) {
        after = clock.timers.after;
        elapsed = clock.elapsed;
      },
    };
  }

  it('asks again about two minutes after each answer', async () => {
    const live = slowLive();
    const { feed, clock } = await setup([live.fake], { timed: true });
    live.bind(clock);
    feed.want('live');
    for (let minute = 0; minute < 20; minute++) await clock.advance(60 * 1000);
    expect(live.asked.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < live.asked.length; i++) {
      const gap = live.asked[i]! - live.asked[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(2 * 60 * 1000);
      expect(gap).toBeLessThanOrEqual(2 * 60 * 1000 + 20 * 1000);
    }
  });

  it('never asks sooner than two minutes after an answer, whatever the addon allows', async () => {
    const live = slowLive({ cacheMaxAge: 10 });
    const { feed, clock } = await setup([live.fake], { timed: true });
    live.bind(clock);
    feed.want('live');
    await clock.advance(30 * 1000);
    feed.want(day());
    await clock.advance(30 * 1000);
    feed.want('live');
    await clock.advance(30 * 1000);
    expect(live.asked).toHaveLength(1);
    await clock.advance(60 * 1000);
    expect(live.asked).toHaveLength(2);
  });
});
