import type { Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHash,
  forgetHashes,
  HASH_CHUNK,
  HASH_TIMEOUT_MS,
  hashStream,
  openSubtitlesHash,
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

/** A server for one file: byte ranges, and whether a cross-origin page may read Content-Range. */
function serve(bytes: Uint8Array, options: { ranges?: boolean; showRange?: boolean } = {}) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    asked.push(range ?? 'whole');
    const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (!match || options.ranges === false) {
      return Promise.resolve(
        new Response(bytes.slice(0, 16), {
          status: 200,
          headers: { 'content-length': String(bytes.length) },
        }),
      );
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const headers: Record<string, string> = { 'content-length': String(end - start + 1) };
    if (options.showRange !== false)
      headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`;
    return Promise.resolve(new Response(bytes.slice(start, end + 1), { status: 206, headers }));
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
});
