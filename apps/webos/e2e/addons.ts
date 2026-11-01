import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page, Route } from '@playwright/test';
import demoWorker from '../../../services/demo/src/worker';
import { API_SERVICE } from '../src/data/api-service';
import { PAIR_SERVICE } from '../src/data/pairing';
import { SYNC_SERVICE } from '../src/data/sync-service';

/**
 * A fake Cinemeta and OpenSubtitles for the journeys, so they never touch the
 * network. Catalogs are built from the Blender open movies; one series has
 * two seasons. Every image host gets a small PNG. BannerTV Demo is the real
 * Worker from services/demo, run in the test.
 */

const CORE = resolve(import.meta.dirname, '../../../packages/core/src/addons');
const CINEMETA_MANIFEST = readFileSync(resolve(CORE, 'cinemeta.manifest.json'), 'utf8');
const SUBTITLES_MANIFEST = readFileSync(resolve(CORE, 'opensubtitles-v3.manifest.json'), 'utf8');

export const FIRST_ROW = 'home-0-movie-top';
export const SERIES_ROW = 'home-0-series-top';
/** On a first launch BannerTV Demo comes first, so its row leads Home. */
export const DEMO_ROW = 'home-0-movie-blender';

/**
 * Later launches start from the addons a viewer had before BannerTV Demo was
 * preinstalled, so the journeys keep browsing Cinemeta's rows. The first-run
 * journeys see the Demo.
 */
const EARLIER_ADDONS = [
  {
    transportUrl: 'https://v3-cinemeta.strem.io/manifest.json',
    manifest: JSON.parse(CINEMETA_MANIFEST) as unknown,
    official: true,
    fetchedAt: 0,
  },
  {
    transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
    manifest: JSON.parse(SUBTITLES_MANIFEST) as unknown,
    official: true,
    fetchedAt: 0,
  },
];

/** An addon the journeys can install by its address. */
export const EXTRA_ADDON_URL = 'https://addon.example.com/bannertv/manifest.json';
const EXTRA_ADDON = {
  id: 'com.example.shorts',
  version: '1.2.0',
  name: 'Open Shorts',
  description: 'Short films from open studios.',
  types: ['movie'],
  resources: ['catalog'],
  catalogs: [{ type: 'movie', id: 'trending', name: 'Trending shorts' }],
  behaviorHints: { configurable: true },
};
/** Open Shorts with settings chosen on its settings page. */
export const CONFIGURED_ADDON_URL = 'https://addon.example.com/bannertv/lang=en/manifest.json';
/** Open Shorts set up so that it no longer has a settings page. */
export const PLAIN_ADDON_URL = 'https://addon.example.com/bannertv/plain/manifest.json';
/** Open Shorts with settings too long to fit in a QR code with the pairing page. */
export const LONG_ADDON_URL = `https://addon.example.com/bannertv/k=${'x'.repeat(600)}/manifest.json`;
/** Pages that `skip` reaches beyond the first: the catalogs end after this many titles. */
const PAGED_TOTAL = 42;

const MOVIES: ReadonlyArray<readonly [id: string, name: string, year: string]> = [
  ['tt0807840', 'Elephants Dream', '2006'],
  ['tt1254207', 'Big Buck Bunny', '2008'],
  ['tt1727587', 'Sintel', '2010'],
  ['tt2285752', 'Tears of Steel', '2012'],
  ['tt9000005', 'Caminandes', '2013'],
  ['tt9000006', 'Cosmos Laundromat', '2015'],
  ['tt9000007', 'Glass Half', '2015'],
  ['tt9000008', 'Agent 327', '2017'],
  ['tt9000009', 'Hero', '2018'],
  ['tt9000010', 'Spring', '2019'],
  ['tt9000011', 'Coffee Run', '2020'],
  ['tt9000012', 'Sprite Fright', '2021'],
  ['tt9000013', 'Charge', '2022'],
  ['tt9000014', 'Wing It!', '2023'],
];

const SERIES: ReadonlyArray<readonly [id: string, name: string, year: string]> = [
  ['tt8000001', 'Morevna Project', '2016–'],
  ['tt8000002', 'Pepper and Carrot', '2018–2020'],
  ['tt8000003', 'Open Shorts', '2019–'],
  ['tt8000004', 'Studio Diaries', '2020–2022'],
  ['tt8000005', 'Blender Today', '2021–'],
];

function preview(type: string, [id, name, year]: readonly [string, string, string]) {
  return {
    id,
    imdb_id: id,
    type,
    name,
    releaseInfo: year,
    poster: `https://images.metahub.space/poster/small/${id}/img`,
    background: `https://images.metahub.space/background/medium/${id}/img`,
    logo: `https://images.metahub.space/logo/medium/${id}/img`,
    description: `${name} is a Blender Studio open project.`,
    imdbRating: '7.1',
    genres: ['Animation', 'Short'],
  };
}

function seriesMeta(id: string, upcoming: readonly string[] = [], runtime?: string) {
  const entry = SERIES.find(([seriesId]) => seriesId === id);
  if (!entry) return null;
  const videos = [];
  for (const [season, count] of [
    [1, 8],
    [2, 3],
    [0, 1],
  ] as const) {
    for (let episode = 1; episode <= count; episode++) {
      videos.push({
        id: `${id}:${season}:${episode}`,
        name: season === 0 ? 'Behind the scenes' : `Season ${season} episode ${episode}`,
        season,
        number: episode,
        released: upcoming.includes(`${id}:${season}:${episode}`)
          ? '2099-01-01T00:00:00.000Z'
          : `202${season}-0${episode > 9 ? 9 : episode}-01T00:00:00.000Z`,
        thumbnail: `https://episodes.metahub.space/${id}/${season}/${episode}/w780.jpg`,
        overview: `What happens in season ${season}, episode ${episode}.`,
      });
    }
  }
  return {
    ...preview('series', entry),
    ...(runtime && { runtime }),
    cast: ['Ton Roosendaal'],
    links: [{ name: 'Nikolai Mamashev', category: 'Directors' }],
    videos,
  };
}

function movieMeta(id: string) {
  const entry = MOVIES.find(([movieId]) => movieId === id);
  return entry
    ? {
        ...preview('movie', entry),
        runtime: '15 min',
        cast: ['Proog', 'Emo'],
        director: ['Bassam Kurdali'],
        ...(id === 'tt1727587'
          ? { trailerStreams: [{ title: 'Trailer', ytId: 'eRsGyueVLvQ' }] }
          : {}),
      }
    : null;
}

/** A solid violet PNG, small but real, so images load without console errors. */
export function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 3, Buffer.from([75, 35, 200])),
  ]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A small image for any artwork the journeys serve. */
export const IMAGE = png(16, 9);

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

export interface MockOptions {
  /** Shows the first-run screen. Otherwise the journeys start on Home, as on any later launch. */
  firstRun?: boolean;
  /**
   * Answers for particular catalog paths, e.g. `series/top`. Returning
   * undefined instead of a promise falls through to the usual list.
   */
  catalogs?: Record<string, (route: Route) => Promise<void> | undefined>;
  /** Episodes, by video id, that the series lists as not out yet. */
  upcoming?: readonly string[];
  /** The series' running time, as its page gives it ("45 min"). It gives none otherwise. */
  seriesRuntime?: string;
}

/** The pairing relay, played by the test: it plays the phone too. */
export interface PhoneRelay {
  /** Codes the TV has been given, in order. */
  codes: string[];
  /** Sends an address to the TV's latest code, as the phone page would. */
  send(url: string): void;
  /** The latest code runs out. */
  expire(): void;
}

/** Every catalog request the page made, as `type/id` or `type/id/extra`. */
export interface AddonRequests {
  catalogs: string[];
  phone: PhoneRelay;
}

function fakeRelay(): { relay: PhoneRelay; answer: (route: Route) => Promise<void> } {
  let pending: string | undefined;
  let expired = false;
  const relay: PhoneRelay = {
    codes: [],
    send: (url) => void (pending = url),
    expire: () => void (expired = true),
  };
  const answer = (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/sessions') {
      const code = `K7P${relay.codes.length + 2}QZ`.slice(0, 6);
      relay.codes.push(code);
      expired = false;
      return json(
        route,
        { code, secret: 'test-secret', expiresIn: 600, pageUrl: `${PAIR_SERVICE}/#code=${code}` },
        201,
      );
    }
    const latest = relay.codes[relay.codes.length - 1];
    if (path !== `/api/sessions/${latest}/collect` || expired) {
      return json(route, { error: 'expired' }, 404);
    }
    if (pending === undefined) return json(route, { status: 'waiting', expiresIn: 500 });
    const url = pending;
    pending = undefined;
    expired = true;
    return json(route, { status: 'sent', url });
  };
  return { relay, answer };
}

export async function mockAddons(page: Page, options: MockOptions = {}): Promise<AddonRequests> {
  const { relay, answer } = fakeRelay();
  const requests: AddonRequests = { catalogs: [], phone: relay };

  if (!options.firstRun) {
    await page.addInitScript(() => localStorage.setItem('bannertv.welcomed', '1'));
    // Stored once per test, and only if nothing else (seedStreamAddon) stored a list first.
    await page.addInitScript((stored) => {
      if (sessionStorage.getItem('bannertv.test.addons')) return;
      sessionStorage.setItem('bannertv.test.addons', '1');
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
        // add() rather than get() then put(): it never reads, so a journey holding the
        // app's read of 'addons' cannot hold this write too.
        const added = tx.objectStore('kv').add(stored, 'addons');
        added.onerror = (event) => event.preventDefault(); // a list is already stored
        tx.oncomplete = () => db.close();
      };
    }, EARLIER_ADDONS);
  }

  // Anything not mocked below fails, so a stray request shows up as an error.
  await page.route(/^https?:\/\//, (route) => route.abort());
  if (PAIR_SERVICE) await page.route(`${PAIR_SERVICE}/api/**`, answer);
  // BannerTV's service without Trakt or TMDB set up; mockServices turns them on.
  if (API_SERVICE) {
    await page.route(`${API_SERVICE}/status`, (route) =>
      json(route, { trakt: false, tmdb: false }),
    );
  }
  // IntroDB has no intro or recap timings for any title unless mockPlayback gives some.
  await page.route(/^https:\/\/api\.introdb\.app\//, (route) =>
    json(route, { intro: null, recap: null, outro: null }),
  );
  // The BannerTV account's service not set up yet: its address answers, but not as the
  // service, so Settings leaves the account out. mockSync puts the service there.
  if (SYNC_SERVICE) {
    await page.route(`${SYNC_SERVICE}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'access-control-allow-origin': '*' },
        body: '<!doctype html><title>Nothing here yet</title>',
      }),
    );
  }
  await page.route(/^https:\/\/(images|episodes)\.metahub\.space\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: IMAGE,
    }),
  );
  await page.route('https://opensubtitles-v3.strem.io/manifest.json', (route) =>
    json(route, JSON.parse(SUBTITLES_MANIFEST)),
  );
  await page.route(/^https:\/\/demo\.bannertv\.workers\.dev\//, async (route) => {
    const url = route.request().url();
    if (new URL(url).pathname.startsWith('/art/')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: IMAGE,
      });
    }
    const response = await demoWorker.fetch(new Request(url));
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.route(/^https:\/\/addon\.example\.com\/bannertv\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/bannertv/manifest.json' || path === new URL(LONG_ADDON_URL).pathname) {
      return json(route, EXTRA_ADDON);
    }
    if (path === '/bannertv/lang=en/manifest.json') {
      return json(route, { ...EXTRA_ADDON, version: '1.3.0' });
    }
    if (path === '/bannertv/plain/manifest.json') {
      return json(route, { ...EXTRA_ADDON, version: '1.4.0', behaviorHints: {} });
    }
    if (/^\/bannertv\/(lang=en\/)?catalog\/movie\/trending\.json$/.test(path)) {
      return json(route, { metas: MOVIES.slice(0, 3).map((entry) => preview('movie', entry)) });
    }
    return json(route, { error: 'not found' }, 404);
  });
  await page.route(/^https:\/\/v3-cinemeta\.strem\.io\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/manifest.json') return json(route, JSON.parse(CINEMETA_MANIFEST));

    const catalog = /^\/catalog\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(path);
    if (catalog) {
      const [, type, id, extra] = catalog as unknown as [string, string, string, string?];
      const key = extra ? `${type}/${id}/${decodeURIComponent(extra)}` : `${type}/${id}`;
      requests.catalogs.push(key);
      const answered = options.catalogs?.[key]?.(route);
      if (answered) return answered;
      const list = type === 'series' ? SERIES : MOVIES;
      const args = new URLSearchParams(extra ? decodeURIComponent(extra) : '');
      const search = args.get('search');
      if (search) {
        const found = list.filter(([, name]) => name.toLowerCase().includes(search.toLowerCase()));
        return json(route, { metas: found.map((entry) => preview(type, entry)) });
      }
      const skip = Number(args.get('skip') ?? 0);
      if (skip > 0) {
        // Later pages are made up, so Discover has something to page through.
        const metas = [];
        for (let n = skip; n < Math.min(skip + list.length, PAGED_TOTAL); n++) {
          metas.push(
            preview(type, [`tt77${String(n).padStart(5, '0')}`, `${type} ${n + 1}`, '2024']),
          );
        }
        return json(route, { metas });
      }
      // Genre rows and Featured get the same titles in a different order.
      const ordered = extra || id !== 'top' ? [...list].reverse() : list;
      return json(route, { metas: ordered.map((entry) => preview(type, entry)) });
    }

    const meta = /^\/meta\/(movie|series)\/([^/]+)\.json$/.exec(path);
    if (meta) {
      const id = decodeURIComponent(meta[2]!);
      return json(route, {
        meta:
          meta[1] === 'series'
            ? seriesMeta(id, options.upcoming, options.seriesRuntime)
            : movieMeta(id),
      });
    }
    return json(route, { error: 'not found' }, 404);
  });
  return requests;
}
