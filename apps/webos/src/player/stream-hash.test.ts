import type { Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHash,
  forgetHashes,
  HASH_CHUNK,
  forgetLanding,
  HASH_TIMEOUT_MS,
  hashReadingFor,
  hashSkip,
  hashStream,
  NATIVE_READ_MS,
  openSubtitlesHash,
  readStreamHash,
  takeLanding,
} from './stream-hash';
import { noteRequestHeaders } from './request-headers';

/**
 * The hash as OpenSubtitles defines it, worked another way to check against:
 * in 32-bit halves (the app's lib has no BigInt).
 */
function reference(size: number, head: Uint8Array, tail: Uint8Array): string {
  let low = size % 2 ** 32;
  let high = Math.floor(size / 2 ** 32);
  for (const chunk of [head, tail]) {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let at = 0; at < chunk.length; at += 8) {
      low += view.getUint32(at, true);
      high += view.getUint32(at + 4, true) + Math.floor(low / 2 ** 32);
      low %= 2 ** 32;
      high %= 2 ** 32;
    }
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}

/** Bytes that differ along the file, so a read from the wrong place gives another hash. */
function file(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let seed = 7;
  for (let i = 0; i < size; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    bytes[i] = seed >> 16;
  }
  return bytes;
}

/**
 * An answer as a browser's fetch gives it: where it landed, and its type ('basic' with every
 * header readable, 'cors' filtered for a page on another origin, 'default' from React Native).
 */
function answer(response: Response, landed: string, type: ResponseType = 'basic'): Response {
  Object.defineProperty(response, 'url', { value: landed });
  Object.defineProperty(response, 'type', { value: type });
  return response;
}

/**
 * A server for one file: byte ranges, and whether a cross-origin page may read Content-Range
 * (with it hidden, the answers are CORS-filtered ones, whose Content-Length still comes through).
 */
function serve(bytes: Uint8Array, options: { ranges?: boolean; showRange?: boolean } = {}) {
  const asked: string[] = [];
  const type: ResponseType = options.showRange === false ? 'cors' : 'basic';
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    asked.push(range ?? 'whole');
    const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (!match || options.ranges === false) {
      return Promise.resolve(
        answer(
          new Response(bytes.slice(0, 16), {
            status: 200,
            headers: { 'content-length': String(bytes.length) },
          }),
          url,
          type,
        ),
      );
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const headers: Record<string, string> = { 'content-length': String(end - start + 1) };
    if (options.showRange !== false)
      headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`;
    return Promise.resolve(
      answer(new Response(bytes.slice(start, end + 1), { status: 206, headers }), url, type),
    );
  });
  return asked;
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  forgetHashes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the OpenSubtitles hash', () => {
  it('matches the definition, carries included', () => {
    const size = 3 * HASH_CHUNK + 5;
    const bytes = file(size);
    const head = bytes.slice(0, HASH_CHUNK);
    const tail = bytes.slice(size - HASH_CHUNK);
    expect(openSubtitlesHash(size, head, tail)).toBe(reference(size, head, tail));
    const full = new Uint8Array(HASH_CHUNK).fill(0xff);
    expect(openSubtitlesHash(2 ** 40, full, full)).toBe(reference(2 ** 40, full, full));
  });

  it('gives nothing for a file shorter than both chunks, or chunks cut short', () => {
    const chunk = new Uint8Array(HASH_CHUNK);
    expect(openSubtitlesHash(HASH_CHUNK, chunk, chunk)).toBeUndefined();
    expect(openSubtitlesHash(4 * HASH_CHUNK, chunk.slice(1), chunk)).toBeUndefined();
  });
});

describe('reading the hash of a stream', () => {
  const url = 'https://debrid.example.com/d/abc/Film.2023.1080p.WEB-DL.mkv';

  it('reads both ends with two ranges, and asks once per link', async () => {
    const size = 5 * HASH_CHUNK + 123;
    const bytes = file(size);
    const asked = serve(bytes);
    const expected = reference(size, bytes.slice(0, HASH_CHUNK), bytes.slice(size - HASH_CHUNK));
    await expect(hashStream(url)).resolves.toEqual({ videoHash: expected, videoSize: size });
    await hashStream(url);
    expect(asked).toEqual([`bytes=0-${HASH_CHUNK - 1}`, `bytes=${size - HASH_CHUNK}-${size - 1}`]);
  });

  it('finds the size another way when the server hides Content-Range from the app', async () => {
    const size = 4 * HASH_CHUNK;
    const bytes = file(size);
    const asked = serve(bytes, { showRange: false });
    const found = await hashStream(url);
    expect(found?.videoSize).toBe(size);
    expect(asked).toEqual([
      `bytes=0-${HASH_CHUNK - 1}`,
      'whole',
      `bytes=${3 * HASH_CHUNK}-${size - 1}`,
    ]);
    forgetHashes();
    // Or from the addon, when it said.
    const again = serve(bytes, { showRange: false });
    expect((await hashStream(url, size))?.videoSize).toBe(size);
    expect(again).toHaveLength(2);
  });

  it('gives up on a server that ignores ranges, and tries again next time', async () => {
    const asked = serve(file(4 * HASH_CHUNK), { ranges: false });
    await expect(hashStream(url)).resolves.toBeUndefined();
    await hashStream(url);
    expect(asked).toHaveLength(2);
  });

  it('gives up when the file cannot be reached, or takes too long', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(hashStream(url)).resolves.toBeUndefined();
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal(
      'fetch',
      (_: string, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    const slow = hashStream(`${url}?slow`);
    vi.advanceTimersByTime(HASH_TIMEOUT_MS);
    await expect(slow).resolves.toBeUndefined();
  });

  it('leaves playlists alone', () => {
    expect(canHash(url)).toBe(true);
    expect(canHash('https://live.example.com/match/master.m3u8')).toBe(false);
    expect(canHash('https://cdn.example.com/film/manifest.mpd')).toBe(false);
    expect(canHash('magnet:?xt=urn:btih:abc')).toBe(false);
  });

  it('never reads a link whose addon asked for request headers', async () => {
    const guarded = 'https://cdn.example.com/needs-headers/film.mkv';
    noteRequestHeaders({
      source: { kind: 'url', url: guarded },
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/' } } },
    } as unknown as Stream);
    expect(canHash(guarded)).toBe(false);
    const asked = serve(file(3 * HASH_CHUNK));
    await expect(hashStream(guarded, 3 * HASH_CHUNK)).resolves.toBeUndefined();
    expect(asked).toEqual([]);
    // Listed again without headers, it is one file like any other.
    noteRequestHeaders({ source: { kind: 'url', url: guarded }, behaviorHints: {} } as Stream);
    expect(canHash(guarded)).toBe(true);
  });

  it('says why a hash was not read, for Diagnostics, and never the link', async () => {
    expect(hashSkip('https://live.example.com/match/master.m3u8')).toBe('playlist');
    expect(hashSkip('magnet:?xt=urn:btih:abc')).toBe('not a file link');
    expect(await readStreamHash('https://cdn.example.com/film/manifest.mpd')).toEqual({
      skipped: 'playlist',
      ms: 0,
    });
    serve(file(4 * HASH_CHUNK), { ranges: false });
    expect(await readStreamHash(url)).toMatchObject({ failed: 'no range' });
    serve(file(HASH_CHUNK + 10));
    expect(await readStreamHash(url)).toMatchObject({ failed: 'too small' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const refused = await readStreamHash(url);
    expect(refused).toMatchObject({ failed: 'refused' });
    expect(JSON.stringify(refused)).not.toContain('example');
    serve(file(4 * HASH_CHUNK));
    expect(await readStreamHash(url)).toMatchObject({ found: { videoSize: 4 * HASH_CHUNK } });
  });
});

describe('reading the hash through a link that redirects twice', () => {
  // As on the TV: the addon's resolve link, 302 to the debrid service, 307 to its CDN.
  const LINK = 'https://resolve.example.com/resolve/debrid/KEY/abc/Film.2023.2160p.WEB-DL.mkv';
  const API = 'https://api.example.com/dl';
  const CDN = 'https://cdn.example.com/f/1/Film.2023.2160p.WEB-DL.mkv';
  const size = 6 * HASH_CHUNK + 321;
  const bytes = file(size);
  const expected = reference(size, bytes.slice(0, HASH_CHUNK), bytes.slice(size - HASH_CHUNK));
  const head = `bytes=0-${HASH_CHUNK - 1}`;
  const tail = `bytes=${size - HASH_CHUNK}-${size - 1}`;

  interface Chain {
    /** The answers' type: 'cors' behind CORS, 'basic' with the checks off (webOS), 'default' RN. */
    type?: ResponseType;
    /** Content-Range can be read behind CORS (the host exposes it). */
    showRange?: boolean;
    /** A 206's own Content-Length can be read behind CORS (Chromium 76 and later). */
    showLength?: boolean;
    /** Each CDN link works once: a second read straight to it is refused (403). */
    oneUse?: boolean;
    /** The fetch can't say where it landed (an old fetch polyfill): its url is ''. */
    noUrl?: boolean;
  }

  /**
   * Serves the chain, a new CDN token for each walk through it, and logs every hop of every
   * request with its range.
   */
  function serveChain(chain: Chain = {}) {
    const asked: Array<{ url: string; range: string }> = [];
    let minted = 0;
    const used = new Set<string>();
    const cors = chain.type === 'cors';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('', 'AbortError');
      const range = (init?.headers as Record<string, string> | undefined)?.Range ?? 'whole';
      let at = url;
      for (;;) {
        asked.push({ url: at, range });
        if (at === LINK) at = API;
        else if (at === API) at = `${CDN}?token=t${++minted}`;
        else break;
      }
      if (!at.startsWith(CDN)) throw new TypeError('Failed to fetch');
      const landed = chain.noUrl ? '' : at;
      if (chain.oneUse && used.has(at)) {
        return answer(new Response('', { status: 403 }), landed, chain.type);
      }
      used.add(at);
      const match = /bytes=(\d+)-(\d+)/.exec(range);
      if (!match) {
        const headers: Record<string, string> =
          cors && !chain.showLength ? {} : { 'content-length': String(bytes.length) };
        return answer(
          new Response(bytes.slice(0, 16), { status: 200, headers }),
          landed,
          chain.type,
        );
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      const headers: Record<string, string> = {};
      if (!cors || chain.showLength) headers['content-length'] = String(end - start + 1);
      if (!cors || chain.showRange) headers['content-range'] = `bytes ${start}-${end}/${size}`;
      return answer(
        new Response(bytes.slice(start, end + 1), { status: 206, headers }),
        landed,
        chain.type,
      );
    });
    return asked;
  }

  /** The requests that started at the stream's own link: each one walks both redirects. */
  const walks = (asked: ReadonlyArray<{ url: string }>) =>
    asked.filter((hop) => hop.url === LINK).length;
  /** The ranges asked straight of the CDN, or at the end of a walk. */
  const toCdn = (asked: ReadonlyArray<{ url: string; range: string }>) =>
    asked.filter((hop) => hop.url.startsWith(CDN)).map((hop) => hop.range);

  it('walks the redirects once, and reads the end straight from where they led', async () => {
    const asked = serveChain({ type: 'basic' });
    const reading = await readStreamHash(LINK);
    expect(reading).toEqual({
      found: { videoHash: expected, videoSize: size },
      ms: expect.any(Number),
      walks: 1,
    });
    expect(walks(asked)).toBe(1);
    // Four HTTP exchanges: the walk's three hops, then the end from the CDN.
    expect(asked.map((hop) => hop.url.replace(/\?.*$/, ''))).toEqual([LINK, API, CDN, CDN]);
    expect(toCdn(asked)).toEqual([head, tail]);
    // The end was read with the token the walk was given: one link at the CDN, not two.
    expect(new Set(asked.filter((hop) => hop.url.startsWith(CDN)).map((hop) => hop.url)).size).toBe(
      1,
    );
  });

  it('asks the size there too when CORS hides Content-Range but lets Content-Length through', async () => {
    const asked = serveChain({ type: 'cors', showLength: true });
    expect((await readStreamHash(LINK)).found).toEqual({ videoHash: expected, videoSize: size });
    expect(walks(asked)).toBe(1);
    expect(toCdn(asked)).toEqual([head, 'whole', tail]);
    expect(asked).toHaveLength(5);
  });

  it('needs no size read where CORS lets Content-Range through', async () => {
    const asked = serveChain({ type: 'cors', showRange: true });
    expect((await readStreamHash(LINK)).found?.videoHash).toBe(expected);
    expect(toCdn(asked)).toEqual([head, tail]);
  });

  it('does not ask the size where the page could not read it either (Chromium 68 behind CORS)', async () => {
    const asked = serveChain({ type: 'cors' });
    expect(await readStreamHash(LINK)).toMatchObject({ failed: 'no size', step: 'size', walks: 1 });
    expect(toCdn(asked)).toEqual([head]);
    // Unless the addon said the size.
    forgetHashes();
    const sized = serveChain({ type: 'cors' });
    expect((await readStreamHash(LINK, size)).found?.videoHash).toBe(expected);
    expect(toCdn(sized)).toEqual([head, tail]);
    expect(walks(sized)).toBe(1);
  });

  it('never asks the size through React Native’s fetch, which would wait for the whole film', async () => {
    // React Native reads every header, so Content-Range is there.
    const asked = serveChain({ type: 'default' });
    expect((await readStreamHash(LINK)).found?.videoHash).toBe(expected);
    expect(toCdn(asked)).toEqual([head, tail]);
    // Even where the answer has no size to give: 'no size' at once, with no plain request.
    forgetHashes();
    const hidden = serveChain({ type: 'default' });
    vi.stubGlobal(
      'fetch',
      ((real: typeof fetch) => async (url: string, init?: RequestInit) => {
        const response = await real(url, init);
        const bare = new Response(await response.arrayBuffer(), { status: response.status });
        return answer(bare, response.url, 'default');
      })(globalThis.fetch),
    );
    expect(await readStreamHash(LINK)).toMatchObject({ failed: 'no size', step: 'size' });
    expect(toCdn(hidden)).not.toContain('whole');
  });

  it('goes back through the stream’s link once when the link it led to refuses a second read', async () => {
    const asked = serveChain({ type: 'basic', oneUse: true });
    const reading = await readStreamHash(LINK);
    expect(reading).toMatchObject({ found: { videoHash: expected }, fellBack: 'end', walks: 2 });
    expect(walks(asked)).toBe(2);
    // Start, the end refused at the first walk's link, then the end through a second walk.
    expect(toCdn(asked)).toEqual([head, tail, tail]);
  });

  it('sends every read after a refused one through the stream’s link, not to the link refused', async () => {
    // Behind CORS with the size to read, on links good for one use: the size is refused where the
    // first walk landed, so it and the end each walk once more, and the end is not tried there.
    const asked = serveChain({ type: 'cors', showLength: true, oneUse: true });
    const reading = await readStreamHash(LINK);
    expect(reading).toMatchObject({ found: { videoHash: expected }, fellBack: 'size', walks: 3 });
    expect(toCdn(asked)).toEqual([head, 'whole', 'whole', tail]);
  });

  it('keeps every read out of the browser’s cache, but for React Native’s fetch, which would change the link', async () => {
    const caches: Array<RequestCache | undefined> = [];
    const watch = () => {
      const chain = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        caches.push(init?.cache);
        return chain(url, init);
      });
    };
    serveChain({ type: 'cors', showLength: true });
    watch();
    expect((await readStreamHash(LINK)).found?.videoHash).toBe(expected);
    expect(caches.length).toBeGreaterThanOrEqual(3);
    expect(new Set(caches)).toEqual(new Set(['no-store']));
    forgetHashes();
    caches.length = 0;
    vi.stubGlobal('navigator', { product: 'ReactNative' });
    serveChain({ type: 'default' });
    watch();
    expect((await readStreamHash(LINK)).found?.videoHash).toBe(expected);
    expect(new Set(caches)).toEqual(new Set([undefined]));
  });

  it('gives each read 4 s at most through React Native’s fetch, which can’t stop at the headers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { product: 'ReactNative' });
    // A host that sends the whole film for a range: the fetch answers only once it is all in.
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    const reading = readStreamHash(LINK);
    await vi.advanceTimersByTimeAsync(NATIVE_READ_MS);
    // A range not kept to, not a refusal: not tried again through the stream's link.
    expect(await reading).toMatchObject({ failed: 'no range', step: 'start', ms: NATIVE_READ_MS });
  });

  it('gives up after that one try, saying which read failed', async () => {
    const asked = serveChain({ type: 'basic' });
    const chain = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range ?? '';
      return range.startsWith('bytes=0-')
        ? chain(url, init)
        : Promise.reject(new TypeError('Failed to fetch'));
    });
    expect(await readStreamHash(LINK)).toMatchObject({ failed: 'refused', step: 'end', walks: 2 });
    expect(walks(asked)).toBe(1);
  });

  it('hands the first bytes, where they came from and the size, once, to the same link’s reader', async () => {
    serveChain({ type: 'basic' });
    // Nothing before a read has started, and asking never starts one.
    expect(hashReadingFor(LINK)).toBeUndefined();
    expect(takeLanding(LINK)).toBeUndefined();
    const reading = readStreamHash(LINK);
    expect(hashReadingFor(LINK)).toBe(reading);
    await reading;
    // Another link's reader gets nothing, and leaves it for this one's.
    expect(takeLanding(`${LINK}?other`)).toBeUndefined();
    const landing = takeLanding(LINK);
    expect(landing?.landed).toBe(`${CDN}?token=t1`);
    expect(landing?.total).toBe(size);
    expect(Array.from(landing!.head)).toEqual(Array.from(bytes.slice(0, HASH_CHUNK)));
    // Once only, and none from a hash kept from before.
    expect(takeLanding(LINK)).toBeUndefined();
    expect(await readStreamHash(LINK)).toBe(await reading);
    expect(takeLanding(LINK)).toBeUndefined();
  });

  it('hands no size it did not see in a Content-Range', async () => {
    serveChain({ type: 'cors', showLength: true });
    await readStreamHash(LINK);
    const landing = takeLanding(LINK);
    expect(landing?.landed).toBe(`${CDN}?token=t1`);
    expect(landing?.total).toBeUndefined();
  });

  it('hands the bytes but not the link once that refused a read', async () => {
    serveChain({ type: 'basic', oneUse: true });
    expect(await readStreamHash(LINK)).toMatchObject({ fellBack: 'end' });
    const landing = takeLanding(LINK);
    expect(landing?.landed).toBeUndefined();
    expect(landing?.head.length).toBe(HASH_CHUNK);
  });

  it('keeps the newest reading’s outcome after it failed, until the player closes', async () => {
    serveChain({ type: 'basic' });
    const chain = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      await chain(url, init);
      return answer(new Response('', { status: 403 }), `${CDN}?token=t1`, 'basic');
    });
    const reading = readStreamHash(LINK);
    expect(await hashReadingFor(LINK)).toMatchObject({ failed: 'refused', step: 'start' });
    expect(hashReadingFor(LINK)).toBe(reading);
    expect(takeLanding(LINK)).toBeUndefined();
    // Another link's reading takes its place.
    serve(file(3 * HASH_CHUNK));
    await readStreamHash(`${LINK}?next`);
    expect(hashReadingFor(LINK)).toBeUndefined();
    forgetLanding();
    expect(takeLanding(`${LINK}?next`)).toBeUndefined();
    // The hash read is still kept by its link, for the subtitles asked again.
    expect(await hashReadingFor(`${LINK}?next`)).toMatchObject({ found: {} });
  });

  it('says the start read failed when the first one is refused, and walks no more', async () => {
    const asked = serveChain({ type: 'basic' });
    const chain = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      await chain(url, init);
      return answer(new Response('', { status: 403 }), `${CDN}?token=t1`, 'basic');
    });
    expect(await readStreamHash(LINK)).toMatchObject({
      failed: 'refused',
      step: 'start',
      walks: 1,
    });
    expect(walks(asked)).toBe(1);
  });

  it('reads both ends through the stream’s link when the fetch can’t say where it landed', async () => {
    const asked = serveChain({ type: 'basic', noUrl: true });
    expect(await readStreamHash(LINK)).toMatchObject({
      found: { videoHash: expected },
      walks: 2,
    });
    expect(walks(asked)).toBe(2);
  });

  it('never says the link, nor where it led', async () => {
    serveChain({ type: 'basic', oneUse: true });
    const found = JSON.stringify(await readStreamHash(LINK));
    forgetHashes();
    serveChain({ type: 'cors' });
    const failed = JSON.stringify(await readStreamHash(LINK));
    for (const said of [found, failed]) {
      for (const secret of ['example', 'token', 'KEY', 'http', 'mkv']) {
        expect(said).not.toContain(secret);
      }
    }
  });

  it('keeps a hash by the stream’s link, and reads it again for none of its walks', async () => {
    const asked = serveChain({ type: 'basic' });
    await readStreamHash(LINK);
    await readStreamHash(LINK);
    expect(walks(asked)).toBe(1);
  });

  it('says which read it was at when the time ran out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    let calls = 0;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        const response = new Response(bytes.slice(0, HASH_CHUNK), {
          status: 206,
          headers: { 'content-range': `bytes 0-${HASH_CHUNK - 1}/${size}` },
        });
        return Promise.resolve(answer(response, `${CDN}?token=t1`, 'basic'));
      }
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
      );
    });
    const slow = readStreamHash(LINK);
    await vi.advanceTimersByTimeAsync(HASH_TIMEOUT_MS - 1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(slow).resolves.toMatchObject({
      failed: 'timed out',
      step: 'end',
      ms: HASH_TIMEOUT_MS,
      walks: 1,
    });
  });
});
