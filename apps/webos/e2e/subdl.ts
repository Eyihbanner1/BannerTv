import { crc32, deflateRawSync } from 'node:zlib';
import type { Page, Route } from '@playwright/test';
import { speech, srt } from './play';

/**
 * A stand-in for SubDL's API and download host. Every answer is made up, shaped like the real
 * API's: "Test Film" and "Test Show", their releases and file ids invented, and the files test
 * lines only. The key is obviously fake, and no real key is ever used.
 */

export const FAKE_SUBDL_KEY = 'FAKE-SUBDL-KEY-0000';

/** The release the film's stream is named for, and the file SubDL has for it. */
export const SUBDL_FILM_RELEASE = 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA';
/** The release of the show's season 2 pack, and the episode's stream. */
export const SUBDL_SHOW_RELEASE = 'Test.Show.S02.1080p.WEB-DL-GRPA';
export const SUBDL_EPISODE_RELEASE = 'Test.Show.S02E03.1080p.WEB-DL-GRPA';

export type SubdlScenario =
  'films' | 'pack' | 'zip-film' | 'never' | 'busy' | 'refused' | 'challenge';

export interface SubdlStandIn {
  /** Every search, as its path and query. */
  searches: string[];
  /** Every file asked for from the download host, as its path. */
  downloads: string[];
  /** Key checks (/api/v2/me). */
  meChecks: number;
  /** Whether any request's address held the key. */
  keyInUrl: boolean;
  /** Paths the stand-in does not serve, answered 418. */
  strays: string[];
}

const API = /^https:\/\/api\.subdl\.com\//;
const DOWNLOADS = /^https:\/\/dl\.subdl\.com\//;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'X-API-Key',
  'access-control-allow-methods': 'GET',
};

/** The film's lines on the 40-second video: the first from 0.5 s, so it shows as play starts. */
export const SUBDL_FILM_TEXT = srt([
  [0.5, 20, 'SubDL film, line 1'],
  ...speech(21, 38).map(([start, end], i) => [start, end, `SubDL film, line ${i + 2}`] as const),
]);

/** The ZIP film's lines, the same way. */
export const SUBDL_ZIP_TEXT = srt([
  [0.5, 20, 'From the ZIP, line 1'],
  ...speech(21, 38).map(([start, end], i) => [start, end, `From the ZIP, line ${i + 2}`] as const),
]);

/** Episode n of the show's season 2 pack. */
export const subdlEpisodeText = (episode: number) =>
  srt([
    [0.5, 20, `SubDL episode ${episode}, line 1`],
    ...speech(21, 38).map(
      ([start, end], i) => [start, end, `SubDL episode ${episode}, line ${i + 2}`] as const,
    ),
  ]);

/** A ZIP archive of these files, deflated, as SubDL sends a release's subtitles. */
export function zipOf(files: ReadonlyArray<{ name: string; text: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.text, 'utf8');
    const packed = deflateRawSync(data);
    const check = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(check, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(check, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

type Row = Record<string, unknown>;

const filmRow = (overrides: Row): Row => ({
  release_name: SUBDL_FILM_RELEASE,
  name: `SUBDL.com::${SUBDL_FILM_RELEASE}.zip`,
  lang: 'english',
  author: 'test-author',
  season: 0,
  episode: null,
  language: 'EN',
  hi: false,
  episode_from: null,
  episode_end: 0,
  full_season: false,
  releases: [SUBDL_FILM_RELEASE],
  comment: 'Made-up row for the journeys',
  fps: '23.976',
  ai_translated: false,
  ...overrides,
});

const film = (rows: Row[]) => ({
  status: true,
  results: [{ sd_id: 9000001, type: 'movie', name: 'Test Film', imdb_id: 'tt9900001', year: 2026 }],
  subtitles: rows,
  totalPages: 1,
  currentPage: 1,
});

/** Season 2 of "Test Show": a pack with episodes 1 to 5, and a file named E04 SubDL says is E03. */
const PACK_FILES = [
  ...[1, 2, 3, 4, 5].map((episode) => ({
    name: `Test.Show.S02E0${episode}.1080p.WEB-DL-GRPA.srt`,
    url: `/subtitle/9000002/${9200010 + episode}`,
    file_n_id: 9200010 + episode,
    episode,
  })),
  {
    name: 'Test.Show.S02E04.1080p.WEB-DL-GRPA.Fixed.srt',
    url: '/subtitle/9000002/9200024',
    file_n_id: 9200024,
    episode: 3,
  },
];

const show = {
  status: true,
  results: [{ sd_id: 9000002, type: 'tv', name: 'Test Show', imdb_id: 'tt9900002', year: 2025 }],
  subtitles: [
    {
      release_name: SUBDL_SHOW_RELEASE,
      name: `SUBDL.com::${SUBDL_SHOW_RELEASE}.zip`,
      lang: 'english',
      url: '/subtitle/9000002-9100002.zip',
      season: 2,
      episode: null,
      language: 'EN',
      episode_from: 0,
      episode_end: 0,
      full_season: true,
      releases: [SUBDL_SHOW_RELEASE],
      unpack_files: PACK_FILES,
    },
  ],
};

/** What each scenario's search answers, as status and body. */
function searchAnswer(scenario: SubdlScenario): { status: number; body: unknown } {
  switch (scenario) {
    case 'films':
      return {
        status: 200,
        body: film([
          filmRow({
            url: '/subtitle/9000001-9100001.zip',
            unpack_files: [
              {
                name: `${SUBDL_FILM_RELEASE}.srt`,
                url: '/subtitle/9000001/9200001',
                file_n_id: 9200001,
              },
            ],
          }),
        ]),
      };
    case 'zip-film':
      return { status: 200, body: film([filmRow({ url: '/subtitle/9000003-9100003.zip' })]) };
    case 'pack':
      return { status: 200, body: show };
    case 'busy':
      return { status: 429, body: { error: { code: 'rate_limit' } } };
    case 'refused':
      return { status: 403, body: { status: false, error: 'not_authorized' } };
    default:
      return { status: 500, body: { status: false } };
  }
}

/** The files on the download host, by path. */
function download(path: string): { contentType: string; body: Buffer } | undefined {
  if (path === '/subtitle/9000001/9200001') {
    return { contentType: 'application/x-subrip', body: Buffer.from(SUBDL_FILM_TEXT, 'utf8') };
  }
  if (path === '/subtitle/9000003-9100003.zip') {
    return {
      contentType: 'application/zip',
      body: zipOf([
        { name: 'Read me.txt', text: 'Made-up archive for the journeys.' },
        { name: `${SUBDL_FILM_RELEASE}.srt`, text: SUBDL_ZIP_TEXT },
      ]),
    };
  }
  const pack = /^\/subtitle\/9000002\/(92000\d\d)$/.exec(path);
  if (pack) {
    const file = PACK_FILES.find((entry) => entry.url === path);
    if (!file) return undefined;
    const episode = Number(/S02E0(\d)/.exec(file.name)![1]);
    return {
      contentType: 'application/x-subrip',
      body: Buffer.from(subdlEpisodeText(episode), 'utf8'),
    };
  }
  return undefined;
}

const fulfil = (route: Route, status: number, body: unknown, contentType = 'application/json') =>
  route.fulfill({
    status,
    contentType,
    headers: CORS,
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });

/** Routes SubDL's API and download host to the stand-in. Call after mockAddons. */
export async function standInSubdl(page: Page, scenario: SubdlScenario): Promise<SubdlStandIn> {
  const seen: SubdlStandIn = {
    searches: [],
    downloads: [],
    meChecks: 0,
    keyInUrl: false,
    strays: [],
  };
  await page.route(API, async (route) => {
    const request = route.request();
    if (request.url().includes(FAKE_SUBDL_KEY)) seen.keyInUrl = true;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    const url = new URL(request.url());
    const key = request.headers()['x-api-key'];
    const isMe = url.pathname === '/api/v2/me';
    const isSearch = url.pathname === '/api/v2/subtitles/search';
    if (!isMe && !isSearch) {
      seen.strays.push(url.pathname);
      return fulfil(route, 418, { status: false });
    }
    if (isMe) seen.meChecks++;
    else seen.searches.push(url.pathname + url.search);
    // 'never': no answer at all, as when SubDL is down without saying so.
    if (scenario === 'never') return;
    if (!key) return fulfil(route, 401, { status: false, error: 'missing api key' });
    if (scenario === 'refused')
      return fulfil(route, 403, { status: false, error: 'not_authorized' });
    if (scenario === 'challenge') {
      return fulfil(route, 403, '<html><body>Checking your browser</body></html>', 'text/html');
    }
    if (isMe) return fulfil(route, 200, { status: true, user: { name: 'test-viewer' } });
    const { status, body } = searchAnswer(scenario);
    return fulfil(route, status, body);
  });
  await page.route(DOWNLOADS, async (route) => {
    const request = route.request();
    if (request.url().includes(FAKE_SUBDL_KEY)) seen.keyInUrl = true;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname;
    const file = download(path);
    if (!file) {
      seen.strays.push(path);
      return fulfil(route, 418, 'not served');
    }
    seen.downloads.push(path);
    return route.fulfill({
      status: 200,
      contentType: file.contentType,
      headers: CORS,
      body: file.body,
    });
  });
  return seen;
}
