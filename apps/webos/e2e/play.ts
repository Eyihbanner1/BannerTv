import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';

/**
 * A fake stream addon, subtitle files and media for the playback journeys.
 * Every media link serves the same 40 s of blank VP8, which the test
 * Chromium plays (it has no H.264), unless a test makes it fail.
 */

// 40 s of blank VP8 (a WebM) with byte-range support.
const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/blank-40s.webm'));

/**
 * 10 s of HLS at MEDIA_HOST/hls/master.m3u8: VP9 and Opus in fMP4, audio in
 * English and French, and English WebVTT subtitles, so BannerTV hands it to
 * hls.js. Made with ffmpeg; see fixtures/hls/README.md.
 */
export const HLS_PATH = '/hls/master.m3u8';
const HLS_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  mp4: 'video/mp4',
  m4s: 'video/mp4',
  vtt: 'text/vtt',
};

export const STREAM_ADDON_URL = 'https://streams.example.com/bannertv/manifest.json';
/**
 * A second stream addon, which answers only after SLOW_ADDON_MS with a torrent
 * and a 1080p link that ranks above DEFAULT_STREAMS' 1080p (a cached REMUX).
 */
export const SLOW_ADDON_URL = 'https://slow.example.com/bannertv/manifest.json';
export const SLOW_ADDON_MS = 3000;
export const MEDIA_HOST = 'https://media.example.com';
export const SUBTITLE_HOST = 'https://subs.example.com';

const STREAM_MANIFEST = {
  id: 'org.bannertv.test-streams',
  version: '1.0.0',
  name: 'Test Streams',
  description: 'Streams for the playback journeys.',
  types: ['movie', 'series'],
  resources: ['stream'],
  idPrefixes: ['tt'],
  catalogs: [],
};

const SLOW_MANIFEST = {
  ...STREAM_MANIFEST,
  id: 'org.bannertv.slow-streams',
  name: 'Slow Streams',
  description: 'A stream addon that answers late.',
};

export interface TestStream {
  name: string;
  description: string;
  /** A path on MEDIA_HOST, or a full URL. */
  path?: string;
  infoHash?: string;
  bingeGroup?: string;
  /** Subtitles that come with the stream, as paths on SUBTITLE_HOST. */
  subtitles?: ReadonlyArray<{ id: string; path: string; lang: string }>;
}

/** What the addon answers for every video, unless a test passes its own list. */
export const DEFAULT_STREAMS: readonly TestStream[] = [
  {
    name: 'Test Streams\n1080p',
    description: 'Open Movie 1080p WEB-DL x264\n💾 1.4 GB ⚡ Cached',
    path: '/movie-1080p.webm',
    bingeGroup: 'test-1080p',
  },
  {
    name: 'Test Streams\n720p',
    description: 'Open Movie 720p WEBRip\n💾 700 MB',
    path: '/movie-720p.webm',
    bingeGroup: 'test-720p',
  },
  {
    name: 'Test Streams\nP2P',
    description: 'Open Movie 2160p REMUX\n👤 52',
    infoHash: '0123456789abcdef0123456789abcdef01234567',
  },
];

/** SRT text served at SUBTITLE_HOST/<id>.srt. */
export const SUBTITLE_FILES: Record<string, string> = {
  en1: '1\n00:00:00,500 --> 00:00:20,000\nHello from the <i>test</i> subtitles\n\n2\n00:00:20,000 --> 00:00:40,000\nStill here\n',
  en2: '1\n00:00:00,500 --> 00:00:40,000\nThe second English file\n',
  fr1: '1\n00:00:00,500 --> 00:00:40,000\nBonjour\n',
};

export interface PlaybackMock {
  /** Every media URL requested, as a path, in order. */
  media: string[];
  /** Every stream request, as type/videoId. */
  streams: string[];
  /** Every subtitles request, as the path after /subtitles/. */
  subtitles: string[];
  /** Stream answers the slow addon has sent. */
  slowAnswers: number;
}

export interface PlaybackOptions {
  /** The streams per video id; videos not listed get DEFAULT_STREAMS. */
  streams?: Record<string, readonly TestStream[]>;
  /** Media paths that answer 404, for failover. */
  broken?: readonly string[];
  /**
   * Media paths that answer 503 to some kinds of request, by Playwright's
   * resource type: 'fetch' is the player's look at an HLS playlist, 'media'
   * the TV's own player (and the link test), 'xhr' hls.js.
   */
  refused?: Readonly<Record<string, readonly string[]>>;
  /** How long media takes to answer. Default at once. */
  mediaDelayMs?: number;
  /** Whether OpenSubtitles answers with SUBTITLE_FILES. Default true. */
  subtitles?: boolean;
  /** OpenSubtitles answers once this settles, so a test decides when. Default at once. */
  subtitlesGate?: Promise<unknown>;
}

/** Serves the fixture with byte ranges, which the media element needs to seek. */
export function serveFixture(route: Route) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : FIXTURE.length - 1;
  return route.fulfill({
    status: range ? 206 : 200,
    contentType: 'video/webm',
    headers: {
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
      ...(range && { 'content-range': `bytes ${start}-${end}/${FIXTURE.length}` }),
    },
    body: FIXTURE.subarray(start, end + 1),
  });
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

/** A saved watch position, as the app keeps them. */
export interface SeedProgress {
  metaId: string;
  type: 'movie' | 'series';
  videoId: string;
  position: number;
  duration: number;
  watched?: boolean;
}

/** What Continue Watching shows of a video that played, as the player saves it. */
export interface SeedPlayed {
  videoId: string;
  metaId: string;
  type: 'movie' | 'series';
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  releaseInfo?: string;
  season?: number;
  episode?: number;
  next?: { videoId: string; season?: number; episode?: number; released?: number };
}

/**
 * Installs the test stream addon before the app starts, by writing the addon
 * collection (and any watch progress and Continue Watching cards) into
 * IndexedDB the way the app stores it. Call before page.goto, after mockAddons.
 */
export async function seedStreamAddon(
  page: Page,
  options: {
    progress?: readonly SeedProgress[];
    /** Continue Watching cards, as if those videos had played. */
    played?: readonly SeedPlayed[];
    /** Also installs the slow stream addon. */
    slowAddon?: boolean;
    /** Stored preferences, as if chosen before. */
    preferences?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const cinemeta = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../packages/core/src/addons/cinemeta.manifest.json'),
      'utf8',
    ),
  ) as unknown;
  const subtitles = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../../packages/core/src/addons/opensubtitles-v3.manifest.json',
      ),
      'utf8',
    ),
  ) as unknown;
  const addons = [
    {
      transportUrl: 'https://v3-cinemeta.strem.io/manifest.json',
      manifest: cinemeta,
      official: true,
      fetchedAt: 0,
    },
    { transportUrl: STREAM_ADDON_URL, manifest: STREAM_MANIFEST, official: false, fetchedAt: 0 },
    ...(options.slowAddon
      ? [{ transportUrl: SLOW_ADDON_URL, manifest: SLOW_MANIFEST, official: false, fetchedAt: 0 }]
      : []),
    {
      transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
      manifest: subtitles,
      official: true,
      fetchedAt: 0,
    },
  ];
  const progress = (options.progress ?? []).map((entry, i) => ({
    watched: false,
    ...entry,
    updatedAt: 1000 + i,
  }));
  const cards = (options.played ?? []).map((card, i) => ({ ...card, updatedAt: 1000 + i }));
  await page.addInitScript(
    ({ stored, saved, played, chosen }) => {
      if (sessionStorage.getItem('bannertv.test.seeded')) return;
      sessionStorage.setItem('bannertv.test.seeded', '1');
      if (chosen) localStorage.setItem('bannertv.preferences', JSON.stringify(chosen));
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
        if (saved.length > 0) tx.objectStore('kv').put(saved, 'progress');
        if (played.length > 0) tx.objectStore('kv').put(played, 'played');
        tx.oncomplete = () => db.close();
      };
    },
    { stored: addons, saved: progress, played: cards, chosen: options.preferences ?? null },
  );
}

/** Routes the stream addon, OpenSubtitles' subtitle answers and all media. Call after mockAddons. */
export async function mockPlayback(
  page: Page,
  options: PlaybackOptions = {},
): Promise<PlaybackMock> {
  const mock: PlaybackMock = { media: [], streams: [], subtitles: [], slowAnswers: 0 };
  const broken = new Set(options.broken ?? []);

  await page.route(/^https:\/\/streams\.example\.com\/bannertv\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/bannertv/manifest.json') return json(route, STREAM_MANIFEST);
    const match = /^\/bannertv\/stream\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) return json(route, { error: 'not found' }, 404);
    const type = match[1]!;
    const videoId = decodeURIComponent(match[2]!);
    mock.streams.push(`${type}/${videoId}`);
    const list = options.streams?.[videoId] ?? DEFAULT_STREAMS;
    return json(route, {
      streams: list.map((stream) => ({
        name: stream.name,
        description: stream.description,
        ...(stream.path && {
          url: stream.path.startsWith('http') ? stream.path : `${MEDIA_HOST}${stream.path}`,
        }),
        ...(stream.infoHash && { infoHash: stream.infoHash }),
        behaviorHints: {
          ...(stream.bingeGroup && { bingeGroup: stream.bingeGroup }),
          filename: `${(stream.path ?? 'torrent').replace(/^.*\//, '')}`,
        },
        ...(stream.subtitles && {
          subtitles: stream.subtitles.map(({ id, path, lang }) => ({
            id,
            url: `${SUBTITLE_HOST}${path}`,
            lang,
          })),
        }),
      })),
    });
  });

  await page.route(/^https:\/\/slow\.example\.com\/bannertv\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/bannertv/manifest.json') return json(route, SLOW_MANIFEST);
    await new Promise((resolve) => setTimeout(resolve, SLOW_ADDON_MS));
    mock.slowAnswers++;
    return json(route, {
      streams: [
        {
          name: 'Slow Streams\nP2P',
          description: 'Open Movie 1080p BluRay',
          infoHash: 'fedcba9876543210fedcba9876543210fedcba98',
        },
        {
          name: 'Slow Streams\n1080p',
          description: 'Open Movie 1080p BluRay REMUX\n💾 18 GB ⚡ Cached',
          url: `${MEDIA_HOST}/movie-1080p-remux.webm`,
          behaviorHints: { filename: 'movie-1080p-remux.webm' },
        },
      ],
    });
  });

  await page.route(/^https:\/\/media\.example\.com\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    mock.media.push(path);
    if (options.mediaDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.mediaDelayMs));
    }
    if (broken.has(path)) return route.fulfill({ status: 404, body: '' });
    if (options.refused?.[path]?.includes(route.request().resourceType())) {
      return route.fulfill({ status: 503, body: '' });
    }
    if (path.startsWith('/hls/')) {
      const file = path.slice('/hls/'.length);
      if (!/^[\w-]+\.(m3u8|mp4|m4s|vtt)$/.test(file)) return route.fulfill({ status: 404 });
      return route.fulfill({
        status: 200,
        contentType: HLS_TYPES[file.replace(/^.*\./, '')],
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(resolve(import.meta.dirname, 'fixtures/hls', file)),
      });
    }
    return serveFixture(route);
  });

  await page.route(/^https:\/\/opensubtitles-v3\.strem\.io\/subtitles\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/subtitles/', '');
    mock.subtitles.push(decodeURIComponent(path));
    if (options.subtitlesGate) await options.subtitlesGate;
    if (options.subtitles === false) return json(route, { subtitles: [] });
    return json(route, {
      subtitles: [
        { id: 'en1', url: `${SUBTITLE_HOST}/en1.srt`, lang: 'eng' },
        { id: 'fr1', url: `${SUBTITLE_HOST}/fr1.srt`, lang: 'fre' },
        { id: 'en2', url: `${SUBTITLE_HOST}/en2.srt`, lang: 'eng' },
      ],
    });
  });

  await page.route(/^https:\/\/subs\.example\.com\//, (route) => {
    const id = new URL(route.request().url()).pathname.replace(/^\/|\.srt$/g, '');
    const text = SUBTITLE_FILES[id];
    if (text === undefined) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      status: 200,
      contentType: 'application/x-subrip',
      headers: { 'access-control-allow-origin': '*' },
      body: text,
    });
  });
  return mock;
}
