import { guessMimeType } from './media';
import { requestHeadersFor } from './request-headers';

/**
 * The OpenSubtitles hash of a video file, read from its first and last 64 KB
 * with two byte-range requests. Subtitle addons such as OpenSubtitles match it
 * against files made from the very same release, whose words and timing fit;
 * without it they can only go by the title, and the first file in the list
 * may be from another cut or another translation.
 */

/** Bytes read from each end of the file. */
export const HASH_CHUNK = 64 * 1024;
/** The whole reading gives up after this long: subtitles must not wait on it much. */
export const HASH_TIMEOUT_MS = 4000;

/**
 * The OpenSubtitles hash: the file size plus every little-endian 64-bit word
 * of the first and last 64 KB, modulo 2^64, as 16 hex digits. Undefined for
 * a file shorter than both chunks, or chunks of the wrong length. Worked in
 * 16-bit pieces, as webOS 5 has no BigInt.
 */
export function openSubtitlesHash(
  size: number,
  head: Uint8Array,
  tail: Uint8Array,
): string | undefined {
  if (!(size >= 2 * HASH_CHUNK) || !isFinite(size)) return undefined;
  if (head.length !== HASH_CHUNK || tail.length !== HASH_CHUNK) return undefined;
  const sum = [0, 0, 0, 0];
  let rest = Math.floor(size);
  for (let i = 0; i < 4; i++) {
    sum[i] = rest % 65536;
    rest = Math.floor(rest / 65536);
  }
  for (const chunk of [head, tail]) {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let at = 0; at < HASH_CHUNK; at += 8) {
      sum[0]! += view.getUint16(at, true);
      sum[1]! += view.getUint16(at + 2, true);
      sum[2]! += view.getUint16(at + 4, true);
      sum[3]! += view.getUint16(at + 6, true);
    }
  }
  let carry = 0;
  const pieces: string[] = [];
  for (let i = 0; i < 4; i++) {
    const total = sum[i]! + carry;
    pieces.push((total % 65536).toString(16).padStart(4, '0'));
    carry = Math.floor(total / 65536);
  }
  return pieces.reverse().join('');
}

/**
 * Whether a link is one file the hash can be read from: not a playlist, and
 * not a link whose addon asked for request headers. The page cannot send
 * those (Referer, Origin and cookies are a browser's own), and a host that
 * wants them should not be asked without them: such a stream's subtitles are
 * asked for with no hash.
 */
export function canHash(url: string): boolean {
  if (!/^https?:\/\//i.test(url) || requestHeadersFor(url)) return false;
  const mime = guessMimeType(url);
  return mime !== 'application/vnd.apple.mpegurl' && mime !== 'application/dash+xml';
}

/** The size the server gives: from Content-Range when it lets us read it, or a whole answer's length. */
function totalFrom(response: Response): number | undefined {
  const range = /\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '');
  if (range) return Number(range[1]);
  if (response.status === 200) {
    const length = Number(response.headers.get('content-length'));
    return length > 0 ? length : undefined;
  }
  return undefined;
}

async function readRange(
  url: string,
  start: number,
  signal: AbortSignal | undefined,
): Promise<{ bytes?: Uint8Array; total?: number }> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const stop = () => controller?.abort();
  signal?.addEventListener('abort', stop);
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${start + HASH_CHUNK - 1}` },
      signal: controller?.signal,
    });
    const total = totalFrom(response);
    // A server that ignores the range sends the whole file: stop at the headers.
    if (response.status !== 206) {
      stop();
      return { total };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes: bytes.length === HASH_CHUNK ? bytes : undefined, total };
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

/** The file's size when the range answer hides it: a plain request, stopped at its headers. */
async function readSize(url: string, signal: AbortSignal | undefined): Promise<number | undefined> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const stop = () => controller?.abort();
  signal?.addEventListener('abort', stop);
  try {
    const response = await fetch(url, { signal: controller?.signal });
    const length = Number(response.headers.get('content-length'));
    stop();
    return response.ok && length > 0 ? length : undefined;
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

async function read(
  url: string,
  knownSize: number | undefined,
  signal: AbortSignal | undefined,
): Promise<{ videoHash: string; videoSize: number } | undefined> {
  const first = await readRange(url, 0, signal);
  if (!first.bytes) return undefined;
  const size = knownSize ?? first.total ?? (await readSize(url, signal));
  if (size === undefined || size < 2 * HASH_CHUNK) return undefined;
  const last = await readRange(url, size - HASH_CHUNK, signal);
  if (!last.bytes) return undefined;
  const videoHash = openSubtitlesHash(size, first.bytes, last.bytes);
  return videoHash ? { videoHash, videoSize: size } : undefined;
}

const known = new Map<string, Promise<{ videoHash: string; videoSize: number } | undefined>>();
/** Hashes kept for going back and forth between streams. */
const KEPT = 20;

/**
 * Reads the OpenSubtitles hash and size of the file at `url`, once per link.
 * Undefined when the link can't be read that way: the server refuses ranges
 * or cross-origin reads, it is a playlist, or it took longer than
 * HASH_TIMEOUT_MS. Never throws.
 */
export function hashStream(
  url: string,
  knownSize?: number,
): Promise<{ videoHash: string; videoSize: number } | undefined> {
  const kept = known.get(url);
  if (kept) return kept;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = window.setTimeout(() => controller?.abort(), HASH_TIMEOUT_MS);
  const size = knownSize !== undefined && knownSize > 0 ? knownSize : undefined;
  const reading = (canHash(url) ? read(url, size, controller?.signal) : Promise.resolve(undefined))
    .catch(() => undefined)
    .then((found) => {
      clearTimeout(timer);
      // A failure may be passing (a slow moment): only answers are kept.
      if (!found) known.delete(url);
      return found;
    });
  known.set(url, reading);
  while (known.size > KEPT) known.delete(known.keys().next().value!);
  return reading;
}

/** For tests: forgets every hash read. */
export function forgetHashes(): void {
  known.clear();
}
