import {
  crc32,
  createStore,
  OPENSUBTITLES_V3_ID,
  type SubdlFile,
  type SubdlSearchState,
} from '@bannertv/core';
import type { Stream, Subtitle } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HashReading } from './stream-hash';
import { forgetSubtitleTraces, recentSubtitleTraces, startSubtitleTrace } from './subtitle-trace';
import {
  bestSubdlRelease,
  capSubdlFiles,
  clearSubtitleCache,
  HASH_WAIT_MS,
  type ListedSubtitle,
  loadSubtitles,
  mergeHashAnswer,
  plainId,
  subtitleList,
  toOption,
} from './subtitles';

/** The subtitles addons installed, each ask to them, and the hash read the test lets finish. */
const net = vi.hoisted(() => ({
  addons: [] as Array<{ id: string; name: string }>,
  asks: [] as Array<{
    at: number;
    hints: { videoHash?: string; videoSize?: number; filename?: string };
    answers: Array<{
      addon: { manifest: { id: string; name: string } };
      query: {
        get(): { status: string; data?: unknown };
        subscribe(listener: () => void): () => void;
        load(): void;
        answer(data: unknown): void;
        fail(): void;
      };
    }>;
  }>,
  hash: null as null | ((reading: unknown) => void),
  hashes: 0,
}));

vi.mock('../data/addons', () => ({
  addonClient: {
    subtitles(_type: string, _videoId: string, hints: (typeof net.asks)[number]['hints']) {
      const answers = net.addons.map((manifest) => {
        const store = createStore<{ status: string; data?: unknown }>({ status: 'idle' });
        return {
          addon: { manifest },
          query: {
            get: store.get,
            subscribe: store.subscribe,
            load: () => store.set({ status: 'loading' }),
            answer: (data: unknown) => store.set({ status: 'success', data }),
            fail: () => store.set({ status: 'error' }),
          },
        };
      });
      net.asks.push({ at: Date.now(), hints, answers });
      return answers;
    },
  },
}));

/** SubDL's searches made, each one the test answers by hand, and whether downloads are left. */
const subdlNet = vi.hoisted(() => ({
  searches: [] as Array<{
    wanted: readonly string[];
    languages: readonly string[];
    loaded: boolean;
    stopped: boolean;
    set(state: unknown): void;
  }>,
  downloadsLeft: true,
  resting: false,
}));

vi.mock('../data/subdl', async () => {
  const core = await import('@bannertv/core');
  return {
    subdl: {
      search(_type: string, _videoId: string, wanted: readonly string[]) {
        const store = core.createStore<SubdlSearchState>({ status: 'asking' });
        const languages = wanted
          .map((language) => core.subdlCodeFor(language))
          .filter((code): code is string => code !== undefined);
        const made = {
          wanted,
          languages,
          loaded: false,
          stopped: false,
          set: (state: unknown) => store.set(state as SubdlSearchState),
        };
        subdlNet.searches.push(made);
        return {
          get: store.get,
          subscribe: store.subscribe,
          load: () => {
            made.loaded = true;
          },
          stop: () => {
            made.stopped = true;
          },
          languages,
        };
      },
    },
    subdlUsage: {
      takeDownload: () => subdlNet.downloadsLeft,
      resting: () => (subdlNet.resting ? { why: 'busy', until: Infinity } : null),
    },
    isSubdlDownload: (url: string) => url.startsWith('https://dl.subdl.com/'),
  };
});

vi.mock('./stream-hash', () => ({
  readStreamHash: () => {
    net.hashes++;
    return new Promise((resolve) => {
      net.hash = resolve;
    });
  },
}));

const CHUNK = new Uint8Array(64 * 1024);
const MB = 1024 * 1024;

/** A body of `total` bytes made as it is read, counting how much was read. */
function counted(total: number, chunk = CHUNK) {
  const read = { bytes: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (read.bytes >= total) {
        controller.close();
        return;
      }
      read.bytes += chunk.length;
      controller.enqueue(chunk);
    },
  });
  return { stream, read };
}

function serve(body: ReadableStream<Uint8Array>) {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(body)));
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plainId', () => {
  it('keeps an addon’s plain id, and hashes a link, so no key ever holds one', () => {
    expect(plainId('en1')).toBe('en1');
    expect(plainId('1954741')).toBe('1954741');
    const link = 'https://subs.example.com/account-key/file.srt';
    const hashed = plainId(link);
    expect(hashed).toMatch(/^h[0-9a-z]+$/);
    expect(hashed).toBe(plainId(link));
    expect(hashed).not.toBe(plainId('https://subs.example.com/account-key/other.srt'));
  });
});

describe('toOption', () => {
  it('carries what the addon says of a file, and leaves out what it does not', () => {
    const subtitle = {
      id: '9397119',
      url: 'https://subs.example.com/9397119.srt',
      lang: 'eng',
      label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
      releaseName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
      hashMatch: true,
      fps: 23.976,
      season: 1,
      episode: 1,
    };
    expect(toOption('os', 'OpenSubtitles v3', subtitle)).toEqual({
      key: 'os#9397119',
      source: 'OpenSubtitles v3',
      lang: 'eng',
      url: 'https://subs.example.com/9397119.srt',
      label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
      releaseName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
      hashMatch: true,
      fps: 23.976,
      season: 1,
      episode: 1,
    });
    expect(
      toOption('os', 'OpenSubtitles v3', {
        id: '1',
        url: 'https://subs.example.com/1.srt',
        lang: 'eng',
      }),
    ).toEqual({
      key: 'os#1',
      lang: 'eng',
      source: 'OpenSubtitles v3',
      url: 'https://subs.example.com/1.srt',
    });
  });
});

describe('loadSubtitles', () => {
  it('reads a file that arrives in pieces', async () => {
    const text = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nHello there\n');
    serve(
      new ReadableStream({
        start(controller) {
          controller.enqueue(text.slice(0, 20));
          controller.enqueue(text.slice(20));
          controller.close();
        },
      }),
    );
    const cues = await loadSubtitles({ url: 'https://subs.example.com/pieces.srt', lang: 'eng' });
    expect(cues.map((cue) => cue.lines[0]![0]!.text)).toEqual(['Hello there']);
  });

  it('reads a file once, and again after the files read so far are forgotten', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', () => {
      fetched++;
      return Promise.resolve(new Response('1\n00:00:01,000 --> 00:00:02,000\nHello there\n'));
    });
    const file = { url: 'https://subs.example.com/kept.srt', lang: 'eng' };
    await loadSubtitles(file);
    await loadSubtitles(file);
    expect(fetched).toBe(1);
    clearSubtitleCache();
    await loadSubtitles(file);
    expect(fetched).toBe(2);
  });

  it('shares a download read only to be lined up, and keeps none of it', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', () => {
      fetched++;
      return Promise.resolve(new Response('1\n00:00:01,000 --> 00:00:02,000\nA test line\n'));
    });
    clearSubtitleCache();
    const kept = { url: 'https://subs.example.com/shown.srt', lang: 'eng' };
    const passing = { url: 'https://subs.example.com/other.srt', lang: 'eng' };
    // A file the planner is reading is not downloaded again.
    const shown = loadSubtitles(kept);
    expect(loadSubtitles(kept, { keep: false })).toBe(shown);
    await shown;
    expect(fetched).toBe(1);
    // One read only to be lined up is shared while it downloads, and then forgotten.
    const first = loadSubtitles(passing, { keep: false });
    expect(loadSubtitles(passing, { keep: false })).toBe(first);
    await first;
    expect(fetched).toBe(2);
    await loadSubtitles(passing, { keep: false });
    expect(fetched).toBe(3);
    // Asked to keep it while it downloads, it is kept from then on.
    const again = loadSubtitles(passing, { keep: false });
    expect(loadSubtitles(passing)).toBe(again);
    await again;
    await loadSubtitles(passing);
    expect(fetched).toBe(4);
    clearSubtitleCache();
  });

  it('stops reading a file with no declared size once it passes 5 MB', async () => {
    const { stream, read } = counted(50 * MB);
    serve(stream);
    await expect(
      loadSubtitles({ url: 'https://subs.example.com/endless.srt', lang: 'eng' }),
    ).rejects.toThrow('too big');
    expect(read.bytes).toBeLessThan(6 * MB);
  });

  it('stops unpacking a small gzip that grows past 5 MB', async () => {
    const unpacked = counted(50 * MB);
    // Any gzip unpacks to the 50 MB body.
    class Decompression {
      writable = new WritableStream();
      readable = unpacked.stream;
    }
    vi.stubGlobal('DecompressionStream', Decompression);
    serve(new Blob([new Uint8Array([0x1f, 0x8b, 8, 0])]).stream());
    await expect(
      loadSubtitles({ url: 'https://subs.example.com/bomb.srt.gz', lang: 'eng' }),
    ).rejects.toThrow('too big');
    expect(unpacked.read.bytes).toBeLessThan(6 * MB);
  });
});

describe('the files on offer, and the video’s hash', () => {
  const VIDEO = 'tt6151526:1:6';
  const OTHER = { id: 'org.example.subtitles', name: 'Other subtitles' };
  const OPENSUBTITLES = { id: OPENSUBTITLES_V3_ID, name: 'OpenSubtitles v3' };
  const stream = (hints: Record<string, unknown> = {}) =>
    ({
      source: { kind: 'url', url: 'https://debrid.example.com/d/KEY/Film.mkv' },
      subtitles: [],
      behaviorHints: { filename: 'Film.mkv', ...hints },
    }) as unknown as Stream;
  const file = (id: string, hashMatch = false): Subtitle => ({
    id,
    url: `https://subs.example.com/${id}.srt`,
    lang: 'eng',
    ...(hashMatch && { hashMatch: true }),
  });
  const found = (ms: number): HashReading => ({
    found: { videoHash: '8e245d9679d31e12', videoSize: 1234567890 },
    ms,
    walks: 1,
  });
  /** Lets the hash read finish now, as it reads. */
  const hashRead = async (reading: HashReading) => {
    net.hash!(reading);
    await vi.advanceTimersByTimeAsync(0);
  };
  const hashOf = () => recentSubtitleTraces()[0]?.hash;

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    vi.stubGlobal('window', globalThis);
    net.addons = [OPENSUBTITLES, OTHER];
    net.asks = [];
    net.hash = null;
    net.hashes = 0;
    forgetSubtitleTraces();
    startSubtitleTrace(VIDEO, 0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once, with the hash, when it is read within the wait', async () => {
    const list = subtitleList('series', VIDEO, stream(), 'Streams');
    list.start();
    // Nothing asked while the hash is read, and the list says it is still looking.
    expect(net.asks).toHaveLength(0);
    expect(list.get().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await hashRead(found(1000));
    expect(net.asks).toHaveLength(1);
    expect(net.asks[0]).toMatchObject({ at: 1000, hints: { videoHash: '8e245d9679d31e12' } });
    expect(hashOf()).toEqual({ state: 'read', ms: 1000 });
    // The wait's timer asks nothing more.
    await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
    expect(net.asks).toHaveLength(1);
    expect(list.get()).toMatchObject({ pending: 2 });
    expect(list.get().hashComing).toBeUndefined();
  });

  it('asks without the hash after the wait, then asks OpenSubtitles again when it comes, and merges the answers', async () => {
    const list = subtitleList('series', VIDEO, stream(), 'Streams');
    list.start();
    await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
    expect(net.asks).toHaveLength(1);
    expect(net.asks[0]!.at).toBe(HASH_WAIT_MS);
    expect(net.asks[0]!.hints.videoHash).toBeUndefined();
    expect(hashOf()).toEqual({ state: 'reading', askedAtMs: HASH_WAIT_MS });
    const [os, other] = net.asks[0]!.answers;
    os!.query.answer([file('a'), file('b'), file('c')]);
    other!.query.answer([file('x')]);
    // Both answered, but the hash may still link files: the list is not done, and says so. The
    // one still to come is the hash, not an addon (`hashReading`).
    expect(list.get()).toMatchObject({ pending: 1, hashComing: true, hashReading: true });
    expect(list.get().options.map((option) => option.key)).toEqual([
      `${OPENSUBTITLES_V3_ID}#a`,
      `${OPENSUBTITLES_V3_ID}#b`,
      `${OPENSUBTITLES_V3_ID}#c`,
      `${OTHER.id}#x`,
    ]);

    await vi.advanceTimersByTimeAsync(3000);
    await hashRead(found(5000));
    // Asked again with it: OpenSubtitles only, which matches files by it.
    expect(net.asks).toHaveLength(2);
    expect(net.asks[1]!.at).toBe(5000);
    expect(net.asks[1]!.hints).toMatchObject({
      videoHash: '8e245d9679d31e12',
      filename: 'Film.mkv',
    });
    expect(
      net.asks[1]!.answers.filter((answer) => answer.query.get().status !== 'idle').map(
        (answer) => answer.addon.manifest.id,
      ),
    ).toEqual([OPENSUBTITLES_V3_ID]);
    // Now an addon is asked: OpenSubtitles again.
    expect(list.get()).toMatchObject({ pending: 1, hashComing: true });
    expect(list.get().hashReading).toBeUndefined();
    expect(hashOf()).toEqual({
      state: 'read',
      ms: 5000,
      late: { askedAtMs: HASH_WAIT_MS, askedAgain: 1 },
    });

    // Its answer: b linked, c dropped (the list is capped), d new and linked, e new.
    net.asks[1]!.answers[0]!.query.answer([file('b', true), file('a'), file('d', true), file('e')]);
    const state = list.get();
    expect(state.pending).toBe(0);
    expect(state.hashComing).toBeUndefined();
    expect(
      state.options.map((option) => [option.key, !!option.hashMatch, !!option.linkedLate]),
    ).toEqual([
      [`${OPENSUBTITLES_V3_ID}#a`, false, false],
      [`${OPENSUBTITLES_V3_ID}#b`, true, true],
      [`${OPENSUBTITLES_V3_ID}#c`, false, false],
      [`${OPENSUBTITLES_V3_ID}#d`, true, true],
      [`${OPENSUBTITLES_V3_ID}#e`, false, false],
      [`${OTHER.id}#x`, false, false],
    ]);
    expect(hashOf()).toEqual({
      state: 'read',
      ms: 5000,
      late: { askedAtMs: HASH_WAIT_MS, askedAgain: 1, linked: 2 },
    });
    expect(JSON.stringify(recentSubtitleTraces())).not.toContain('example');
  });

  it('says no answer came when OpenSubtitles asked again with a late hash fails', async () => {
    const list = subtitleList('series', VIDEO, stream(), 'Streams');
    list.start();
    await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
    net.asks[0]!.answers.forEach((answer) => answer.query.answer([file('a')]));
    await vi.advanceTimersByTimeAsync(3000);
    await hashRead(found(5000));
    net.asks[1]!.answers[0]!.query.fail();
    expect(list.get()).toMatchObject({ pending: 0 });
    expect(list.get().hashComing).toBeUndefined();
    // Not "none linked": nothing answered.
    expect(hashOf()).toEqual({
      state: 'read',
      ms: 5000,
      late: { askedAtMs: HASH_WAIT_MS, askedAgain: 1, failed: true },
    });
  });

  it('keeps nothing open once a late read fails, and asks no one again', async () => {
    const list = subtitleList('series', VIDEO, stream(), 'Streams');
    list.start();
    await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
    net.asks[0]!.answers.forEach((answer) => answer.query.answer([file('a')]));
    expect(list.get()).toMatchObject({ pending: 1, hashComing: true });
    await vi.advanceTimersByTimeAsync(4000);
    await hashRead({ failed: 'timed out', step: 'end', ms: 6000, walks: 1 });
    expect(net.asks).toHaveLength(1);
    expect(list.get().pending).toBe(0);
    expect(list.get().hashComing).toBeUndefined();
    expect(hashOf()).toEqual({
      state: 'failed',
      why: 'timed out',
      step: 'end',
      ms: 6000,
      askedAtMs: HASH_WAIT_MS,
    });
  });

  it('does not count the hash as still coming when no addon matches files by it', async () => {
    net.addons = [OTHER];
    const list = subtitleList('series', VIDEO, stream(), 'Streams');
    list.start();
    await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
    net.asks[0]!.answers[0]!.query.answer([file('x')]);
    expect(list.get().pending).toBe(0);
    expect(list.get().hashComing).toBeUndefined();
    await hashRead(found(2500));
    expect(net.asks).toHaveLength(1);
    expect(hashOf()).toMatchObject({ late: { askedAtMs: HASH_WAIT_MS, askedAgain: 0 } });
  });

  it('asks no one once stopped, before the wait or after it', async () => {
    const early = subtitleList('series', VIDEO, stream(), 'Streams');
    early.start();
    await vi.advanceTimersByTimeAsync(1000);
    early.stop();
    await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
    await hashRead(found(3000));
    expect(net.asks).toHaveLength(0);

    const later = subtitleList('series', VIDEO, stream(), 'Streams');
    later.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(net.asks).toHaveLength(1);
    later.stop();
    await hashRead(found(5000));
    expect(net.asks).toHaveLength(1);
  });

  it('asks at once, with no wait, when the addon sent the hash or there is no file link', async () => {
    const sent = subtitleList(
      'series',
      VIDEO,
      stream({ videoHash: '0123456789abcdef', videoSize: 99 }),
      'Streams',
    );
    sent.start();
    expect(net.asks).toHaveLength(1);
    expect(net.asks[0]!.hints).toMatchObject({ videoHash: '0123456789abcdef', videoSize: 99 });
    expect(net.hashes).toBe(0);
    const torrent = subtitleList(
      'series',
      VIDEO,
      {
        source: { kind: 'torrent', infoHash: 'abc' },
        subtitles: [],
        behaviorHints: {},
      } as unknown as Stream,
      'Streams',
    );
    torrent.start();
    expect(net.asks).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks at once when the hash is known already, or the link is not read', async () => {
    const list = subtitleList('series', VIDEO, stream(), 'Streams');
    list.start();
    // A link read before answers at once: before the wait's timer, which it stops.
    await hashRead({ ...found(0), ms: 0 });
    expect(net.asks).toHaveLength(1);
    expect(net.asks[0]!.at).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const skipped = subtitleList('series', VIDEO, stream(), 'Streams');
    skipped.start();
    await hashRead({ skipped: 'playlist', ms: 0 });
    expect(net.asks).toHaveLength(2);
    expect(hashOf()).toEqual({ state: 'skipped', why: 'playlist' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('mergeHashAnswer', () => {
  /*
   * OpenSubtitles' answers for Night of the Living Dead (1968), asked without the video's hash
   * and with it: each file's id, language and how it was found ('h' by the hash), in order.
   */
  const parse = (text: string): ListedSubtitle[] =>
    text
      .trim()
      .split(/\s+/)
      .map((entry) => {
        const [id, lang, m] = entry.split(':') as [string, string, string];
        return {
          id,
          url: `https://subs.example.com/${id}.srt`,
          lang,
          ...(m === 'h' && { hashMatch: true }),
        };
      });
  const WITHOUT = parse(`
    3093321:pob:i 3280670:pob:i 43905:pob:i 87559:pob:i 3367057:pob:i 3541764:pob:i
    3763030:spa:i 75937:spa:i 3249642:spa:i 3700720:spa:i 201167:spa:i 3611607:spa:i
    61413:spa:i 100570:spa:i 3263851:spa:i 3264512:spa:i 99835:spa:i 39530:spa:i 94118:spa:i
    66585:spa:i 71301:spa:i 51292:spa:i 75303:spa:i 3372616:spa:i 3910290:spa:i 4025513:eng:i
    3571789:eng:i 3614689:eng:i 55145:swe:i 4109:cze:i 3955:cze:i 4803:cze:i 9580:cze:i
    16941:cze:i 16927:cze:i 3645:cze:i 5823:cze:i 92494:cze:i 118541:cze:i 3308823:cze:i
    91589:cze:i 91533:cze:i 3098663:cze:i 3815064:cze:i 59227:fre:i 154339:fre:i 68456:fre:i
    122388:fre:i 59228:fre:i 148384:fre:i 102633:fre:i 3385129:fre:i 125892:fre:i
    3323484:fre:i 61415:por:i 117560:por:i 147174:por:i 3544344:por:i 61416:hun:i
    3543708:hun:i 125982:bul:i 6577:slo:i 49525:srp:i 3572078:srp:i 3891584:srp:i 31853:fin:i
    239802:ron:i 46862:lav:i 3389054:pol:i
  `);
  const WITH = parse(`
    3093321:pob:h 3367057:pob:h 3280670:pob:i 43905:pob:i 87559:pob:i 3543708:hun:h
    61416:hun:i 3572078:srp:h 3891584:srp:h 49525:srp:i 5400079:bos:h 239802:ron:h
    4815285:ron:h 148384:fre:h 59227:fre:i 154339:fre:i 68456:fre:i 122388:fre:i 59228:fre:i
    102633:fre:i 125892:fre:i 3263851:spa:h 3372616:spa:h 3910290:spa:h 75937:spa:i
    3249642:spa:i 201167:spa:i 61413:spa:i 100570:spa:i 3264512:spa:i 99835:spa:i 39530:spa:i
    94118:spa:i 66585:spa:i 71301:spa:i 51292:spa:i 75303:spa:i 3614689:eng:h 4256041:eng:h
    4907923:ell:h 3389054:pol:h 5878054:slv:h 3815064:cze:h 4109:cze:i 3955:cze:i 4803:cze:i
    9580:cze:i 16941:cze:i 16927:cze:i 3645:cze:i 5823:cze:i 92494:cze:i 118541:cze:i
    3308823:cze:i 91589:cze:i 91533:cze:i 3098663:cze:i 5044849:tur:h 5005930:bul:h
    125982:bul:i 55145:swe:i 61415:por:i 117560:por:i 147174:por:i 6577:slo:i 31853:fin:i
    46862:lav:i
  `);

  it('keeps every file listed first in its place, marks the linked ones, and adds the rest after', () => {
    const merged = mergeHashAnswer(WITHOUT, WITH);
    expect(merged.slice(0, WITHOUT.length).map((file) => file.id)).toEqual(
      WITHOUT.map((file) => file.id),
    );
    expect({
      without: WITHOUT.length,
      with: WITH.length,
      merged: merged.length,
      linked: merged.filter((file) => file.hashMatch).length,
      linkedLate: merged.filter((file) => file.linkedLate).length,
      added: merged.length - WITHOUT.length,
      addedLinked: merged.slice(WITHOUT.length).filter((file) => file.linkedLate).length,
    }).toEqual({
      without: 69,
      with: 67,
      merged: 76,
      linked: 20,
      linkedLate: 20,
      added: 7,
      addedLinked: 7,
    });
    // The new ones in the second answer's order.
    expect(merged.slice(WITHOUT.length).map((file) => file.id)).toEqual([
      '5400079',
      '4815285',
      '4256041',
      '4907923',
      '5878054',
      '5044849',
      '5005930',
    ]);
  });

  it('marks nothing late that the first answer found by the hash already', () => {
    const first = [{ id: '1', url: 'u1', lang: 'eng', hashMatch: true }];
    expect(mergeHashAnswer(first, first)).toEqual(first);
  });
});

describe('SubDL in the files on offer', () => {
  const VIDEO = 'tt9900001';
  const RELEASE = 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA';
  const OPENSUBTITLES = { id: OPENSUBTITLES_V3_ID, name: 'OpenSubtitles v3' };
  const stream = {
    source: { kind: 'url', url: 'https://debrid.example.com/d/KEY/Film.mkv' },
    subtitles: [{ id: 'own', url: 'https://streams.example.com/own.srt', lang: 'eng' }],
    behaviorHints: { filename: `${RELEASE}.mkv`, videoHash: '0123456789abcdef', videoSize: 9 },
  } as unknown as Stream;
  const ask = { languages: ['en'], release: { filename: `${RELEASE}.mkv`, title: 'Test Film' } };
  const subdlFile = (id: string, label: string, extra: Partial<SubdlFile> = {}): SubdlFile => ({
    id,
    url: `https://dl.subdl.com/subtitle/${id}`,
    lang: 'en',
    label,
    releases: [],
    ...extra,
  });
  const osFile = (id: string): Subtitle => ({
    id,
    url: `https://subs.example.com/${id}.srt`,
    lang: 'eng',
    label: `Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPB.${id}.srt`,
  });

  beforeEach(() => {
    net.addons = [OPENSUBTITLES];
    net.asks = [];
    subdlNet.searches = [];
    subdlNet.resting = false;
    subdlNet.downloadsLeft = true;
    forgetSubtitleTraces();
    startSubtitleTrace(VIDEO, 0);
  });

  it('comes after the stream’s and the addons’ files, by match, without the same link twice', () => {
    const list = subtitleList('movie', VIDEO, stream, 'Streams', ask);
    list.start();
    expect(subdlNet.searches).toHaveLength(1);
    expect(subdlNet.searches[0]).toMatchObject({ wanted: ['en'], loaded: true });
    net.asks[0]!.answers[0]!.query.answer([osFile('os1')]);
    subdlNet.searches[0]!.set({
      status: 'answered',
      ms: 600,
      saved: false,
      files: [
        subdlFile('1', 'Test.Film.2026.720p.HDTV-OTHER'),
        { ...subdlFile('2', 'Test.Film.2026.Remux'), url: 'https://subs.example.com/os1.srt' },
        subdlFile('3', 'Test.Film.2026', { releases: [RELEASE, 'Test.Film.2026.BluRay-X'] }),
      ],
    });
    const { options, pending } = list.get();
    expect(pending).toBe(0);
    expect(options.map((option) => option.key)).toEqual([
      'stream#own',
      `${OPENSUBTITLES_V3_ID}#os1`,
      'subdl#3',
      'subdl#1',
    ]);
    expect(options[2]).toMatchObject({ source: 'SubDL', releaseName: RELEASE, lang: 'en' });
    expect(recentSubtitleTraces()[0]!.subdl).toEqual({
      state: 'answered',
      files: { en: 3 },
      ms: 600,
      saved: false,
    });
  });

  it('lists at most 20 of its files in a language', () => {
    const list = subtitleList('movie', VIDEO, stream, 'Streams', ask);
    list.start();
    const files = Array.from({ length: 30 }, (_, i) => subdlFile(`e${i}`, `Test.Film.${i}`));
    files.push(subdlFile('fr1', 'Test.Film.fr', { lang: 'fr' }));
    subdlNet.searches[0]!.set({ status: 'answered', ms: 1, saved: false, files });
    const options = list.get().options.filter((option) => option.source === 'SubDL');
    expect(options.filter((option) => option.lang === 'en')).toHaveLength(20);
    expect(options.filter((option) => option.lang === 'fr')).toHaveLength(1);
  });

  it('files its one Spanish and its Chinese under Latin American Spanish and simplified Chinese when those were asked', () => {
    for (const [wanted, sent, listed] of [
      [['es-419'], 'es', 'es-419'],
      [['zh-hans'], 'zh', 'zh-hans'],
      [['es-419', 'es'], 'es', 'es'],
      [['en'], 'es', 'es'],
    ] as const) {
      subdlNet.searches = [];
      const list = subtitleList('movie', VIDEO, stream, 'Streams', { ...ask, languages: wanted });
      list.start();
      subdlNet.searches[0]!.set({
        status: 'answered',
        ms: 1,
        saved: false,
        files: [subdlFile('s1', 'Test.Film.2026', { lang: sent })],
      });
      const [file] = list.get().options.filter((option) => option.source === 'SubDL');
      expect(file?.lang).toBe(listed);
      list.stop();
    }
  });

  it('counts its search as still to answer until it answers, fails or gives up', () => {
    for (const end of [
      { status: 'answered', files: [], ms: 1, saved: false },
      { status: 'failed', why: 'timeout', ms: 8000 },
      { status: 'off', why: 'resting' },
    ]) {
      subdlNet.searches = [];
      net.asks = [];
      const list = subtitleList('movie', VIDEO, stream, 'Streams', ask);
      list.start();
      net.asks[0]!.answers[0]!.query.answer([]);
      expect(list.get().pending).toBe(1);
      subdlNet.searches[0]!.set(end);
      expect(list.get().pending).toBe(0);
      list.stop();
    }
  });

  it('leaves the addons’ files as they were when it fails, showing an older answer meanwhile', () => {
    const list = subtitleList('movie', VIDEO, stream, 'Streams', ask);
    list.start();
    net.asks[0]!.answers[0]!.query.answer([osFile('os1'), osFile('os2')]);
    const before = list.get().options;
    subdlNet.searches[0]!.set({ status: 'failed', why: 'server', ms: 300 });
    expect(list.get().options).toEqual(before);
    subdlNet.searches[0]!.set({
      status: 'failed',
      why: 'server',
      ms: 300,
      files: [subdlFile('old', 'Test.Film.old')],
    });
    expect(list.get().options.slice(0, before.length)).toEqual(before);
    expect(list.get().options[list.get().options.length - 1]!.key).toBe('subdl#old');
    expect(recentSubtitleTraces()[0]!.subdl).toEqual({
      state: 'failed',
      why: 'server',
      ms: 300,
      saved: { en: 1 },
    });
  });

  it('is never asked again by a hash read late', async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const reading = { ...stream, behaviorHints: { filename: `${RELEASE}.mkv` } } as Stream;
      const list = subtitleList('movie', VIDEO, reading, 'Streams', ask);
      list.start();
      expect(subdlNet.searches).toHaveLength(1);
      // SubDL answering while the hash is read leaves the addons still to be asked.
      subdlNet.searches[0]!.set({ status: 'answered', files: [], ms: 1, saved: false });
      expect(list.get().pending).toBe(1);
      await vi.advanceTimersByTimeAsync(HASH_WAIT_MS);
      net.hash!({ found: { videoHash: '8e245d9679d31e12', videoSize: 1 }, ms: 3000, walks: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(net.asks).toHaveLength(2);
      expect(subdlNet.searches).toHaveLength(1);
      list.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks once more for a language turned on that it was not asked for, and never a third time', () => {
    const list = subtitleList('movie', VIDEO, stream, 'Streams', ask);
    list.start();
    list.askSubdl('eng');
    expect(subdlNet.searches).toHaveLength(1);
    list.askSubdl('und');
    expect(subdlNet.searches).toHaveLength(1);
    list.askSubdl('fre');
    expect(subdlNet.searches).toHaveLength(2);
    expect(subdlNet.searches[1]).toMatchObject({ wanted: ['fre'], loaded: true });
    expect(list.get().pending).toBe(1 + 1 + 1);
    subdlNet.searches[1]!.set({
      status: 'answered',
      files: [subdlFile('f', 'Test.Film.fr', { lang: 'fr' })],
      ms: 2,
      saved: false,
    });
    expect(recentSubtitleTraces()[0]!.subdlMore).toEqual({ language: 'fr', files: 1 });
    list.askSubdl('de');
    expect(subdlNet.searches).toHaveLength(2);
    list.stop();
    expect(subdlNet.searches.every((search) => search.stopped)).toBe(true);
  });

  it('asks once more after a play with subtitles off, but not without a key or while resting', () => {
    const off = subtitleList('movie', VIDEO, stream, 'Streams', { ...ask, languages: [] });
    off.start();
    subdlNet.searches[0]!.set({ status: 'off', why: 'subtitles off' });
    off.askSubdl('en');
    expect(subdlNet.searches).toHaveLength(2);
    subdlNet.searches = [];
    const noKey = subtitleList('movie', VIDEO, stream, 'Streams', ask);
    noKey.start();
    subdlNet.searches[0]!.set({ status: 'off', why: 'no key' });
    noKey.askSubdl('fr');
    expect(subdlNet.searches).toHaveLength(1);
    subdlNet.searches = [];
    subdlNet.resting = true;
    const resting = subtitleList('movie', VIDEO, stream, 'Streams', ask);
    resting.start();
    resting.askSubdl('fr');
    expect(subdlNet.searches).toHaveLength(1);
  });

  it('is not asked without what to ask', () => {
    const list = subtitleList('movie', VIDEO, stream, 'Streams');
    list.start();
    list.askSubdl('fr');
    expect(subdlNet.searches).toHaveLength(0);
    expect(recentSubtitleTraces()[0]!.subdl).toBeUndefined();
  });
});

describe('bestSubdlRelease', () => {
  const video = { filename: 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA.mkv' };
  it('takes the release that matches the video best, other than the label', () => {
    expect(
      bestSubdlRelease(
        {
          label: 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA',
          releases: [
            'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA',
            'Test.Film.2026.720p.BluRay.x264-GRPB',
            'Test.Film.2026.1080p.WEB-DL.H.264-GRPA',
          ],
        },
        video,
      ),
    ).toBe('Test.Film.2026.1080p.WEB-DL.H.264-GRPA');
    expect(
      bestSubdlRelease(
        { label: 'x', releases: ['Test.Film.2026.720p.BluRay-GRPB', 'Other'] },
        video,
      ),
    ).toBe('Test.Film.2026.720p.BluRay-GRPB');
    expect(bestSubdlRelease({ label: 'x', releases: [] }, video)).toBeUndefined();
  });
});

describe('capSubdlFiles', () => {
  it('keeps every file not SubDL’s, and the first of SubDL’s', () => {
    const files = ['os#1', 'subdl#1', 'subdl#2', 'os#2', 'subdl#3'].map((key) => ({ key }));
    expect(capSubdlFiles(files, 2).map((file) => file.key)).toEqual([
      'os#1',
      'subdl#1',
      'subdl#2',
      'os#2',
    ]);
    expect(capSubdlFiles(files, 0).map((file) => file.key)).toEqual(['os#1', 'os#2']);
  });
});

describe('a SubDL download', () => {
  const FAKE = 'FAKE-SUBDL-KEY-0000';
  const encode = (text: string) => new TextEncoder().encode(text);
  const srt = (line: string) => `1\n00:00:01,000 --> 00:00:02,000\n${line}\n`;

  /** A ZIP of stored files, as SubDL sends a release. */
  function storedZip(files: Array<[string, string]>): Uint8Array {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const [name, text] of files) {
      const data = encode(text);
      const nameBytes = encode(name);
      const local = new Uint8Array(30 + nameBytes.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint32(14, crc32(data), true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      const entry = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(entry.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint32(16, crc32(data), true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      entry.set(nameBytes, 46);
      parts.push(local);
      central.push(entry);
      offset += local.length;
    }
    const size = central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, size, true);
    ev.setUint32(16, offset, true);
    const all = [...parts, ...central, end];
    const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of all) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  const fetched: string[] = [];
  beforeEach(() => {
    fetched.length = 0;
    subdlNet.downloadsLeft = true;
    clearSubtitleCache();
  });
  const serveBytes = (bytes: Uint8Array) =>
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return Promise.resolve(new Response(bytes.slice()));
    });
  const lines = (cues: Awaited<ReturnType<typeof loadSubtitles>>) =>
    cues.map((cue) => cue.lines[0]![0]!.text);

  it('opens a ZIP, and takes the episode of a pack from the link, which it never sends', async () => {
    serveBytes(
      storedZip([
        ['Test.Show.S02E02.srt', srt('Line 2')],
        ['Test.Show.S02E03.srt', srt('Line 3')],
      ]),
    );
    const cues = await loadSubtitles({
      url: 'https://dl.subdl.com/subtitle/9000002-9100002.zip#s2e3',
      lang: 'en',
    });
    expect(lines(cues)).toEqual(['Line 3']);
    expect(fetched).toEqual(['https://dl.subdl.com/subtitle/9000002-9100002.zip']);
    serveBytes(storedZip([['Test.Film.srt', srt('Line 1')]]));
    expect(
      lines(await loadSubtitles({ url: 'https://dl.subdl.com/subtitle/1-2.zip', lang: 'en' })),
    ).toEqual(['Line 1']);
    for (const url of fetched) expect(url).not.toContain(FAKE);
  });

  it('says an archive that cannot be read could not be, and a pack without the episode', async () => {
    serveBytes(storedZip([['Test.Show.S02E02.srt', srt('Line 2')]]));
    await expect(
      loadSubtitles({ url: 'https://dl.subdl.com/subtitle/3-4.zip#s2e3', lang: 'en' }),
    ).rejects.toThrow('The subtitle archive could not be read');
  });

  it('makes no request once the day’s SubDL downloads are used up', async () => {
    serveBytes(encode(srt('Line 1')));
    subdlNet.downloadsLeft = false;
    await expect(
      loadSubtitles({ url: 'https://dl.subdl.com/subtitle/9000001/9300001', lang: 'en' }),
    ).rejects.toThrow('SubDL files are used up for today');
    expect(fetched).toEqual([]);
    // Another addon's files are not counted.
    expect(
      lines(await loadSubtitles({ url: 'https://subs.example.com/a.srt', lang: 'en' })),
    ).toEqual(['Line 1']);
  });
});
