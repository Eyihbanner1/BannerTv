import { guessMimeType } from './media';
import { requestHeadersFor } from './request-headers';

/**
 * The OpenSubtitles hash of a video file, read from its first and last 64 KB
 * with two byte-range requests. Subtitle addons such as OpenSubtitles match it
 * against files made from the very same release, whose words and timing fit;
 * without it they can only go by the title, and the first file in the list
 * may be from another cut or another translation.
 *
 * A stream's link often leads somewhere else (an addon's link to a debrid
 * service, which hands out a link on its own servers): the first read follows
 * those redirects once, and the size and the end are read straight from where
 * it landed, back through the stream's own link once if that is refused. The
 * link it landed on is never kept, nor said.
 */

/** Bytes read from each end of the file. */
export const HASH_CHUNK = 64 * 1024;
/**
 * The whole reading gives up after this long. The subtitles are asked for
 * without the hash after HASH_WAIT_MS at most (`subtitles.ts`), and again with
 * it when it comes later, so this only bounds how late a hash is still used.
 */
export const HASH_TIMEOUT_MS = 15000;

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

/** Why a link's hash is not read at all. */
export type HashSkip = 'playlist' | 'request headers' | 'not a file link';

/**
 * Why a link is not one file the hash can be read from: a playlist, or a
 * link whose addon asked for request headers. The page cannot send those
 * (Referer, Origin and cookies are a browser's own), and a host that wants
 * them should not be asked without them: such a stream's subtitles are asked
 * for with no hash. Undefined for a link that can be read.
 */
export function hashSkip(url: string): HashSkip | undefined {
  if (!/^https?:\/\//i.test(url)) return 'not a file link';
  if (requestHeadersFor(url)) return 'request headers';
  const mime = guessMimeType(url);
  return mime === 'application/vnd.apple.mpegurl' || mime === 'application/dash+xml'
    ? 'playlist'
    : undefined;
}

/** Whether a link is one file the hash can be read from (`hashSkip`). */
export function canHash(url: string): boolean {
  return hashSkip(url) === undefined;
}

/**
 * Why reading a hash failed: the server answered a range with the whole
 * file or a short piece; the file's size could not be learnt; the file is
 * too small to hash; the request was refused or never answered (a host
 * that sends no cross-origin headers, or no network: the page cannot tell
 * which); or it took longer than HASH_TIMEOUT_MS.
 */
export type HashFailure = 'no range' | 'no size' | 'too small' | 'refused' | 'timed out';

/** Which read a failure came at: the first 64 KB, the file's size, or the last 64 KB. */
export type HashStep = 'start' | 'size' | 'end';

class HashError extends Error {
  constructor(
    readonly why: HashFailure,
    readonly step: HashStep,
  ) {
    super(why);
  }
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

/** The link an answer came from, past every redirect; the link asked when the fetch can't say. */
function landedAt(response: Response, asked: string): string {
  const url = typeof response.url === 'string' ? response.url : '';
  return /^https?:\/\//i.test(url) ? url : asked;
}

/** What one read found, and whether the host refused it. */
interface Answer<T> {
  /** What the read found, if it found what it wanted. */
  value?: T;
  /**
   * The host refused or never answered (an error status, or no answer): worth
   * one more try through the stream's own link. A whole file sent for a range
   * is not refused: the same host would send it again.
   */
  refused: boolean;
}

/** Runs one fetch tied to the reading's signal, with its own controller to stop it at the headers. */
async function fetchWith<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  take: (response: Response, stop: () => void) => Promise<T>,
): Promise<T> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const stop = () => controller?.abort();
  signal?.addEventListener('abort', stop);
  try {
    const response = await fetch(url, { ...init, signal: controller?.signal });
    return await take(response, stop);
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

interface RangeRead {
  bytes?: Uint8Array;
  total?: number;
  /** Where the read landed, past every redirect. Never kept, nor said. */
  landed: string;
  /**
   * Whether a plain request's Content-Length could be read here, for the
   * size: a browser's own answer ('basic', every header but Set-Cookie), or a
   * CORS-filtered one ('cors') whose own Content-Length came through (the
   * header is CORS-safelisted from Chromium 76; webOS 5 runs Chromium 68,
   * where it is hidden unless the host exposes it). Never React Native's
   * fetch ('default'), which waits for the whole body before it answers: a
   * plain request there would download the film until the timeout stops it.
   */
  sizeReadable: boolean;
}

async function readRange(
  url: string,
  start: number,
  signal: AbortSignal | undefined,
): Promise<Answer<RangeRead>> {
  try {
    return await fetchWith(
      url,
      { headers: { Range: `bytes=${start}-${start + HASH_CHUNK - 1}` } },
      signal,
      async (response, stop): Promise<Answer<RangeRead>> => {
        const total = totalFrom(response);
        const landed = landedAt(response, url);
        const sizeReadable =
          response.type === 'basic' ||
          (response.type === 'cors' && response.headers.get('content-length') !== null);
        // A server that ignores the range sends the whole file: stop at the headers.
        if (response.status !== 206) {
          stop();
          return { value: { total, landed, sizeReadable }, refused: !response.ok };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          value: {
            bytes: bytes.length === HASH_CHUNK ? bytes : undefined,
            total,
            landed,
            sizeReadable,
          },
          refused: false,
        };
      },
    );
  } catch (error) {
    // Stopped by the reading's own timer: that is the timeout, not a refusal.
    if (signal?.aborted) throw error;
    return { refused: true };
  }
}

/** The file's size when the range answer hides it: a plain request, stopped at its headers. */
async function readSize(url: string, signal: AbortSignal | undefined): Promise<Answer<number>> {
  try {
    return await fetchWith(url, {}, signal, async (response, stop): Promise<Answer<number>> => {
      const length = Number(response.headers.get('content-length'));
      stop();
      return { value: response.ok && length > 0 ? length : undefined, refused: !response.ok };
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { refused: true };
  }
}

/** How a reading is going, for its record: which read it is at, and how often it went the long way. */
interface Progress {
  step: HashStep;
  fellBack: boolean;
  /** Requests made to the stream's own link, each walking its redirects. */
  walks: number;
}

async function read(
  url: string,
  knownSize: number | undefined,
  signal: AbortSignal | undefined,
  progress: Progress,
): Promise<{ videoHash: string; videoSize: number }> {
  progress.walks++;
  const first = await readRange(url, 0, signal);
  if (first.refused) throw new HashError('refused', 'start');
  if (!first.value?.bytes) throw new HashError('no range', 'start');
  const { landed, bytes: head } = first.value;
  // Every later read goes straight to where the first landed, past the redirects (each walk
  // through them asks the debrid service for its link again, and its answers are rationed). A
  // link there that refuses is tried once through the stream's own.
  const once = async <T>(attempt: (target: string) => Promise<Answer<T>>): Promise<Answer<T>> => {
    if (landed !== url) {
      const direct = await attempt(landed);
      if (!direct.refused) return direct;
      progress.fellBack = true;
    }
    progress.walks++;
    return attempt(url);
  };
  let size = knownSize ?? first.value.total;
  if (size === undefined) {
    progress.step = 'size';
    // Behind CORS the range's answer hides Content-Range unless the host exposes it, and a plain
    // request's Content-Length too where the page could not read it.
    if (!first.value.sizeReadable) throw new HashError('no size', 'size');
    const sized = await once((target) => readSize(target, signal));
    if (sized.value === undefined) {
      throw new HashError(sized.refused ? 'refused' : 'no size', 'size');
    }
    size = sized.value;
  }
  if (size < 2 * HASH_CHUNK) throw new HashError('too small', progress.step);
  progress.step = 'end';
  const end = size - HASH_CHUNK;
  const last = await once(async (target): Promise<Answer<Uint8Array>> => {
    const answer = await readRange(target, end, signal);
    const bytes = answer.value?.bytes;
    // An answer that names another size is not this file's end.
    const total = answer.value?.total;
    if (bytes && total !== undefined && total !== size) return { refused: true };
    return bytes ? { value: bytes, refused: false } : { refused: answer.refused };
  });
  if (!last.value) throw new HashError(last.refused ? 'refused' : 'no range', 'end');
  const videoHash = openSubtitlesHash(size, head, last.value);
  if (!videoHash) throw new HashError('too small', 'end');
  return { videoHash, videoSize: size };
}

/**
 * How reading a link's hash went, and how long it took: `walks` the requests
 * made to the stream's own link, each through its redirects; `fellBack` where
 * the link it led to refused a later read, which went through the stream's
 * link again; `step` the read a failure came at. Never the link, nor where it
 * led.
 */
export type HashReading =
  | {
      found: { videoHash: string; videoSize: number };
      ms: number;
      walks: number;
      fellBack?: true;
    }
  | { found?: undefined; skipped: HashSkip; ms: 0 }
  | { found?: undefined; failed: HashFailure; step: HashStep; ms: number; walks: number };

const known = new Map<string, Promise<HashReading>>();
/** Hashes kept for going back and forth between streams. */
const KEPT = 20;

/**
 * Reads the OpenSubtitles hash and size of the file at `url`, once per link,
 * and says why when it can't: the link is a playlist or needs request
 * headers (not tried), or the server refuses ranges or cross-origin reads,
 * hides the size, or took longer than HASH_TIMEOUT_MS, and at which read.
 * Never throws. A failure may be passing, so only a hash read is kept: by
 * the stream's link, never the one it led to.
 */
export function readStreamHash(url: string, knownSize?: number): Promise<HashReading> {
  const kept = known.get(url);
  if (kept) return kept;
  const skipped = hashSkip(url);
  if (skipped) return Promise.resolve({ skipped, ms: 0 });
  const startedAt = Date.now();
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller?.abort();
  }, HASH_TIMEOUT_MS);
  const size = knownSize !== undefined && knownSize > 0 ? knownSize : undefined;
  const progress: Progress = { step: 'start', fellBack: false, walks: 0 };
  const reading = read(url, size, controller?.signal, progress).then(
    (found): HashReading => {
      clearTimeout(timer);
      return {
        found,
        ms: Date.now() - startedAt,
        walks: progress.walks,
        ...(progress.fellBack && { fellBack: true as const }),
      };
    },
    (error: unknown): HashReading => {
      clearTimeout(timer);
      known.delete(url);
      const failed: HashFailure = timedOut
        ? 'timed out'
        : error instanceof HashError
          ? error.why
          : 'refused';
      // A timeout came at the read it was at; a failure says its own.
      const step = error instanceof HashError && !timedOut ? error.step : progress.step;
      return { failed, step, ms: Date.now() - startedAt, walks: progress.walks };
    },
  );
  known.set(url, reading);
  while (known.size > KEPT) known.delete(known.keys().next().value!);
  return reading;
}

/**
 * The OpenSubtitles hash and size of the file at `url` (`readStreamHash`),
 * or undefined when it can't be read that way.
 */
export function hashStream(
  url: string,
  knownSize?: number,
): Promise<{ videoHash: string; videoSize: number } | undefined> {
  return readStreamHash(url, knownSize).then((reading) => reading.found);
}

/** For tests: forgets every hash read. */
export function forgetHashes(): void {
  known.clear();
}
