import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { API_SERVICE } from '../src/data/api-service';
import { addStorageInitScript } from './tv';

/**
 * A fake stream addon, subtitle files and media for the playback journeys.
 * Every media link serves the same 40 s of blank VP8, which the test
 * Chromium plays (it has no H.264), unless a test makes it fail.
 */

/** IntroDB's timings as BannerTV's service passes them on, the way the TV asks for them. */
const INTRODB_THROUGH_SERVICE = new RegExp(
  `^${API_SERVICE.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}/introdb/segments\\?`,
);

// 40 s of blank VP8 (a WebM) with byte-range support.
const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/blank-40s.webm'));
// The same, 10 minutes long, at any media path starting /long-: long enough
// that the player takes it for a title with a page saying it runs for hours.
const LONG_FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/blank-10min.webm'));

/**
 * The size of the 10-minute video at any media path starting /film-: padded to it with an EBML
 * Void element after its segment, which players skip, so its OpenSubtitles hash can be read from
 * two 64 KB ends. The fixtures alone are too small for that, so their hash read fails, as it
 * does for any file under 128 KB.
 */
export const FILM_SIZE = 256 * 1024;
const FILM_FIXTURE = (() => {
  const head = Buffer.from([0xec, 0x01, 0, 0, 0, 0, 0, 0, 0]);
  const rest = FILM_SIZE - LONG_FIXTURE.length - head.length;
  head.writeUIntBE(rest, 3, 6);
  return Buffer.concat([LONG_FIXTURE, head, Buffer.alloc(rest)]);
})();

/**
 * 10 s of HLS at MEDIA_HOST/hls/master.m3u8: VP9 and Opus in fMP4, audio in
 * English and French, and English WebVTT subtitles, so BannerTV hands it to
 * hls.js. Made with ffmpeg; see fixtures/hls/README.md.
 */
export const HLS_PATH = '/hls/master.m3u8';
/** The same HLS as a live broadcast: its playlists have no end, so players treat it as live. */
export const LIVE_HLS_PATH = '/hls-live/master.m3u8';
/**
 * The same HLS with English marked 5.1 and a second English track named
 * "English Commentary", listed first, so the Commentary rule shows.
 */
export const COMMENTARY_HLS_PATH = '/hls-commentary/master.m3u8';
/**
 * Ten minutes of HLS at MEDIA_HOST/hls-long/master.m3u8: VP9 with no audio, and a French
 * WebVTT rendition, HLS_LONG_FRENCH, in one segment, so hls.js reads it whole at the start.
 * See fixtures/hls-long/README.md.
 */
export const HLS_LONG_PATH = '/hls-long/master.m3u8';
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
  /** Request headers the addon asks for (behaviorHints.proxyHeaders.request). */
  requestHeaders?: Record<string, string>;
  /** Subtitles that come with the stream, as paths on SUBTITLE_HOST, with a release name if given. */
  subtitles?: ReadonlyArray<{ id: string; path: string; lang: string; label?: string }>;
  /** The file name the addon gives (behaviorHints.filename). Default the path's last part. */
  filename?: string;
}

/**
 * A file in OpenSubtitles' answer: SUBTITLE_HOST/<id>.srt, and its names if
 * given: a label as other addons send, or the file and release names
 * OpenSubtitles v3 sends, and whether it found the file by the video's hash.
 */
export interface TestSubtitle {
  id: string;
  lang: string;
  label?: string;
  subtitleFileName?: string;
  movieReleaseName?: string;
  /** 'h': found by the video's hash; 'i': by the video's id. */
  m?: 'h' | 'i';
  /** Sent with no id, so its link stands in for one. */
  withoutId?: boolean;
}

/** What OpenSubtitles answers unless a test passes its own list: no names. */
export const DEFAULT_SUBTITLES: readonly TestSubtitle[] = [
  { id: 'en1', lang: 'eng' },
  { id: 'fr1', lang: 'fre' },
  { id: 'en2', lang: 'eng' },
];

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

/** Seconds as an SRT time: 00:01:02,500. */
function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  return `${two(hours)}:${two(minutes)}:${two(secs)},${String(ms % 1000).padStart(3, '0')}`;
}

/** SRT text of these lines: start and end in seconds, then the text. */
export function srt(lines: ReadonlyArray<readonly [number, number, string]>): string {
  return lines
    .map(([start, end, text], i) => `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`)
    .join('\n');
}

/**
 * A line every `every` seconds from `from` seconds until `until`, numbered after `name`; with
 * `sounds`, every so many lines is a sound in brackets instead, as for the hard of hearing.
 */
function dialogue(
  name: string,
  from: number,
  until: number,
  every = 10,
  sounds = 0,
): Array<[number, number, string]> {
  const lines: Array<[number, number, string]> = [];
  for (let at = from, n = 1; at < until; at += every, n++)
    lines.push([at, at + 4, sounds && n % sounds === 0 ? '[door creaks]' : `${name}, line ${n}`]);
  return lines;
}

/**
 * English files for the 10-minute video (any /long- path), as an addon might
 * send them, best last: a few signs only; one for the hard of hearing; one
 * timed for film speed on this faster video, whose lines run on past the
 * video's end; and the full one, with the advert OpenSubtitles adds at its
 * start and end. Then a copy of the full one, as good as it.
 */
export const LONG_SUBTITLES = {
  signs: srt([
    [1, 4, 'A SIGN ON THE DOOR'],
    [240, 243, 'A SIGN ON THE ROAD'],
    [560, 563, 'A SIGN AT THE END'],
  ]),
  sdh: srt(dialogue('For the hard of hearing', 3, 588, 2, 5)),
  // Its last lines end up to 15 s past the video's end, line after line, and about 4% after the
  // other two that fit, which agree on their end: timed for film speed on a 25 fps video, so its
  // drift is fixed. On its own, so little past the end could be another release's ending.
  past: srt(dialogue('Running past the end', 1, 612, 2)),
  full: srt([
    [0.2, 2.5, 'Advertise your product or brand here\ncontact www.OpenSubtitles.org today'],
    ...dialogue('The full file', 3, 588, 2),
    [592, 596, 'Support us and become VIP member\nto remove all ads from www.OpenSubtitles.org'],
  ]),
  // Another full file, from another uploader: it fits as well as the full one, no better.
  copy: srt(dialogue('Another full file', 3, 588, 2)),
};

/** Seconds rounded to milliseconds, as subtitle files keep them. */
const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * When a made-up film's lines start and end, from `from` seconds until `until`: one every 2 to
 * 6 s, lasting 1 to 3 s, as unevenly as people talk, and the same on every run. Even lines
 * would line up as well a line or two either way, as no film's do.
 */
export function speech(from: number, until: number): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  for (let at = from, n = 1; at < until; n++) {
    const random = (salt: number) => {
      const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const length = 1 + 2 * random(1);
    lines.push([ms(at), ms(at + length)]);
    at += length + 0.3 + 3 * random(2);
  }
  return lines;
}

/** The made-up film's lines for the 10-minute video, from 6 s. */
const LONG_SPEECH = speech(6, 588);

/**
 * Files for lining up on the 10-minute video (any /long- path): one for the hard of hearing,
 * with a sound in brackets every fifth line, as OpenSubtitles finds by the video's hash; and a
 * plain one with the same speech, 3 s late, as from another release.
 */
export const ALIGN_SUBTITLES = {
  linkedHearing: srt(
    LONG_SPEECH.map(([start, end], i) => [
      start,
      end,
      (i + 1) % 5 === 0 ? '[door creaks]' : `Linked file, line ${i + 1}`,
    ]),
  ),
  plainLate: srt(
    LONG_SPEECH.filter((_, i) => (i + 1) % 5 !== 0).map(([start, end], i) => [
      ms(start + 3),
      ms(end + 3),
      `Plain file, line ${i + 1}`,
    ]),
  ),
};

/** The made-up film's lines on the long HLS, from 15 s: its French track has them on time. */
const HLS_LONG_SPEECH = speech(15, 588);

/** WebVTT time: 00:01:02.500. */
const vttTime = (seconds: number) => srtTime(seconds).replace(',', '.');

/** The long HLS's French track, served at MEDIA_HOST/hls-long/subs-fr.vtt. */
export const HLS_LONG_FRENCH = `WEBVTT\n\n${HLS_LONG_SPEECH.map(
  ([start, end], i) => `${vttTime(start)} --> ${vttTime(end)}\nLigne ${i + 1} en français\n`,
).join('\n')}`;

/** An English file for the long HLS, 5 s early: its lines come before the French track's. */
export const HLS_LONG_ENGLISH = srt(
  HLS_LONG_SPEECH.map(([start, end], i) => [ms(start - 5), ms(end - 5), `English line ${i + 1}`]),
);

/**
 * The made-up film's 120 lines for files that agree with each other, on the 10-minute video:
 * from 30 s, so a move made in the first seconds comes before the first line.
 */
export const AGREE_SPEECH = speech(30, 588).slice(0, 120);

/** The same 120 lines from 3 s, for a journey whose first line need not wait. */
export const APART_SPEECH = speech(3, 588).slice(0, 120);

/** A file of these lines `by` seconds late, each numbered after `name`. */
const timed = (lines: ReadonlyArray<readonly [number, number]>, by: number, name: string) =>
  srt(lines.map(([start, end], i) => [ms(start + by), ms(end + by), `${name} ${i + 1}`]));

/**
 * Files for the 10-minute video that agree with each other, or don't: test lines only. On
 * AGREE_SPEECH, four on time, one 8 s late and one 3 s late; on APART_SPEECH, three on time and
 * one 12 s late.
 */
export const AGREE_SUBTITLES = {
  agreeOnTimeA: timed(AGREE_SPEECH, 0, 'On time A, line'),
  agreeOnTimeB: timed(AGREE_SPEECH, 0, 'On time B, line'),
  agreeOnTimeC: timed(AGREE_SPEECH, 0, 'On time C, line'),
  agreeLate8: timed(AGREE_SPEECH, 8, 'Test line'),
  agreeLate3: timed(AGREE_SPEECH, 3, 'Picked line'),
  agreeNamed: timed(AGREE_SPEECH, 0, 'Named line'),
  apartOnTimeA: timed(APART_SPEECH, 0, 'In step A, line'),
  apartOnTimeB: timed(APART_SPEECH, 0, 'In step B, line'),
  apartOnTimeC: timed(APART_SPEECH, 0, 'In step C, line'),
  apartLate12: timed(APART_SPEECH, 12, 'Apart line'),
};

/** The made-up film's lines on the 10-minute video from 2 s, so the first shows soon after Play. */
export const EARLY_SPEECH = speech(2, 588);

/** The same film's lines from 20 s, so the first is due well after a hash read late. */
export const LATE_SPEECH = speech(20, 588);

/**
 * Files for a hash read after the subtitles were asked for, on the 10-minute video: test lines
 * only. On EARLY_SPEECH, one OpenSubtitles finds by the video's id and one it finds only by the
 * hash, both on time; on LATE_SPEECH, the same pair.
 */
export const HASH_SUBTITLES = {
  askedEarly: timed(EARLY_SPEECH, 0, 'Asked first, line'),
  linkedEarly: timed(EARLY_SPEECH, 0, 'Found by hash, line'),
  askedLate: timed(LATE_SPEECH, 0, 'Starts late, line'),
  linkedLate: timed(LATE_SPEECH, 0, 'Linked late, line'),
};

/** The file's seconds for one of the video's, for a file timed for a PAL release of a film. */
const AHEAD_RATE = 24000 / 1001 / 25;

/**
 * Files for Match a line, on the 10-minute video: test lines only, one file at a time so nothing
 * lines them up. On APART_SPEECH: 2 s late; and timed for a PAL release, each line at
 * (its time − 2) × 23.976 / 25, so the drift fix for lines getting ahead and +2 s put it right.
 */
export const MATCH_SUBTITLES = {
  matchLate: timed(APART_SPEECH, 2, 'Test line'),
  matchAhead: srt(
    APART_SPEECH.map(([start, end], i) => [
      ms((start - 2) * AHEAD_RATE),
      ms((end - 2) * AHEAD_RATE),
      `Test line ${i + 1}`,
    ]),
  ),
};

/**
 * The made-up film's lines muxed into the journeys' MKV files (fixtures/mkv/lines.json), each
 * a start and an end in seconds: 150 over the 10-minute video, from 3 s.
 */
export const MKV_LINES = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/mkv/lines.json'), 'utf8')) as {
    lines: Array<[number, number]>;
  }
).lines;

/**
 * Files for the MKV files' video: on MKV_LINES, one on time and one 3 s late, as from another
 * release. Test lines only.
 */
export const MKV_SUBTITLES = {
  mkvEnglish: timed(MKV_LINES, 0, 'English file, line'),
  mkvEnglishLate: timed(MKV_LINES, 3, 'Late file, line'),
};

/** SRT text served at SUBTITLE_HOST/<id>.srt. */
export const SUBTITLE_FILES: Record<string, string> = {
  en1: '1\n00:00:00,500 --> 00:00:20,000\nHello from the <i>test</i> subtitles\n\n2\n00:00:20,000 --> 00:00:40,000\nStill here\n',
  en2: '1\n00:00:00,500 --> 00:00:40,000\nThe second English file\n',
  fr1: '1\n00:00:00,500 --> 00:00:40,000\nBonjour\n',
  fr2: '1\n00:00:00,500 --> 00:00:40,000\nBonjour encore\n',
  ...LONG_SUBTITLES,
  ...ALIGN_SUBTITLES,
  ...AGREE_SUBTITLES,
  ...HASH_SUBTITLES,
  ...MKV_SUBTITLES,
  ...MATCH_SUBTITLES,
  hlsEnglishEarly: HLS_LONG_ENGLISH,
};

export interface PlaybackMock {
  /** Every media URL requested, as a path, in order. */
  media: string[];
  /** Every stream request, as type/videoId. */
  streams: string[];
  /** Every subtitles request, as the path after /subtitles/. */
  subtitles: string[];
  /** Every subtitle file asked for from SUBTITLE_HOST, by id, in order. */
  files: string[];
  /** Stream answers the slow addon has sent. */
  slowAnswers: number;
  /** Every episode IntroDB was asked about, as imdbId:season:episode. */
  skips: string[];
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
  /**
   * How long the first 'fetch' request to MEDIA_HOST takes to answer: the hash read's first
   * 64 KB, as the video's own requests are 'media'. Default at once.
   */
  hashDelayMs?: number;
  /** Whether OpenSubtitles answers with SUBTITLE_FILES. Default true. */
  subtitles?: boolean;
  /** OpenSubtitles' answer. Default DEFAULT_SUBTITLES. */
  subtitleList?: readonly TestSubtitle[];
  /** OpenSubtitles' answer when asked with the video's hash (`videoHash=`). Default subtitleList. */
  subtitleListWithHash?: readonly TestSubtitle[];
  /** How long each subtitle file, by id, takes to arrive. Default at once. */
  subtitleDelayMs?: Readonly<Record<string, number>>;
  /** Subtitle files, by id, that arrive only once this settles, so a test decides when. */
  subtitleGates?: Readonly<Record<string, Promise<unknown>>>;
  /** OpenSubtitles answers once this settles, so a test decides when. Default at once. */
  subtitlesGate?: Promise<unknown>;
  /**
   * IntroDB's timings, in seconds, by video id (tt…:season:episode): the
   * intro, recap, end credits (outro) and a scene after them. Others have none.
   */
  skips?: Readonly<
    Record<
      string,
      {
        intro?: readonly [number, number];
        recap?: readonly [number, number];
        outro?: readonly [number, number];
        postCredits?: readonly [number, number];
      }
    >
  >;
}

/** Serves the fixture with byte ranges, which the media element needs to seek. */
export function serveFixture(route: Route) {
  return serveVideo(route, FIXTURE);
}

function serveVideo(route: Route, video: Buffer) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : video.length - 1;
  return route.fulfill({
    status: range ? 206 : 200,
    contentType: 'video/webm',
    headers: {
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
      ...(range && { 'content-range': `bytes ${start}-${end}/${video.length}` }),
    },
    body: video.subarray(start, end + 1),
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
    /** Other values in the key-value store, by key, such as a Trakt sign-in. */
    kv?: Record<string, unknown>;
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
  await addStorageInitScript(
    page,
    ({ stored, saved, played, chosen, extra }) => {
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
        for (const key of Object.keys(extra)) tx.objectStore('kv').put(extra[key], key);
        tx.oncomplete = () => db.close();
      };
    },
    {
      stored: addons,
      saved: progress,
      played: cards,
      chosen: options.preferences ?? null,
      extra: options.kv ?? {},
    },
  );
}

/** Routes the stream addon, OpenSubtitles' subtitle answers and all media. Call after mockAddons. */
export async function mockPlayback(
  page: Page,
  options: PlaybackOptions = {},
): Promise<PlaybackMock> {
  const mock: PlaybackMock = {
    media: [],
    streams: [],
    subtitles: [],
    files: [],
    slowAnswers: 0,
    skips: [],
  };
  const broken = new Set(options.broken ?? []);
  let hashHeld = false;

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
          ...(stream.requestHeaders && { proxyHeaders: { request: stream.requestHeaders } }),
          filename: stream.filename ?? `${(stream.path ?? 'torrent').replace(/^.*\//, '')}`,
        },
        ...(stream.subtitles && {
          subtitles: stream.subtitles.map(({ id, path, lang, label }) => ({
            id,
            url: `${SUBTITLE_HOST}${path}`,
            lang,
            ...(label && { label }),
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
    if (options.hashDelayMs && !hashHeld && route.request().resourceType() === 'fetch') {
      hashHeld = true;
      await new Promise((resolve) => setTimeout(resolve, options.hashDelayMs));
    }
    if (options.mediaDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.mediaDelayMs));
    }
    if (broken.has(path)) return route.fulfill({ status: 404, body: '' });
    if (options.refused?.[path]?.includes(route.request().resourceType())) {
      return route.fulfill({ status: 503, body: '' });
    }
    const long = /^\/hls-long\/([\w-]+\.(m3u8|mp4|m4s|vtt))$/.exec(path);
    if (path.indexOf('/hls-long/') === 0) {
      if (!long) return route.fulfill({ status: 404 });
      const file = long[1]!;
      return route.fulfill({
        status: 200,
        contentType: HLS_TYPES[long[2]!],
        headers: { 'access-control-allow-origin': '*' },
        body:
          file === 'subs-fr.vtt'
            ? HLS_LONG_FRENCH
            : readFileSync(resolve(import.meta.dirname, 'fixtures/hls-long', file)),
      });
    }
    const hls = /^\/hls(-live|-commentary)?\//.exec(path);
    if (hls) {
      const file = path.slice(hls[0].length);
      if (!/^[\w-]+\.(m3u8|mp4|m4s|vtt)$/.test(file)) return route.fulfill({ status: 404 });
      let body: string | Buffer = readFileSync(resolve(import.meta.dirname, 'fixtures/hls', file));
      if (hls[1] === '-live' && file.endsWith('.m3u8')) {
        body = body.toString('utf8').replace(/^#EXT-X-(ENDLIST|PLAYLIST-TYPE:VOD)\r?\n?/gm, '');
      }
      if (hls[1] === '-commentary' && file === 'master.m3u8') {
        body = body
          .toString('utf8')
          .replace(
            /^(#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",)DEFAULT=YES(.*)$/m,
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English Commentary",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="eng",URI="pEnglish.m3u8"\n$1DEFAULT=NO$2,CHANNELS="6"',
          );
      }
      return route.fulfill({
        status: 200,
        contentType: HLS_TYPES[file.replace(/^.*\./, '')],
        headers: { 'access-control-allow-origin': '*' },
        body,
      });
    }
    if (path.indexOf('/film-') === 0) return serveVideo(route, FILM_FIXTURE);
    return serveVideo(route, path.indexOf('/long-') === 0 ? LONG_FIXTURE : FIXTURE);
  });

  await page.route(/^https:\/\/opensubtitles-v3\.strem\.io\/subtitles\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/subtitles/', '');
    mock.subtitles.push(decodeURIComponent(path));
    if (options.subtitlesGate) await options.subtitlesGate;
    if (options.subtitles === false) return json(route, { subtitles: [] });
    const list =
      (path.indexOf('videoHash=') !== -1 && options.subtitleListWithHash) ||
      options.subtitleList ||
      DEFAULT_SUBTITLES;
    return json(route, {
      subtitles: list.map(
        ({ id, lang, label, subtitleFileName, movieReleaseName, m, withoutId }) => ({
          ...(!withoutId && { id }),
          url: `${SUBTITLE_HOST}/${id}.srt`,
          lang,
          ...(label && { label }),
          ...(subtitleFileName !== undefined && { subtitleFileName }),
          ...(movieReleaseName !== undefined && { movieReleaseName }),
          ...(m && { m }),
        }),
      ),
    });
  });

  // The TV asks IntroDB through BannerTV's service: IntroDB's own answers are not open to it.
  await page.route(INTRODB_THROUGH_SERVICE, (route) => {
    const asked = new URL(route.request().url()).searchParams;
    const id = ['imdb_id', 'season', 'episode'].map((name) => asked.get(name)).join(':');
    mock.skips.push(id);
    const timed = options.skips?.[id];
    const segment = (span?: readonly [number, number]) =>
      span ? { start_sec: span[0], end_sec: span[1], start_ms: span[0] * 1000 } : null;
    return json(route, {
      intro: segment(timed?.intro),
      recap: segment(timed?.recap),
      outro: segment(timed?.outro),
      post_credits: segment(timed?.postCredits),
    });
  });

  await page.route(/^https:\/\/subs\.example\.com\//, async (route) => {
    const id = new URL(route.request().url()).pathname.replace(/^\/|\.srt$/g, '');
    mock.files.push(id);
    const delay = options.subtitleDelayMs?.[id];
    if (delay) await new Promise((done) => setTimeout(done, delay));
    await options.subtitleGates?.[id];
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

/** Which server of a RedirectChain a request reached. */
export type ChainServer = 'resolve' | 'debrid' | 'media';

/**
 * A stream link that leads on to the film, as an addon's link to a debrid service does: the
 * addon's server answers 302 to the service's, which answers 307 to its media server with a new
 * token each time. Real servers on this machine, each with cross-origin headers as the browser
 * checks them at every step: Playwright's routes never see a redirect's next request, which the
 * browser sends itself.
 */
export interface RedirectChain {
  /** The stream link to a path on the media server, through the other two. */
  link: (path: string) => string;
  /**
   * Every request the page's own code made (not the video's, nor a CORS check), in order: the
   * server it reached and the bytes asked for, if any. For a file, these are the hash read's.
   */
  fetched: Array<{ server: ChainServer; range?: string }>;
}

/** How the media server of a RedirectChain answers the page's own reads. */
export interface RedirectOptions {
  /** Every request is answered with the whole file, its range left out (200). */
  ignoreRange?: boolean;
  /**
   * Milliseconds the page's reads take, past the hash read's (its first and last 64 KB, and
   * the size): the reads of the video file's own subtitles.
   */
  slowReads?: number;
  /** Each link the debrid service leads to answers the page one read, and refuses the next. */
  oneUse?: boolean;
}

/** The journeys' MKV files (fixtures/mkv/make-mkv.sh), by name, as served at /mkv-<name>. */
const MKV_FILES = new Map<string, Buffer>();
function mkvFile(name: string): Buffer | undefined {
  if (!/^[\w-]+\.mkv$/.test(name)) return undefined;
  if (!MKV_FILES.has(name)) {
    MKV_FILES.set(name, readFileSync(resolve(import.meta.dirname, 'fixtures/mkv', name)));
  }
  return MKV_FILES.get(name);
}

/**
 * Starts a RedirectChain serving the 10-minute film at any /film- path, and the journeys' MKV
 * files at /mkv-<name> (own.mkv, no-index.mkv, pictures.mkv, spanish.mkv), until the page
 * closes.
 */
export async function serveRedirects(
  page: Page,
  options: RedirectOptions = {},
): Promise<RedirectChain> {
  const fetched: RedirectChain['fetched'] = [];
  let walks = 0;
  // The page's reads each link the debrid service led to has answered.
  const answered = new Map<string, number>();
  const origins = {} as Record<ChainServer, string>;
  const answer = async (
    server: ChainServer,
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'range',
      'access-control-allow-methods': 'GET',
    };
    if (request.method === 'OPTIONS') return response.writeHead(204, cors).end();
    const range = request.headers.range;
    const own = request.headers['sec-fetch-dest'] === 'empty';
    if (own) fetched.push({ server, ...(range && { range }) });
    const url = new URL(request.url ?? '/', origins[server]);
    const path = url.pathname;
    if (server === 'resolve') {
      return response
        .writeHead(302, { ...cors, location: `${origins.debrid}${path.replace(/^\/resolve/, '')}` })
        .end();
    }
    if (server === 'debrid') {
      walks++;
      return response
        .writeHead(307, { ...cors, location: `${origins.media}${path}?token=t${walks}` })
        .end();
    }
    const mkv = path.indexOf('/mkv-') === 0 ? mkvFile(path.slice('/mkv-'.length)) : undefined;
    const file = mkv ?? (path.indexOf('/film-') === 0 ? FILM_FIXTURE : undefined);
    if (!file) return response.writeHead(404, cors).end();
    const size = file.length;
    if (own && options.oneUse) {
      const reads = (answered.get(url.search) ?? 0) + 1;
      answered.set(url.search, reads);
      if (reads > 1) return response.writeHead(403, cors).end();
    }
    const hashRead =
      !range || range === 'bytes=0-65535' || range === `bytes=${size - 65536}-${size - 1}`;
    if (own && options.slowReads && !hashRead) {
      await new Promise((done) => setTimeout(done, options.slowReads));
      if (response.destroyed) return;
    }
    const bytes = options.ignoreRange ? null : /bytes=(\d+)-(\d*)/.exec(range ?? '');
    const start = bytes ? Number(bytes[1]) : 0;
    const end = bytes?.[2] ? Math.min(Number(bytes[2]), size - 1) : size - 1;
    if (start >= size) {
      return response.writeHead(416, { ...cors, 'content-range': `bytes */${size}` }).end();
    }
    return response
      .writeHead(bytes ? 206 : 200, {
        ...cors,
        'content-type': mkv ? 'video/x-matroska' : 'video/webm',
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        ...(bytes && { 'content-range': `bytes ${start}-${end}/${size}` }),
      })
      .end(file.subarray(start, end + 1));
  };
  const servers = await Promise.all(
    (['resolve', 'debrid', 'media'] as const).map(
      (server) =>
        new Promise<ReturnType<typeof createServer>>((started) => {
          const http = createServer((request, response) => {
            void answer(server, request, response);
          });
          http.listen(0, '127.0.0.1', () => {
            origins[server] = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
            started(http);
          });
        }),
    ),
  );
  page.once('close', () => {
    for (const http of servers) {
      http.closeAllConnections();
      http.close();
    }
  });
  // The journeys refuse every other address (mockAddons): these servers' are let through.
  for (const origin of Object.values(origins)) {
    await page.route(`${origin}/**`, (route) => route.continue());
  }
  return { link: (path) => `${origins.resolve}/resolve${path}`, fetched };
}

/** A value the app keeps in its IndexedDB key-value store. */
export function readKv(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('bannertv');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('kv').objectStore('kv').get(name);
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
        };
      }),
    key,
  );
}
