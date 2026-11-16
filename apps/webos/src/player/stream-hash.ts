import { androidHashReader, type AndroidHashAnswer } from '../platform/android';
import { mark } from '../platform/marks';
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
 * it landed. Once that refuses a read (a link good for one use), that read and
 * any after it go back through the stream's own link, each once. The link it
 * landed on is never kept, nor said: only handed, with the first 64 KB, to the
 * same play's reader of the file's own subtitles (`takeLanding`), once.
 *
 * On Android TV the app reads it instead (`androidHashReader`), the same way,
 * on a thread of its own: the WebView's fetch can't see where a debrid link
 * leads, nor read a host that sends no cross-origin headers.
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
 * React Native's fetch answers only once the whole body is in, so a host that
 * sends the whole file for a range can't be stopped at the headers there: each
 * read gives up after this long instead, as the whole reading did before
 * HASH_TIMEOUT_MS grew. 64 KB takes far less on any network a video plays on.
 */
export const NATIVE_READ_MS = 4000;

/** The fetch is React Native's (the phone, the native TV app), not a browser's. */
const nativeFetch = () => typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

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

/**
 * Why the Android TV app does not read a link's hash: no file link, or a
 * playlist. Request headers are no reason there: the app sends them, as its
 * player does.
 */
export function appHashSkip(url: string): HashSkip | undefined {
  if (!/^https?:\/\//i.test(url)) return 'not a file link';
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
 * which); the server was too busy to answer it (`busyStatus`), which says
 * nothing of the link; or it took longer than HASH_TIMEOUT_MS.
 */
export type HashFailure = 'no range' | 'no size' | 'too small' | 'refused' | 'busy' | 'timed out';

/** Statuses of a server too busy to answer now (408, 425, 429, 5xx), which says nothing of the link. */
export const busyStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

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
export function landedAt(response: Response, asked: string): string {
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
  /** Of those, an answer from a server too busy for it now (`busyStatus`). */
  busy?: boolean;
}

/** A read stopped by its own NATIVE_READ_MS: the host is sending more than was asked for. */
class TooLong extends Error {}

/**
 * Runs one fetch tied to the reading's signal, with its own controller to stop it at the
 * headers; on React Native, where the headers come with the whole body, after NATIVE_READ_MS.
 */
async function fetchWith<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  take: (response: Response, stop: () => void) => Promise<T>,
): Promise<T> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const stop = () => controller?.abort();
  signal?.addEventListener('abort', stop);
  let tooLong = false;
  const limit =
    controller && nativeFetch()
      ? window.setTimeout(() => {
          tooLong = true;
          stop();
        }, NATIVE_READ_MS)
      : undefined;
  try {
    // Kept out of the browser's cache, which would write the link it landed on to the TV's disk.
    // Not through React Native's fetch, whose polyfill adds a "_=" to the link for that.
    const cache: RequestInit = nativeFetch() ? {} : { cache: 'no-store' };
    const response = await fetch(url, { ...init, ...cache, signal: controller?.signal });
    return await take(response, stop);
  } catch (error) {
    throw tooLong && !signal?.aborted ? new TooLong() : error;
  } finally {
    if (limit !== undefined) clearTimeout(limit);
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
          return {
            value: { total, landed, sizeReadable },
            refused: !response.ok,
            ...(busyStatus(response.status) && { busy: true }),
          };
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
    // Still coming after NATIVE_READ_MS: the whole file for a range, which another try won't mend.
    if (error instanceof TooLong) return { refused: false };
    return { refused: true };
  }
}

/** The file's size when the range answer hides it: a plain request, stopped at its headers. */
async function readSize(url: string, signal: AbortSignal | undefined): Promise<Answer<number>> {
  try {
    return await fetchWith(url, {}, signal, async (response, stop): Promise<Answer<number>> => {
      const length = Number(response.headers.get('content-length'));
      stop();
      return {
        value: response.ok && length > 0 ? length : undefined,
        refused: !response.ok,
        ...(busyStatus(response.status) && { busy: true }),
      };
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { refused: true };
  }
}

/** How a reading is going, for its record: which read it is at, and how often it went the long way. */
interface Progress {
  step: HashStep;
  /** The first read the link the first one landed on refused: it and every later one went back. */
  fellBack?: 'size' | 'end';
  /** Requests made to the stream's own link, each walking its redirects. */
  walks: number;
}

/**
 * What the newest hash read found at its first read, for the same play's reader of the file's
 * own subtitles (file-subtitles.ts): the first 64 KB, the link the redirects led to (dropped
 * once that refused a read), and the file's size where a Content-Range gave it. One slot, in
 * memory only: replaced by the next read, taken once, and never stored, traced or logged.
 */
export interface Landing {
  /** Where the first read landed, past every redirect. Never kept past the play, nor said. */
  landed?: string;
  head: Uint8Array;
  /** The file's size, from the first read's Content-Range when the page could read it. */
  total?: number;
}

/** The reading whose landing the slot may hold: each read started makes a new one. */
interface Slot {
  url: string;
  landing?: Landing;
}

let slot: Slot | null = null;
/** The newest reading started, kept after it failed (`known` forgets a failure) for its outcome. */
let newest: { url: string; reading: Promise<HashReading> } | null = null;

async function read(
  url: string,
  knownSize: number | undefined,
  signal: AbortSignal | undefined,
  progress: Progress,
  mine: Slot,
): Promise<{ videoHash: string; videoSize: number }> {
  progress.walks++;
  const first = await readRange(url, 0, signal);
  if (first.refused) throw new HashError(first.busy ? 'busy' : 'refused', 'start');
  if (!first.value?.bytes) throw new HashError('no range', 'start');
  const { landed, bytes: head } = first.value;
  if (slot === mine) {
    mine.landing = { landed, head };
    if (first.value.total !== undefined) mine.landing.total = first.value.total;
  }
  // Every later read goes straight to where the first landed, past the redirects (each walk
  // through them asks the debrid service for its link again, and its answers are rationed). A
  // read there that is refused goes once through the stream's own link, and so does every read
  // after it: a link good for one use refuses each of them.
  const once = async <T>(attempt: (target: string) => Promise<Answer<T>>): Promise<Answer<T>> => {
    if (landed !== url && progress.fellBack === undefined) {
      const direct = await attempt(landed);
      if (!direct.refused) return direct;
      progress.fellBack = progress.step === 'size' ? 'size' : 'end';
      // Refused once, it is no link to read the file by: only the bytes are handed on.
      delete mine.landing?.landed;
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
      throw new HashError(sized.busy ? 'busy' : sized.refused ? 'refused' : 'no size', 'size');
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
    if (bytes) return { value: bytes, refused: false };
    return { refused: answer.refused, ...(answer.busy && { busy: true }) };
  });
  if (!last.value) {
    throw new HashError(last.busy ? 'busy' : last.refused ? 'refused' : 'no range', 'end');
  }
  const videoHash = openSubtitlesHash(size, head, last.value);
  if (!videoHash) throw new HashError('too small', 'end');
  return { videoHash, videoSize: size };
}

/**
 * How reading a link's hash went, and how long it took: `walks` the requests
 * made to the stream's own link, each through its redirects; `fellBack` the
 * first later read the link it led to refused, which went through the
 * stream's link again, as every read after it did; `step` the read a failure
 * came at; `by` 'app' when the Android TV app read it. Never the link, nor
 * where it led.
 */
export type HashReading =
  | {
      found: { videoHash: string; videoSize: number };
      ms: number;
      walks: number;
      fellBack?: 'size' | 'end';
      by?: 'app';
    }
  | { found?: undefined; skipped: HashSkip; ms: 0 }
  | {
      found?: undefined;
      failed: HashFailure;
      step: HashStep;
      ms: number;
      walks: number;
      by?: 'app';
    };

const known = new Map<string, Promise<HashReading>>();
/** Hashes kept for going back and forth between streams. */
const KEPT = 20;

const FAILURES: readonly HashFailure[] = [
  'no range',
  'no size',
  'too small',
  'refused',
  'busy',
  'timed out',
];
const STEPS: readonly HashStep[] = ['start', 'size', 'end'];

/** The Android TV app's answer as a reading. Anything that is not a hash is a refusal. */
function appReading(answer: AndroidHashAnswer, ms: number): HashReading {
  const walks =
    typeof answer.walks === 'number' &&
    Number.isInteger(answer.walks) &&
    answer.walks >= 0 &&
    answer.walks <= 10
      ? answer.walks
      : 1;
  const { hash, size } = answer;
  if (
    typeof hash === 'string' &&
    /^[0-9a-f]{16}$/.test(hash) &&
    typeof size === 'number' &&
    Number.isInteger(size) &&
    size >= 2 * HASH_CHUNK
  ) {
    const fellBack: 'size' | 'end' | undefined =
      answer.fellBack === 'size' || answer.fellBack === 'end' ? answer.fellBack : undefined;
    return {
      found: { videoHash: hash, videoSize: size },
      ms,
      walks,
      ...(fellBack && { fellBack }),
      by: 'app',
    };
  }
  const failed = FAILURES.find((word) => word === answer.failed) ?? 'refused';
  const step = STEPS.find((word) => word === answer.step) ?? 'start';
  return { failed, step, ms, walks, by: 'app' };
}

/** Has the Android TV app read the hash, giving up at HASH_TIMEOUT_MS as the page does. */
function readByApp(
  app: NonNullable<ReturnType<typeof androidHashReader>>,
  url: string,
  size: number | undefined,
  startedAt: number,
): Promise<HashReading> {
  const headers = requestHeadersFor(url);
  const asked = app({
    url,
    ...(size !== undefined && size > 0 && { size }),
    ...(headers && { headers }),
  });
  return new Promise<HashReading>((resolve) => {
    const timer = window.setTimeout(() => {
      asked.drop();
      resolve({
        failed: 'timed out',
        step: 'start',
        ms: Date.now() - startedAt,
        walks: 0,
        by: 'app',
      });
    }, HASH_TIMEOUT_MS);
    void asked.answer.then((answer) => {
      clearTimeout(timer);
      resolve(appReading(answer, Date.now() - startedAt));
    });
  });
}

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
  const app = androidHashReader();
  if (app) return readThroughApp(app, url, knownSize);
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
  const progress: Progress = { step: 'start', walks: 0 };
  const mine: Slot = { url };
  slot = mine;
  const reading = read(url, size, controller?.signal, progress, mine).then(
    (found): HashReading => {
      clearTimeout(timer);
      return {
        found,
        ms: Date.now() - startedAt,
        walks: progress.walks,
        ...(progress.fellBack && { fellBack: progress.fellBack }),
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
  newest = { url, reading };
  while (known.size > KEPT) known.delete(known.keys().next().value!);
  return reading;
}

/**
 * readStreamHash on Android TV: the app reads it. No landing is kept, as the
 * android engine never takes one; a hash read is kept by the stream's link,
 * and a failure forgotten, as on the page's own path.
 */
function readThroughApp(
  app: NonNullable<ReturnType<typeof androidHashReader>>,
  url: string,
  knownSize: number | undefined,
): Promise<HashReading> {
  const skipped = appHashSkip(url);
  if (skipped) return Promise.resolve({ skipped, ms: 0 });
  mark('sub:hash:app');
  const size = knownSize !== undefined && knownSize > 0 ? knownSize : undefined;
  const reading = readByApp(app, url, size, Date.now()).then((done) => {
    if (!done.found) known.delete(url);
    return done;
  });
  known.set(url, reading);
  newest = { url, reading };
  while (known.size > KEPT) known.delete(known.keys().next().value!);
  return reading;
}

/**
 * The reading of `url`'s hash, in flight or done: the one kept, or the newest started when it
 * was of this link (one that failed is not kept). Never starts one: a stream whose addon sent
 * its hash has none.
 */
export function hashReadingFor(url: string): Promise<HashReading> | undefined {
  return known.get(url) ?? (newest?.url === url ? newest.reading : undefined);
}

/**
 * What the newest hash read found at its first read of `url` (`Landing`), once: the slot is
 * emptied, and holds nothing for another link, nor for a hash kept from before.
 */
export function takeLanding(url: string): Landing | undefined {
  if (!slot || slot.url !== url || !slot.landing) return undefined;
  const { landing } = slot;
  slot = null;
  return landing;
}

/** Lets go of the newest reading's landing and outcome: the player closed. */
export function forgetLanding(): void {
  slot = null;
  newest = null;
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
  forgetLanding();
}
