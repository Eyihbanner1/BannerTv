import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { MEDIA_HOST } from './play';

/**
 * Two made-up sports addons for the Sports journeys. Nothing here comes from
 * a real addon's address: real sports addons are never named or contacted in
 * tests (docs/PLAN.md, Sports addons, Store and privacy). Matches are made
 * relative to SPORTS_NOW, which the journeys fix the page's clock to, in
 * London time.
 */

/** Wednesday 28 October 2026, 19:30 in London (GMT). */
export const SPORTS_NOW = new Date('2026-10-28T19:30:00Z');
export const SPORTS_ADDON_URL = 'https://sports.example.com/bannertv/manifest.json';
/** A second sports addon: it lists one match the first also has, and its live catalog fails. */
export const MORE_SPORTS_URL = 'https://more-sports.example.com/bannertv/manifest.json';
/** An addon whose one catalog shows it is sport only by what its first page holds. */
export const LIVE_EVENTS_URL = 'https://events.example.com/bannertv/manifest.json';

const at = (iso: string) => `${iso.replace(/Z$/, '')}.000Z`;

export const SPORTS_MANIFEST = {
  id: 'org.bannertv.test-sports',
  version: '1.0.0',
  name: 'Test Sports',
  description: 'Made-up matches for the Sports journeys.',
  types: ['sport'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['tsport:'],
  catalogs: [
    { type: 'sport', id: 'live', name: '🔴 Live' },
    {
      type: 'sport',
      id: 'today',
      name: 'Today',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      type: 'sport',
      id: 'football',
      name: 'Football',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      type: 'sport',
      id: 'search',
      name: 'Search',
      extra: [{ name: 'search', isRequired: true }],
    },
  ],
};

export const MORE_SPORTS_MANIFEST = {
  id: 'org.bannertv.more-sports',
  version: '2.0.0',
  name: 'More Sports',
  description: 'A second made-up sports addon.',
  // It claims the first addon's ids and type too, so asking every addon that
  // could answer would ask it: it must never be asked for that addon's matches.
  types: ['tv', 'sport'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['tsport:', 'msport:'],
  catalogs: [
    { type: 'tv', id: 'more_sports_live', name: 'Live Now' },
    { type: 'tv', id: 'more_sports_channels', name: '24/7 Sports Channels' },
  ],
};

/** Its catalog names a view sports addons have, but no sport: Home shows it until a page says. */
export const LIVE_EVENTS_MANIFEST = {
  id: 'org.bannertv.live-events',
  version: '1.0.0',
  name: 'Live Events',
  description: 'A made-up addon of events.',
  types: ['tv'],
  resources: ['catalog'],
  idPrefixes: ['levent:'],
  catalogs: [{ type: 'tv', id: 'events', name: 'Live Events' }],
};

export interface Match {
  id: string;
  name: string;
  genres?: string[];
  released?: string;
  releaseInfo?: string;
  description?: string;
}

/** The first addon's matches, as its live, today and football catalogs list them. */
export const MATCHES = {
  arsenal: {
    id: 'tsport:arsenal-brighton',
    name: 'Arsenal vs Brighton',
    genres: ['Football', 'EFL Cup'],
    released: at('2026-10-28T19:00:00Z'),
  },
  celtic: {
    id: 'tsport:celtic-rangers',
    name: 'Celtic vs Rangers',
    genres: ['Football'],
    released: at('2026-10-28T19:40:00Z'),
  },
  city: {
    id: 'tsport:city-burnley',
    name: 'Manchester City vs Burnley',
    genres: ['Football', 'EFL Cup'],
    released: at('2026-10-28T20:00:00Z'),
  },
  barnsley: {
    id: 'tsport:barnsley-leeds',
    name: 'Barnsley vs Leeds United',
    genres: ['Football', 'EFL Trophy'],
    released: at('2026-10-28T12:00:00Z'),
  },
  lakers: {
    id: 'tsport:lakers-knicks',
    name: 'Los Angeles Lakers vs New York Knicks',
    genres: ['Basketball'],
    released: at('2026-10-29T00:30:00Z'),
  },
  /** Only in the addon's own search. A zone abbreviation alone leaves its time unsure. */
  wolves: {
    id: 'tsport:wolves-villa',
    name: 'Wolves vs Aston Villa',
    genres: ['Football'],
    releaseInfo: '29 Oct 2026 · 20:00 WET',
  },
  /** A full match on demand, listed only where a journey's catalogs answer with it. */
  replay: {
    id: 'tsport:replay-chelsea-arsenal',
    name: 'Chelsea vs Arsenal (Full match replay)',
    genres: ['Football', 'Premier League'],
    released: at('2026-10-25T16:30:00Z'),
  },
} satisfies Record<string, Match>;

/** Not matches: they never reach a row. */
const NOT_MATCHES: Match[] = [
  { id: 'tsport:ch-1', name: 'Sky Sports Main Event', releaseInfo: '24/7', genres: ['Football'] },
  { id: 'tsport:none', name: 'No more events today', genres: ['Sports'] },
];

function item(match: Match, type = 'sport') {
  return {
    id: match.id,
    type,
    name: match.name,
    posterShape: 'landscape',
    genres: match.genres ?? [],
    ...(match.released && { released: match.released }),
    ...(match.releaseInfo && { releaseInfo: match.releaseInfo }),
    ...(match.description && { description: match.description }),
  };
}

/** Filler for the today catalog's later pages: one football match an hour from tomorrow on. */
function filler(n: number): Match {
  const kickOff = new Date(Date.parse('2026-10-29T12:00:00Z') + n * 60 * 60 * 1000);
  return {
    id: `tsport:filler-${n}`,
    name: `Club ${n} FC vs Athletic ${n} FC`,
    genres: ['Football'],
    released: at(kickOff.toISOString().replace(/\.\d+Z$/, 'Z')),
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

export interface SportsOptions {
  /** Also installs More Sports. */
  moreSports?: boolean;
  /**
   * Also installs Live Events, last. Its first page, four matches, answers
   * once this settles.
   */
  liveEvents?: Promise<void>;
  /** Installs Test Sports first, before Cinemeta. */
  sportsFirst?: boolean;
  /**
   * Installs More Sports before Test Sports, so a request sent to every addon
   * that could answer for Test Sports' ids asks More Sports first.
   */
  moreSportsFirst?: boolean;
  /** The live catalog's own cache hint: its answers are fresh for this many seconds. */
  liveMaxAge?: number;
  /** Answers for particular catalog paths of Test Sports, e.g. `sport/live`. Undefined falls through. */
  catalogs?: Record<string, (route: Route, extra: string) => Promise<void> | undefined>;
  /** While this gives a promise, Test Sports' catalogs answer only once it settles. */
  held?: () => Promise<void> | undefined;
  /**
   * The manifest Test Sports' address answers with once this settles, for
   * the app's daily refresh. Until then, and without it, the installed one.
   */
  update?: Promise<unknown>;
  /** Stored "Show in Sports" settings, by addon id. */
  settings?: Record<string, 'yes' | 'no'>;
}

export interface SportsRequests {
  /** Every Test Sports and More Sports request, as `host path`. */
  all: string[];
  /** Stream requests, as `host type/id`. */
  streams: string[];
}

/**
 * Installs Cinemeta, the sports addons and OpenSubtitles before the app
 * starts, the way the app stores them. Call after mockAddons and before
 * page.goto.
 */
export async function seedSports(page: Page, options: SportsOptions = {}): Promise<void> {
  const core = resolve(import.meta.dirname, '../../../packages/core/src/addons');
  const cinemeta = JSON.parse(readFileSync(resolve(core, 'cinemeta.manifest.json'), 'utf8'));
  const subtitles = JSON.parse(
    readFileSync(resolve(core, 'opensubtitles-v3.manifest.json'), 'utf8'),
  );
  const sports = {
    transportUrl: SPORTS_ADDON_URL,
    manifest: SPORTS_MANIFEST,
    official: false,
    fetchedAt: 0,
  };
  const more = options.moreSports
    ? [
        {
          transportUrl: MORE_SPORTS_URL,
          manifest: MORE_SPORTS_MANIFEST,
          official: false,
          fetchedAt: 0,
        },
      ]
    : [];
  const addons = [
    ...(options.sportsFirst ? [sports] : []),
    {
      transportUrl: 'https://v3-cinemeta.strem.io/manifest.json',
      manifest: cinemeta,
      official: true,
      fetchedAt: 0,
    },
    ...(options.sportsFirst ? [] : options.moreSportsFirst ? [...more, sports] : [sports, ...more]),
    {
      transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
      manifest: subtitles,
      official: true,
      fetchedAt: 0,
    },
    ...(options.liveEvents
      ? [
          {
            transportUrl: LIVE_EVENTS_URL,
            manifest: LIVE_EVENTS_MANIFEST,
            official: false,
            fetchedAt: 0,
          },
        ]
      : []),
  ];
  await page.addInitScript(
    ({ stored, settings }) => {
      if (sessionStorage.getItem('bannertv.test.seeded')) return;
      sessionStorage.setItem('bannertv.test.seeded', '1');
      const request = indexedDB.open('bannertv', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache').createIndex('storedAt', 'storedAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(stored, 'addons');
        if (settings) tx.objectStore('kv').put(settings, 'sports.settings');
        tx.oncomplete = () => db.close();
      };
    },
    { stored: addons, settings: options.settings ?? null },
  );
}

/** Routes the two sports addons. Their streams play MEDIA_HOST's test file (mockPlayback). */
export async function mockSports(page: Page, options: SportsOptions = {}): Promise<SportsRequests> {
  const requests: SportsRequests = { all: [], streams: [] };
  const { arsenal, celtic, city, barnsley, lakers } = MATCHES;

  await page.route(/^https:\/\/sports\.example\.com\/bannertv\//, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    requests.all.push(`sports ${path}`);
    if (path === '/bannertv/manifest.json') {
      return json(route, options.update ? await options.update : SPORTS_MANIFEST);
    }
    const catalog = /^\/bannertv\/catalog\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(path);
    if (catalog) {
      const held = options.held?.();
      if (held) await held;
      const [, type, id, extra = ''] = catalog as unknown as [string, string, string, string?];
      const answered = options.catalogs?.[`${type}/${id}`]?.(route, extra);
      if (answered) return answered;
      const skip = Number(/skip=(\d+)/.exec(extra)?.[1] ?? 0);
      if (id === 'live') {
        const metas = [arsenal, celtic].map((m) => item(m));
        const age = options.liveMaxAge;
        return json(route, age === undefined ? { metas } : { metas, cacheMaxAge: age });
      }
      if (id === 'today') {
        // Fifty to a page, so the screen pages by events; it ends at 110.
        const all = [barnsley, arsenal, celtic, city, ...NOT_MATCHES, lakers];
        for (let n = 0; all.length < 110; n++) all.push(filler(n));
        return json(route, { metas: all.slice(skip, skip + 50).map((m) => item(m)) });
      }
      if (id === 'football') {
        return json(route, {
          metas: skip > 0 ? [] : [barnsley, arsenal, city].map((m) => item(m)),
        });
      }
      if (id === 'search') {
        // Each word of the search starts a word of the name: "man city" finds Manchester City.
        const words = (/search=([^&]+)/.exec(extra)?.[1] ?? '').toLowerCase().split(/\s+/);
        const found = [barnsley, arsenal, celtic, city, lakers, MATCHES.wolves].filter((m) => {
          const name = m.name.toLowerCase().split(/\s+/);
          return words.every((word) => name.some((part) => part.indexOf(word) === 0));
        });
        return json(route, { metas: found.map((m) => item(m)) });
      }
    }
    const meta = /^\/bannertv\/meta\/sport\/([^/]+)\.json$/.exec(path);
    if (meta) {
      const match = Object.values(MATCHES).find((m) => m.id === meta[1]);
      return match
        ? json(route, {
            meta: { ...item(match), description: `${match.name}, made up for the journeys.` },
          })
        : json(route, { meta: null }, 404);
    }
    const stream = /^\/bannertv\/stream\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (stream) {
      requests.streams.push(`sports ${stream[1]}/${stream[2]}`);
      return json(route, {
        streams: [
          {
            name: 'Test Sports\n1080p',
            description: 'Match feed 1080p',
            url: `${MEDIA_HOST}/match-1080p.webm`,
            behaviorHints: { filename: 'match-1080p.webm' },
          },
        ],
      });
    }
    return json(route, { error: 'not found' }, 404);
  });

  await page.route(/^https:\/\/more-sports\.example\.com\/bannertv\//, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    requests.all.push(`more ${path}`);
    if (path === '/bannertv/manifest.json') return json(route, MORE_SPORTS_MANIFEST);
    if (path === '/bannertv/catalog/tv/more_sports_live.json') {
      // The upstream has gone away.
      return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
    }
    const stream = /^\/bannertv\/stream\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (stream) {
      requests.streams.push(`more ${stream[1]}/${stream[2]}`);
      return json(route, { streams: [] });
    }
    return json(route, { metas: [] });
  });

  const events = options.liveEvents;
  if (events) {
    await page.route(/^https:\/\/events\.example\.com\/bannertv\//, async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      requests.all.push(`events ${path}`);
      if (path === '/bannertv/manifest.json') return json(route, LIVE_EVENTS_MANIFEST);
      if (path !== '/bannertv/catalog/tv/events.json') return json(route, { metas: [] });
      await events;
      const metas = ['Lions', 'Tigers', 'Bears', 'Wolves'].map((name, n) => ({
        id: `levent:${n}`,
        type: 'tv',
        name: `${name} vs Hawks ${n}`,
        released: at(`2026-10-28T2${n}:00:00Z`),
      }));
      return json(route, { metas });
    });
  }
  return requests;
}

/** An item with fields of the wrong kind, or none, as a broken addon might send. */
export function oddItems(): unknown[] {
  const long = 'Q'.repeat(5000);
  return [
    { id: 'tsport:odd-1', type: 'sport', name: 12345 },
    { id: 'tsport:odd-2', type: 'sport', name: '', genres: 'Football' },
    { id: 'tsport:odd-3', type: 'sport', name: null, released: 'not a date' },
    { id: 'tsport:odd-4', type: 'sport', name: `${long} vs ${long}`, genres: [{}, 7, null] },
    { id: 'tsport:odd-5', type: 'sport', name: '<img src=x onerror="window.__xss=1"> vs Rangers' },
    { id: 'tsport:odd-6', type: 'sport', name: '⚽🔥🔥🔥 vs 🏆🏆', releaseInfo: { at: 5 } },
    { id: 'tsport:odd-7', type: 'sport', name: 'vs', released: '2026-13-45T99:99:99.000Z' },
    { id: 'tsport:odd-8', type: 'sport', name: 'A vs B vs C vs D', released: 1793206800000 },
    { id: 'tsport:odd-9', type: 'sport', name: 'الأهلي vs الزمالك', genres: ['Football'] },
    { id: 'tsport:odd-10', type: 'sport', name: 'Team\u0000 vs ‮Team', genres: ['Football'] },
    { id: 7, type: 'sport', name: 'Bad id vs Worse id' },
    null,
    'a string item',
    { type: 'sport', name: 'No id vs At all' },
  ];
}

/**
 * A crowded day: `count` football matches from 13:00 to 23:00 today across
 * forty made-up leagues, so the screen has many rows of many tiles.
 */
export function crowdedDay(count: number): unknown[] {
  const start = Date.parse('2026-10-28T13:00:00Z');
  const items = [];
  for (let n = 0; n < count; n++) {
    // On the quarter hour: a time with seconds reads as when the addon fetched it.
    const kickOff = new Date(start + Math.floor(n / 75) * 15 * 60 * 1000);
    items.push(
      item({
        id: `tsport:crowd-${n}`,
        name: `Town ${n} vs City ${n}`,
        genres: ['Football', `Made-up League ${n % 40}`],
        released: kickOff.toISOString(),
      }),
    );
  }
  return items;
}
