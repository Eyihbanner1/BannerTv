import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page, Route } from '@playwright/test';

/**
 * A fake Cinemeta and OpenSubtitles for the journeys, so they never touch the
 * network. Catalogs are built from the Blender open movies; one series has
 * two seasons. Every image host gets a small PNG.
 */

const CORE = resolve(import.meta.dirname, '../../../packages/core/src/addons');
const CINEMETA_MANIFEST = readFileSync(resolve(CORE, 'cinemeta.manifest.json'), 'utf8');
const SUBTITLES_MANIFEST = readFileSync(resolve(CORE, 'opensubtitles-v3.manifest.json'), 'utf8');

export const FIRST_ROW = 'home-0-movie-top';
export const SERIES_ROW = 'home-0-series-top';

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

function seriesMeta(id: string) {
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
        released: `202${season}-0${episode > 9 ? 9 : episode}-01T00:00:00.000Z`,
        thumbnail: `https://episodes.metahub.space/${id}/${season}/${episode}/w780.jpg`,
        overview: `What happens in season ${season}, episode ${episode}.`,
      });
    }
  }
  return {
    ...preview('series', entry),
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
      }
    : null;
}

/** A solid violet PNG, small but real, so images load without console errors. */
function png(width: number, height: number): Buffer {
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

const IMAGE = png(16, 9);

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

export interface MockOptions {
  /**
   * Answers for particular catalog paths, e.g. `series/top`. Returning
   * undefined instead of a promise falls through to the usual list.
   */
  catalogs?: Record<string, (route: Route) => Promise<void> | undefined>;
}

/** Every catalog request the page made, as `type/id` or `type/id/extra`. */
export interface AddonRequests {
  catalogs: string[];
}

export async function mockAddons(page: Page, options: MockOptions = {}): Promise<AddonRequests> {
  const requests: AddonRequests = { catalogs: [] };

  // Anything not mocked below fails, so a stray request shows up as an error.
  await page.route(/^https?:\/\//, (route) => route.abort());
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
      // Genre rows and Featured get the same titles in a different order.
      const ordered = extra || id !== 'top' ? [...list].reverse() : list;
      return json(route, { metas: ordered.map((entry) => preview(type, entry)) });
    }

    const meta = /^\/meta\/(movie|series)\/([^/]+)\.json$/.exec(path);
    if (meta) {
      const id = decodeURIComponent(meta[2]!);
      return json(route, { meta: meta[1] === 'series' ? seriesMeta(id) : movieMeta(id) });
    }
    return json(route, { error: 'not found' }, 404);
  });
  return requests;
}
