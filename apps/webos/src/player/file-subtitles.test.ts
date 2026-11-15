import type { Cue, LineTiming } from '@bannertv/core';
import type { Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flatten,
  type Part,
  partsSource,
  readFixture,
} from '../../../../packages/core/src/media/fixtures/helpers';
import {
  type SyntheticOptions,
  type SyntheticLine,
  synthesize,
} from '../../../../packages/core/src/media/fixtures/synthetic';
import type { Engine, EngineListener } from './engines/types';
import {
  FILE_WAIT_MS,
  fileKindOf,
  type FileTextReport,
  OPEN_MS,
  START_AFTER_MS,
  withFileSubtitles,
} from './file-subtitles';
import { noteRequestHeaders } from './request-headers';
import type { HashReading, Landing } from './stream-hash';

// As on the TV: the addon's resolve link, which leads to the debrid service's CDN.
const LINK = 'https://resolve.example.com/resolve/debrid/KEY/abc/Film.2023.1080p.WEB-DL.mkv';
const CDN = 'https://cdn.example.com/f/1/Film.2023.1080p.WEB-DL.mkv';

/** The parts of a media element the reader listens to. */
class FakeVideo extends EventTarget {
  currentTime = 0;

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

/** The TV's own engine, which plays and lists nothing here. */
function innerEngine(): Engine & { loads: string[]; destroyed: number; seeks: number } {
  const engine = {
    name: 'native' as const,
    loads: [] as string[],
    destroyed: 0,
    seeks: 0,
    load(url: string) {
      engine.loads.push(url);
      return Promise.resolve();
    },
    isLive: () => false,
    liveWindow: () => null,
    audioTracks: () => [],
    selectAudio: () => undefined,
    textTracks: () => [],
    selectText: () => undefined,
    seeked() {
      engine.seeks++;
    },
    destroy() {
      engine.destroyed++;
    },
  };
  return engine;
}

/** A file to serve: its bytes, or how to read them where it is too long to hold. */
interface Served {
  size: number;
  read: (start: number, length: number) => Uint8Array | Promise<Uint8Array>;
}

const bytesOf = (bytes: Uint8Array): Served => ({
  size: bytes.length,
  read: (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length)),
});

interface ServerOptions {
  contentType?: string;
  ignoreRange?: boolean;
  /** Reads straight to a CDN link it answers before refusing (403). */
  directReads?: number;
  /** The link refuses (403), or never answers (TypeError). */
  link?: 'refused' | 'blocked';
  /** Milliseconds each answer takes, by its range's start. */
  delayMs?: (start: number) => number;
  /** Content-Range hidden, as behind cross-origin checks. */
  hideRange?: boolean;
}

interface Asked {
  url: string;
  start: number;
  length: number;
  aborted: boolean;
}

/** An answer as the source reads one: status, headers, where it landed, and a body in pieces. */
function answer(status: number, headers: Record<string, string>, bytes: Uint8Array, url: string) {
  let at = 0;
  let cancelled = false;
  return {
    status,
    url,
    headers: new Headers(headers),
    body: {
      getReader: () => ({
        read: async () => {
          if (cancelled || at >= bytes.length) return { done: true, value: undefined };
          const value = bytes.subarray(at, at + 16384);
          at += 16384;
          return { done: false, value };
        },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Response;
}

/** Serves `file` behind the resolve link, a new CDN token for each walk through it. */
function serve(file: Served, options: ServerOptions = {}) {
  const asked: Asked[] = [];
  let minted = 0;
  const reads = new Map<string, number>();
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const range = /bytes=(\d+)-(\d+)/.exec((init?.headers as Record<string, string>).Range ?? '')!;
    const start = Number(range[1]);
    const length = Number(range[2]) - start + 1;
    const entry: Asked = { url, start, length, aborted: false };
    asked.push(entry);
    const signal = init?.signal;
    signal?.addEventListener('abort', () => (entry.aborted = true));
    const delay = options.delayMs?.(start) ?? 0;
    if (delay > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('', 'AbortError'));
        });
      });
    }
    if (signal?.aborted) {
      entry.aborted = true;
      throw new DOMException('', 'AbortError');
    }
    let landed = url;
    if (url === LINK) {
      if (options.link === 'blocked') throw new TypeError('Failed to fetch');
      if (options.link === 'refused') return answer(403, {}, new Uint8Array(0), url);
      landed = `${CDN}?token=t${++minted}`;
    } else {
      const count = (reads.get(url) ?? 0) + 1;
      reads.set(url, count);
      if (count > (options.directReads ?? Infinity)) return answer(403, {}, new Uint8Array(0), url);
    }
    const type = { 'content-type': options.contentType ?? 'video/x-matroska' };
    if (options.ignoreRange) return answer(200, type, await file.read(0, file.size), landed);
    if (start >= file.size) return answer(416, type, new Uint8Array(0), landed);
    const end = Math.min(file.size - 1, start + length - 1);
    const headers: Record<string, string> = { ...type };
    if (!options.hideRange) headers['content-range'] = `bytes ${start}-${end}/${file.size}`;
    return answer(206, headers, await file.read(start, end - start + 1), landed);
  }) as typeof fetch;
  return { asked, fetcher };
}

interface Setup {
  file: Served;
  name?: string;
  server?: ServerOptions;
  /** What the hash read found at the file's start, handed over once. */
  landing?: Landing;
  /** The hash read's outcome for the link. */
  reading?: HashReading;
  inflate?: null;
}

/** The wrapper around a fake TV engine, and everything it told the session. */
function setup(options: Setup) {
  const video = new FakeVideo();
  const inner = innerEngine();
  const told = {
    tracks: 0,
    cues: [] as Array<{ id: string; cues: Cue[]; replace?: boolean }>,
    timings: [] as Array<Record<string, LineTiming[]>>,
  };
  const listener: EngineListener = {
    tracks: () => {
      told.tracks++;
    },
    cues: (id, cues, replace) => {
      told.cues.push({ id, cues, replace });
    },
    fatal: () => undefined,
    timings: (byTrack) => {
      told.timings.push(byTrack);
    },
  };
  const { asked, fetcher } = serve(options.file, options.server);
  let landing = options.landing;
  const engine = withFileSubtitles(
    inner,
    video as unknown as HTMLVideoElement,
    listener,
    { name: options.name ?? 'Film.2023.1080p.WEB-DL.mkv' },
    {
      fetcher,
      clock: {
        now: () => Date.now(),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      takeLanding: () => {
        const taken = landing;
        landing = undefined;
        return taken;
      },
      hashReadingFor: () => (options.reading ? Promise.resolve(options.reading) : undefined),
      ...(options.inflate === null && { inflate: null }),
    },
  );
  return { engine, video, inner, told, asked };
}

/** Lets fake time pass in small steps, the reads' promises settling on the way. */
async function pass(ms: number) {
  for (let left = ms; left > 0; left -= 10) await vi.advanceTimersByTimeAsync(Math.min(10, left));
  await vi.advanceTimersByTimeAsync(0);
}

/** Loads the link, plays its first picture, and lets the reader start and finish. */
async function played(options: Setup) {
  const world = setup(options);
  await world.engine.load(LINK, 0);
  world.video.fire('playing');
  await pass(START_AFTER_MS + 200);
  return world;
}

const file = async (name: string) => bytesOf(await readFixture(name));

function syntheticFile(options: Partial<SyntheticOptions>): Served {
  const { parts } = synthesize({
    length: 60000,
    tracks: [],
    lines: [],
    frameRate: 2,
    videoRate: 4000,
    ...options,
  });
  return bytesOf(flatten(parts));
}

const lines = (track: number, count: number, from = 1000): SyntheticLine[] =>
  Array.from({ length: count }, (_, i) => ({
    track,
    time: from + i * 1000,
    duration: 600,
    text: `Test line ${i + 1}`,
  }));

const reportOf = (engine: Engine) => engine.fileText?.() as FileTextReport;
const lastCues = (told: ReturnType<typeof setup>['told']) => told.cues[told.cues.length - 1];
const textOf = (cue: Cue) =>
  cue.lines.map((line) => line.map((span) => span.text).join('')).join('\n');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('which files are read', () => {
  it('goes by the name: Matroska and WebM, another kind, or a name that does not say', () => {
    expect(['a.mkv', 'b.MK3D', 'c.webm', 'd.mkv?token=1'].map(fileKindOf)).toEqual([
      'matroska',
      'matroska',
      'matroska',
      'matroska',
    ]);
    expect(['a.mp4', 'b.m4v', 'c.mov', 'd.avi', 'e.ts', 'f.m2ts', 'g.iso'].map(fileKindOf)).toEqual(
      Array(7).fill('other'),
    );
    expect([undefined, '', 'resolve', 'Film.2023.1080p'].map(fileKindOf)).toEqual(
      Array(4).fill('unknown'),
    );
  });

  it('reads nothing of a playlist, a link needing request headers, or a file named as another kind', async () => {
    const guarded = 'https://cdn.example.com/needs-headers/film.mkv';
    noteRequestHeaders({
      source: { kind: 'url', url: guarded },
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/' } } },
    } as unknown as Stream);
    for (const [link, name] of [
      ['https://live.example.com/match/master.m3u8', undefined],
      [guarded, undefined],
      [LINK, 'Film.2023.1080p.WEB-DL.mp4'],
    ] as const) {
      const { engine, video, asked, inner } = setup({ file: await file('mkvmerge.mkv'), name });
      await engine.load(link, 0);
      video.fire('playing');
      await pass(START_AFTER_MS + FILE_WAIT_MS);
      expect(asked).toEqual([]);
      expect(inner.loads).toEqual([link]);
      expect(engine.textComing?.()).toBe(false);
      expect(engine.textTracks()).toEqual([]);
      const report = engine.fileText?.() ?? null;
      expect(report).toEqual(
        name ? expect.objectContaining({ state: 'none', why: 'named' }) : null,
      );
    }
  });

  it('starts 1.5 s after the first picture, and waits again while the video waits for data', async () => {
    const { engine, video, asked } = setup({ file: await file('mkvmerge.mkv') });
    await engine.load(LINK, 0);
    expect(engine.textComing?.()).toBe(true);
    expect(reportOf(engine)).toEqual({ state: 'waiting' });
    await pass(5000);
    expect(asked).toEqual([]);
    video.fire('playing');
    await pass(1000);
    video.fire('waiting');
    await pass(2000);
    expect(asked).toEqual([]);
    video.fire('playing');
    await pass(START_AFTER_MS - 100);
    expect(asked).toEqual([]);
    await pass(300);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]).toMatchObject({ url: LINK, start: 0, length: 65536 });
  });

  it('holds nothing back for a link whose name does not say, and reads it all the same', async () => {
    const { engine, video, asked } = setup({ file: await file('mkvmerge.mkv'), name: 'resolve' });
    await engine.load(LINK, 0);
    expect(engine.textComing?.()).toBe(false);
    video.fire('playing');
    await pass(START_AFTER_MS + 200);
    expect(asked.length).toBeGreaterThan(0);
    expect(engine.textTracks().length).toBe(5);
  });
});

describe('the tracks of an mkvmerge file', () => {
  it('lists the readable text tracks, by language, the full one first', async () => {
    const { engine, told, asked } = await played({ file: await file('mkvmerge.mkv') });
    expect(engine.textComing?.()).toBe(false);
    expect(engine.textTracks()).toEqual([
      { id: 'mkv:2', lang: 'en', label: 'English', active: false, picture: false, timed: true },
      { id: 'mkv:3', lang: 'en', label: 'Signs', active: false, picture: false, forced: true },
      {
        id: 'mkv:4',
        lang: 'fr-CA',
        label: 'Français',
        active: false,
        picture: false,
        timed: true,
      },
      {
        id: 'mkv:5',
        lang: 'de',
        label: '',
        active: false,
        picture: false,
        hearing: true,
        timed: true,
      },
      { id: 'mkv:6', lang: 'es', label: '', active: false, picture: false, timed: true },
    ]);
    // The head, then the Cues straight from where the walk led: the walk once.
    expect(asked.map(({ url }) => url === LINK)).toEqual([true, false]);
    expect(told.tracks).toBeGreaterThanOrEqual(2);
    const report = reportOf(engine);
    expect(report).toMatchObject({
      state: 'read',
      text: ['en', 'en', 'fr-CA', 'de', 'es'],
      unreadable: 0,
      picture: 0,
      cost: { requests: 2, walks: 1, lines: 0, lineRequests: 0 },
    });
  });

  it('hands every full track’s whole timing over at once, before its text is read', async () => {
    const { told } = await played({ file: await file('mkvmerge.mkv') });
    expect(told.timings).toHaveLength(1);
    const [timings] = told.timings;
    // Not the forced one.
    expect(Object.keys(timings!).sort()).toEqual(['mkv:2', 'mkv:4', 'mkv:5', 'mkv:6']);
    expect(timings!['mkv:2']).toHaveLength(20);
    expect(timings!['mkv:2']![0]).toEqual({ start: 0.5, end: 2.25 });
    expect(timings!['mkv:2']![4]).toEqual({ start: 10.01, end: 12.345 });
    expect(told.cues).toEqual([]);
  });

  it('takes a track’s timing as whole only where the Cues give nine lines in ten an end', async () => {
    const { engine, told } = await played({
      file: syntheticFile({
        tracks: [{ number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' }],
        lines: lines(2, 30),
        noCueDuration: true,
      }),
    });
    expect(engine.textTracks()).toEqual([
      { id: 'mkv:2', lang: 'eng', label: '', active: false, picture: false },
    ]);
    expect(told.timings).toEqual([]);
  });

  it('marks forced and hard-of-hearing tracks by their names, and orders them within a language', async () => {
    const { engine } = await played({
      file: syntheticFile({
        tracks: [
          { number: 2, codecId: 'S_TEXT/UTF8', language: 'spa', name: 'Español' },
          { number: 3, codecId: 'S_TEXT/UTF8', language: 'eng', name: 'Signs & Songs' },
          { number: 4, codecId: 'S_TEXT/UTF8', language: 'eng', name: 'English SDH' },
          { number: 5, codecId: 'S_TEXT/UTF8', language: 'eng', name: 'English' },
          { number: 6, codecId: 'S_TEXT/UTF8', language: 'spa', forced: true },
          { number: 7, codecId: 'S_HDMV/PGS', language: 'eng' },
          { number: 8, codecId: 'S_TEXT/UTF8', language: 'fre', encrypted: true },
        ],
        lines: [...lines(2, 3), ...lines(3, 3), ...lines(4, 3), ...lines(5, 3), ...lines(6, 3)],
      }),
    });
    expect(engine.textTracks().map(({ id, forced, hearing }) => ({ id, forced, hearing }))).toEqual(
      [
        { id: 'mkv:2', forced: undefined, hearing: undefined },
        { id: 'mkv:6', forced: true, hearing: undefined },
        { id: 'mkv:5', forced: undefined, hearing: undefined },
        { id: 'mkv:4', forced: undefined, hearing: true },
        { id: 'mkv:3', forced: true, hearing: undefined },
      ],
    );
    expect(reportOf(engine)).toMatchObject({ state: 'read', unreadable: 1, picture: 1 });
  });

  it('counts zlib text as unreadable where the engine cannot inflate it', async () => {
    const { engine, asked } = await played({ file: await file('zlib.mkv'), inflate: null });
    expect(engine.textTracks()).toEqual([]);
    expect(reportOf(engine)).toMatchObject({ state: 'read', text: [], unreadable: 1, picture: 0 });
    // No Cues read for nothing to show.
    expect(asked).toHaveLength(1);
  });

  it('reads no Cues for a file of picture subtitles only', async () => {
    const { engine, asked } = await played({
      file: syntheticFile({ tracks: [{ number: 2, codecId: 'S_HDMV/PGS', language: 'eng' }] }),
    });
    expect(engine.textTracks()).toEqual([]);
    expect(reportOf(engine)).toMatchObject({ state: 'read', text: [], picture: 1 });
    expect(asked).toHaveLength(1);
  });
});

describe('a track’s lines', () => {
  it('come from a window around the playhead, handed over whole each time', async () => {
    const { engine, told, asked } = await played({ file: await file('mkvmerge.mkv') });
    const before = asked.length;
    engine.selectText('mkv:2');
    expect(engine.textTracks().find((track) => track.active)?.id).toBe('mkv:2');
    await pass(100);
    const handed = lastCues(told)!;
    expect(handed).toMatchObject({ id: 'mkv:2', replace: true });
    expect(handed.cues).toHaveLength(20);
    expect(textOf(handed.cues[0]!)).toBe('The first line.');
    // Two reads at a time, all straight to where the walk led.
    expect(asked.slice(before).every(({ url }) => url.startsWith(CDN))).toBe(true);
    expect(reportOf(engine)).toMatchObject({ cost: { lines: 20 } });
    expect((reportOf(engine) as { cost: { lineRequests: number } }).cost.lineRequests).toBe(
      asked.length - before,
    );
  });

  it('are handed over once even when the window holds none, and follow a seek', async () => {
    const { engine, video, told } = await played({ file: await file('ffmpeg.mkv') });
    video.currentTime = 3000;
    const id = engine.textTracks()[0]!.id;
    engine.selectText(id);
    await pass(100);
    expect(told.cues).toEqual([{ id, cues: [], replace: true }]);
    video.currentTime = 0;
    video.fire('seeking');
    await pass(100);
    expect(lastCues(told)!.cues.length).toBeGreaterThan(0);
  });

  it('stop for the track left, and for none', async () => {
    const { engine, told } = await played({ file: await file('mkvmerge.mkv') });
    engine.selectText('mkv:2');
    engine.selectText('mkv:6');
    await pass(100);
    expect(new Set(told.cues.map(({ id }) => id))).toEqual(new Set(['mkv:6']));
    const handed = told.cues.length;
    engine.selectText(null);
    engine.selectText('mkv:99');
    await pass(100);
    expect(told.cues).toHaveLength(handed);
    expect(engine.textTracks().some((track) => track.active)).toBe(false);
  });

  it('stop at destroy, its reads aborted, and nothing handed over after', async () => {
    let slow = false;
    const world = await played({
      file: await file('mkvmerge.mkv'),
      server: { delayMs: () => (slow ? 5000 : 0) },
    });
    const { engine, told, asked, inner } = world;
    const before = asked.length;
    slow = true;
    engine.selectText('mkv:2');
    await pass(100);
    expect(asked.length).toBeGreaterThan(before);
    engine.destroy();
    await pass(6000);
    expect(asked.slice(before).every(({ aborted }) => aborted)).toBe(true);
    expect(told.cues).toEqual([]);
    expect(inner.destroyed).toBe(1);
  });

  it('start again from nothing for another load', async () => {
    const world = await played({ file: await file('mkvmerge.mkv') });
    world.engine.selectText('mkv:2');
    await world.engine.load(LINK, 0);
    expect(world.engine.textTracks()).toEqual([]);
    expect(reportOf(world.engine)).toEqual({ state: 'waiting' });
    expect(world.engine.textComing?.()).toBe(true);
  });
});

describe('a file that cannot give its subtitles', () => {
  const cases: Array<[string, () => Promise<Setup>, string]> = [
    ['not Matroska', async () => ({ file: await file('text/eng.srt') }), 'not-matroska'],
    [
      'named an MP4 by the server',
      async () => ({ file: await file('mkvmerge.mkv'), server: { contentType: 'video/mp4' } }),
      'not-matroska',
    ],
    ['indexing only its video', async () => ({ file: await file('video-cues.mkv') }), 'no-index'],
    ['a live recording', async () => ({ file: await file('live.mkv') }), 'live'],
    [
      'with no subtitle track',
      async () => ({ file: syntheticFile({ tracks: [] }) }),
      'no-subtitles',
    ],
    [
      'cut short before its Cues',
      async () => {
        // Its Cues start at 33,102.
        const whole = await readFixture('mkvmerge.mkv');
        return { file: bytesOf(whole.subarray(0, 30000)) };
      },
      'corrupt',
    ],
    [
      'with a position past 2^53',
      async () => ({
        file: syntheticFile({
          tracks: [{ number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' }],
          lines: lines(2, 3),
          hugeCuesPosition: true,
        }),
      }),
      'too-large',
    ],
    [
      'on a server that ignores ranges',
      async () => ({ file: await file('mkvmerge.mkv'), server: { ignoreRange: true } }),
      'no-range',
    ],
    [
      'behind a link that never answers',
      async () => ({ file: await file('mkvmerge.mkv'), server: { link: 'blocked' } }),
      'blocked',
    ],
    [
      'behind a link that refuses',
      async () => ({ file: await file('mkvmerge.mkv'), server: { link: 'refused' } }),
      'refused',
    ],
    [
      'behind a link good for one read',
      async () => ({ file: await file('mkvmerge.mkv'), server: { directReads: 0 } }),
      'one-use',
    ],
  ];

  for (const [what, make, why] of cases) {
    it(`says why for a file ${what}, and lets the choice go on`, async () => {
      const { engine, told } = await played(await make());
      expect(reportOf(engine)).toMatchObject({ state: 'none', why });
      expect(engine.textComing?.()).toBe(false);
      expect(engine.textTracks()).toEqual([]);
      expect(told.tracks).toBeGreaterThanOrEqual(1);
      expect(told.timings).toEqual([]);
    });
  }

  it('gives up after 20 s for the head and the Cues, the choice let go at 6 s', async () => {
    const world = setup({ file: await file('mkvmerge.mkv'), server: { delayMs: () => 25000 } });
    await world.engine.load(LINK, 0);
    world.video.fire('playing');
    await pass(START_AFTER_MS + 100);
    expect(reportOf(world.engine)).toEqual({ state: 'reading' });
    expect(world.engine.textComing?.()).toBe(true);
    const told = world.told.tracks;
    await pass(FILE_WAIT_MS);
    expect(world.engine.textComing?.()).toBe(false);
    expect(world.told.tracks).toBeGreaterThan(told);
    await pass(OPEN_MS - FILE_WAIT_MS);
    expect(reportOf(world.engine)).toMatchObject({ state: 'none', why: 'timed-out' });
    expect(world.asked.every(({ aborted }) => aborted)).toBe(true);
  });

  it('lists tracks that come after the choice was let go, and says so', async () => {
    const world = setup({
      file: await file('mkvmerge.mkv'),
      server: { delayMs: (start) => (start === 0 ? 7000 : 0) },
    });
    await world.engine.load(LINK, 0);
    world.video.fire('playing');
    await pass(START_AFTER_MS + FILE_WAIT_MS + 100);
    expect(world.engine.textComing?.()).toBe(false);
    const told = world.told.tracks;
    await pass(1000);
    expect(world.engine.textTracks()).toHaveLength(5);
    expect(world.told.tracks).toBeGreaterThan(told);
  });

  it('lets the choice go 7.5 s after the first picture however often the video waits', async () => {
    const { engine, video } = setup({ file: await file('mkvmerge.mkv') });
    await engine.load(LINK, 0);
    video.fire('playing');
    for (let i = 0; i < 7; i++) {
      await pass(1000);
      video.fire('waiting');
      video.fire('playing');
    }
    expect(engine.textComing?.()).toBe(true);
    await pass(START_AFTER_MS + FILE_WAIT_MS - 7000);
    expect(engine.textComing?.()).toBe(false);
  });
});

describe('what the hash read found', () => {
  it('reads the head from it, and the Cues straight from where it landed', async () => {
    // A minute of video before the Cues, so they lie past the hash's first 64 KB.
    const long = syntheticFile({
      tracks: [{ number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' }],
      lines: lines(2, 30),
    });
    const head = await long.read(0, 65536);
    expect(long.size).toBeGreaterThan(65536);
    const { engine, asked } = await played({
      file: long,
      landing: { landed: `${CDN}?token=t0`, head, total: long.size },
      reading: { found: { videoHash: '0', videoSize: long.size }, ms: 10, walks: 1 },
    });
    expect(engine.textTracks()).toHaveLength(1);
    expect(asked.map(({ url, start }) => [url, start >= 65536])).toEqual([
      [`${CDN}?token=t0`, true],
    ]);
    expect(reportOf(engine)).toMatchObject({ cost: { requests: 1, walks: 0 } });
  });

  it('says from it alone, before the first picture, that a file has no text to read', async () => {
    const pictures = syntheticFile({ tracks: [{ number: 2, codecId: 'S_HDMV/PGS' }] });
    const head = await pictures.read(0, 65536);
    const { engine, asked } = setup({
      file: pictures,
      landing: { landed: `${CDN}?token=t0`, head, total: pictures.size },
      reading: { found: { videoHash: '0', videoSize: pictures.size }, ms: 10, walks: 1 },
    });
    await engine.load(LINK, 0);
    await pass(10);
    expect(reportOf(engine)).toMatchObject({ state: 'read', text: [], picture: 1 });
    expect(engine.textComing?.()).toBe(false);
    expect(asked).toEqual([]);
  });

  it('makes no request where the hash read was refused, ignored ranges or had a link good for one use', async () => {
    const outcomes: Array<[HashReading, string]> = [
      [{ failed: 'refused', step: 'start', ms: 5, walks: 1 }, 'blocked'],
      [{ failed: 'no range', step: 'start', ms: 5, walks: 1 }, 'no-range'],
      [{ found: { videoHash: '0', videoSize: 1 }, ms: 5, walks: 2, fellBack: 'end' }, 'one-use'],
    ];
    for (const [reading, why] of outcomes) {
      const { engine, video, asked } = setup({ file: await file('mkvmerge.mkv'), reading });
      await engine.load(LINK, 0);
      await pass(10);
      expect(reportOf(engine)).toMatchObject({ state: 'none', why });
      expect(engine.textComing?.()).toBe(false);
      video.fire('playing');
      await pass(START_AFTER_MS + 100);
      expect(asked).toEqual([]);
    }
  });

  it('walks itself after a hash read that timed out or failed later', async () => {
    const { engine, asked } = await played({
      file: await file('mkvmerge.mkv'),
      reading: { failed: 'timed out', step: 'end', ms: 15000, walks: 1 },
    });
    expect(engine.textTracks()).toHaveLength(5);
    expect(asked[0]).toMatchObject({ url: LINK, start: 0 });
  });
});

describe('a two-hour film on a debrid link', () => {
  const FILM_MS = 2 * 3600 * 1000;
  const filmLines = (): SyntheticLine[] =>
    Array.from({ length: 1500 }, (_, i) => ({
      track: 2,
      time: 2000 + i * 4790 + ((i * 37) % 400),
      duration: 1500 + (i % 7) * 300,
      text: `Test line ${i + 1}, as long as a line someone says in a film.`,
    }));
  let parts: Part[] | undefined;
  const film = (): Served => {
    parts ??= synthesize({
      length: FILM_MS,
      tracks: [
        { number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' },
        { number: 3, codecId: 'S_HDMV/PGS', language: 'eng' },
      ],
      lines: filmLines(),
      clusterLength: 5000,
      frameRate: 1,
      videoRate: 625000,
    }).parts;
    const source = partsSource(parts, 0);
    return { size: source.size!, read: (start, length) => source.read(start, length) };
  };

  it('costs a few requests for the head and the Cues, and about one a line for two minutes', async () => {
    const { engine, video, told } = await played({ file: film() });
    const report = reportOf(engine) as Extract<FileTextReport, { state: 'read' }>;
    expect(report).toMatchObject({ state: 'read', text: ['eng'], picture: 1 });
    expect(told.timings[0]!['mkv:2']).toHaveLength(1500);
    const open = { requests: report.cost.requests, bytes: report.cost.bytes };
    expect(open.requests).toBeLessThanOrEqual(3);
    expect(open.bytes).toBeLessThan(200 * 1024);
    engine.selectText('mkv:2');
    for (let time = 0; time <= 120; time += 0.5) {
      video.currentTime = time;
      video.fire('timeupdate');
      await vi.advanceTimersByTimeAsync(500);
    }
    await pass(100);
    const { lines: read, lineRequests, lineBytes } = report.cost;
    // Two minutes and the window ahead of them: about 50 lines, a read each.
    expect(read).toBeGreaterThan(40);
    expect(lineRequests).toBeLessThanOrEqual(read);
    expect(lineBytes).toBeLessThan(lineRequests * 4096);
    console.info(
      `two-hour film: head and Cues ${open.requests} requests, ${open.bytes} bytes; ` +
        `two minutes: ${read} lines in ${lineRequests} requests, ${lineBytes} bytes`,
    );
  });
});
