import type { ByteSource, ReadSignal } from '@bannertv/core';
import { landedAt } from './stream-hash';

/*
 * A direct-play file's bytes, read by ranges from the page, for the reader of
 * the file's own subtitles (file-subtitles.ts). The stream's link often leads
 * somewhere else first (an addon's link to a debrid service, which hands out a
 * link on its own servers, each walk through it an API call the service
 * rations): it is walked once, or not at all where the hash read already did
 * (`takeLanding`), and every read after goes straight to where it led. That
 * link lives only here, for the play: never in an error, a count, a trace or a
 * log.
 */

/**
 * Why a read failed. Kept, so every read after rejects with it: the server
 * answers a range with the whole file or another piece of it; the first
 * request was blocked (cross-origin checks, or no network: the page cannot
 * tell which); the server refused the reads, or the walks allowed are used
 * up; the link the walk led to refused its first read straight to it, as a
 * link good for one use does; the first answer says it is another kind of
 * file; or the server was too busy for every read for BUSY_MS ('busy'). Never
 * kept: the caller aborted the read, or it got no answer for now
 * ('transient': a busy server, or a moment with no network), which may be
 * tried again later.
 */
export type FileReadFailure =
  | 'no-range'
  | 'blocked'
  | 'refused'
  | 'one-use'
  | 'not-matroska'
  | 'busy'
  | 'aborted'
  | 'transient';

/** A failure that is kept: every read after rejects with it. */
export type FileReadEnd = Exclude<FileReadFailure, 'aborted' | 'transient'>;

/** A read that failed, by its code alone: never a link. */
export class FileReadError extends Error {
  constructor(readonly code: FileReadFailure) {
    super(code);
    this.name = 'FileReadError';
  }
}

/**
 * Walks through the stream's link in a play, at most, the hash read's among them
 * (`FetchSourceOptions.walked`): the first, and two after links that expired.
 */
export const MAX_WALKS = 3;
/** A walk is given this long, whatever became of the read it was made for. */
export const WALK_MS = 15000;
/**
 * Reads in a row straight to the link a walk led to that got no answer at all, over at least
 * UNANSWERED_MS, past which the link is taken as expired: a refusal hidden by cross-origin
 * checks looks the same. A second with no network never walks.
 */
export const UNANSWERED_IN_A_ROW = 3;
export const UNANSWERED_MS = 10000;
/**
 * Busy answers in a row (429, 503 and the like, none answered between), over at least BUSY_MS,
 * past which the source gives up ('busy'): a server that stays too busy for every read of the
 * play is asked no more. Fewer, or for less time, are a burst: those reads are tried again later.
 */
export const BUSY_IN_A_ROW = 10;
export const BUSY_MS = 120000;
/** Walks tried in a play at most, those that got no answer or a busy one among them. */
const MAX_WALK_TRIES = 3 * MAX_WALKS;

export interface FetchSourceOptions {
  /** The stream's own link. */
  link: string;
  /** Where the hash read's walk landed, which answered its reads straight: for this play only. */
  landed?: string;
  /** The hash read's first 64 KB, served from memory. */
  head?: Uint8Array;
  /** The file's size, only from a Content-Range seen. */
  size?: number;
  /** Walks through the stream's link this play made already (the hash read's): counted in. */
  walked?: number;
  maxWalks?: number;
  /** The time, and the timers a walk's own time limit runs on. */
  clock?: {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** What the source has asked of the network: requests, bytes received, and walks among them. */
export interface FetchStats {
  requests: number;
  bytes: number;
  walks: number;
}

export interface FetchSource extends ByteSource {
  readonly stats: FetchStats;
  /** Why the source gave up, once it has: every read after rejects with it. */
  failure(): FileReadEnd | undefined;
  /** Stops the walk in flight, if any: every read after rejects ('aborted'). */
  close(): void;
}

/** Kinds of file a server names that are never Matroska: the reader stops at the headers. */
const OTHER_KINDS = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mp2t'];

type Answer =
  | { kind: 'bytes'; bytes: Uint8Array; url: string }
  /** 416: the read starts past the end. */
  | { kind: 'past-end' }
  /** The range ignored, or answered from elsewhere. */
  | { kind: 'no-range' }
  | { kind: 'other-kind' }
  /** An answer that says no (401, 403, 404, 410 and the like): the link is no good now. */
  | { kind: 'refused' }
  /** A busy server (408, 425, 429, 5xx): the same read may be answered later. */
  | { kind: 'busy' }
  /** No answer, or a body that stopped coming: no network for a moment, or a hidden refusal. */
  | { kind: 'unanswered'; typeError: boolean }
  | { kind: 'aborted' };

/** Statuses of a server too busy to answer now, which says nothing of the link. */
const busy = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const EMPTY = new Uint8Array(0);

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * At most `length` bytes of an answer's body, the rest left unread: a server
 * may send more than was asked for. Counts every byte received in `stats`.
 */
async function bodyOf(response: Response, length: number, stats: FetchStats): Promise<Uint8Array> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const all = new Uint8Array(await response.arrayBuffer());
    stats.bytes += all.length;
    return all.length > length ? all.subarray(0, length) : all;
  }
  const reader = body.getReader();
  const out = new Uint8Array(length);
  let at = 0;
  while (at < length) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    stats.bytes += value.length;
    const kept = Math.min(value.length, length - at);
    out.set(value.subarray(0, kept), at);
    at += kept;
  }
  if (at >= length) reader.cancel().catch(() => undefined);
  return at === length ? out : out.subarray(0, at);
}

/** `promise`, or a rejection ('aborted') as soon as `signal` aborts, the promise going on. */
function until<T>(promise: Promise<T>, signal: ReadSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new FileReadError('aborted'));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new FileReadError('aborted'));
    signal.addEventListener('abort', stop);
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}

/**
 * A ByteSource over the file at `options.link`. Reads inside `head` come from
 * memory. Others go to the link the last walk landed on; a walk is a read
 * through the stream's link, whose answer says where it led. A link that
 * served reads and then refuses one has expired: the read walks again, while
 * the play has walked fewer than `maxWalks` times, the hash read's walks
 * among them. One that refuses its very first read is good for one use: the
 * read walks once more, and the source then gives up ('one-use'), as walking
 * for every line would ration the service. A busy server (429, 503) or a
 * moment with no network fails only the read in hand ('transient'), never
 * walks, and is not kept: the caller tries it again later, until the server
 * has been busy for every read for BUSY_MS ('busy'). Only
 * UNANSWERED_IN_A_ROW reads with no answer at all take the link as expired. A
 * walk runs on its own, WALK_MS at most, so a read dropped meanwhile (a seek)
 * does not waste it: the reads after go where it led. No other time limit of
 * its own: the callers abort their reads (ByteSource). Every read asks the
 * browser to keep it out of its cache, which would write the link to disk.
 */
export function createFetchSource(
  options: FetchSourceOptions,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): FetchSource {
  const { link, head } = options;
  const maxWalks = options.maxWalks ?? MAX_WALKS;
  const clock = options.clock ?? {
    now: () => Date.now(),
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let landed = options.landed;
  // The hash read's walk landed there and its later reads were answered there.
  let served = landed !== undefined;
  let size = options.size;
  let failed: FileReadEnd | undefined;
  let closed = false;
  // Walks that reached the service and were answered, the hash read's among them.
  let spent = options.walked ?? 0;
  // Reads in a row straight to `landed` that got no answer at all, since when.
  let unanswered = 0;
  let unansweredSince = 0;
  // Busy answers in a row, from any link, since when.
  let busyInARow = 0;
  let busySince = 0;
  // A walk in flight, which reads refused meanwhile wait for rather than walk again.
  let walking: Promise<Answer> | null = null;
  let stopWalk: (() => void) | null = null;
  // The kind of file is checked on the first answer when the head is read here.
  let kindUnchecked = !head;
  const stats: FetchStats = { requests: 0, bytes: 0, walks: 0 };

  const fail = (code: FileReadFailure): never => {
    if (code !== 'aborted' && code !== 'transient' && failed === undefined) failed = code;
    throw new FileReadError(code === 'aborted' || code === 'transient' ? code : failed!);
  };

  async function fetchRange(
    target: string,
    start: number,
    length: number,
    signal: ReadSignal | undefined,
  ): Promise<Answer> {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const stop = () => controller?.abort();
    signal?.addEventListener('abort', stop);
    stats.requests++;
    try {
      let response: Response;
      try {
        response = await fetcher(target, {
          headers: { Range: `bytes=${start}-${start + length - 1}` },
          // The link, its token and all, would be written to the TV's disk with the bytes.
          cache: 'no-store',
          signal: controller?.signal,
        });
      } catch (error) {
        if (signal?.aborted) return { kind: 'aborted' };
        return { kind: 'unanswered', typeError: error instanceof TypeError };
      }
      if (kindUnchecked && (response.status === 206 || response.status === 200)) {
        kindUnchecked = false;
        const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
        if (OTHER_KINDS.indexOf(type.toLowerCase()) !== -1) {
          stop();
          return { kind: 'other-kind' };
        }
      }
      if (response.status === 416) {
        stop();
        return { kind: 'past-end' };
      }
      // The whole file for a range: stopped at the headers.
      if (response.status === 200) {
        stop();
        return { kind: 'no-range' };
      }
      if (response.status !== 206) {
        stop();
        return busy(response.status) ? { kind: 'busy' } : { kind: 'refused' };
      }
      // Hidden behind cross-origin checks where the host does not expose it: the 206 is enough.
      const range = /^\s*bytes\s+(\d+)-\d+\/(\d+|\*)/i.exec(
        response.headers.get('content-range') ?? '',
      );
      if (range) {
        if (Number(range[1]) !== start) {
          stop();
          return { kind: 'no-range' };
        }
        if (size === undefined && range[2] !== '*') size = Number(range[2]);
      }
      const bytes = await bodyOf(response, length, stats);
      return { kind: 'bytes', bytes, url: landedAt(response, target) };
    } catch {
      // The body stopped coming.
      return signal?.aborted ? { kind: 'aborted' } : { kind: 'unanswered', typeError: false };
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  /** Counts a busy answer, and gives up once the server has been busy long enough. */
  function tally(answer: Answer) {
    if (answer.kind === 'bytes' || answer.kind === 'past-end') busyInARow = 0;
    if (answer.kind !== 'busy') return;
    if (busyInARow++ === 0) busySince = clock.now();
    if (
      failed === undefined &&
      !closed &&
      busyInARow >= BUSY_IN_A_ROW &&
      clock.now() - busySince >= BUSY_MS
    ) {
      failed = 'busy';
    }
  }

  /** What a read's answer gives, or why it failed: a refusal for good, or for now. */
  function settle(answer: Answer): Uint8Array {
    switch (answer.kind) {
      case 'bytes':
        return answer.bytes;
      case 'past-end':
        return EMPTY;
      case 'no-range':
        return fail('no-range');
      case 'other-kind':
        return fail('not-matroska');
      case 'aborted':
        return fail('aborted');
      case 'refused':
        return fail('refused');
      default:
        return fail(failed ?? 'transient');
    }
  }

  /**
   * A walk through the stream's link for the read in hand, shared with reads waiting on it, and
   * left to finish when they are dropped; `then`, the source gives up once it is read, before
   * those reads go on.
   */
  function walk(start: number, length: number, then?: 'one-use'): Promise<Answer> {
    stats.walks++;
    const first = stats.requests === 0;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timedOut = false;
    const timer = clock.setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, WALK_MS);
    stopWalk = () => controller?.abort();
    const going = fetchRange(link, start, length, controller?.signal).then((found): Answer => {
      clock.clearTimeout(timer);
      tally(found);
      walking = null;
      stopWalk = null;
      // Out of time, it is a walk with no answer; stopped by close(), aborted.
      const answer: Answer =
        found.kind === 'aborted' && timedOut ? { kind: 'unanswered', typeError: false } : found;
      if (answer.kind === 'bytes') {
        landed = answer.url;
        served = false;
        unanswered = 0;
      }
      // Answered by the service: a link handed out, or refused. Not one busy or never reached.
      if (answer.kind !== 'busy' && answer.kind !== 'unanswered' && answer.kind !== 'aborted') {
        spent++;
      }
      if (failed === undefined && !closed) {
        if (answer.kind === 'unanswered' && first && answer.typeError) failed = 'blocked';
        else if (answer.kind === 'refused') failed = 'refused';
        else if (answer.kind === 'no-range') failed = 'no-range';
        else if (answer.kind === 'other-kind') failed = 'not-matroska';
        else if (then && answer.kind === 'bytes') failed = then;
      }
      return answer;
    });
    walking = going;
    return going;
  }

  /** The walk's answer for the read in hand: its bytes, or the source's failure. */
  async function walked(going: Promise<Answer>, signal: ReadSignal | undefined) {
    const answer = await until(going, signal);
    if (answer.kind === 'bytes' || answer.kind === 'past-end') return settle(answer);
    if (failed) return fail(failed);
    return settle(answer);
  }

  const budgetLeft = () => spent < maxWalks && stats.walks < MAX_WALK_TRIES;

  async function fromNetwork(
    start: number,
    length: number,
    signal: ReadSignal | undefined,
  ): Promise<Uint8Array> {
    for (;;) {
      if (walking) await until(walking, signal);
      if (closed) return fail('aborted');
      if (failed) return fail(failed);
      if (signal?.aborted) return fail('aborted');
      if (landed === undefined) {
        if (!budgetLeft()) return fail('refused');
        return walked(walk(start, length), signal);
      }
      const at = landed;
      const answer = await fetchRange(at, start, length, signal);
      tally(answer);
      if (answer.kind === 'bytes' && landed === at) {
        served = true;
        unanswered = 0;
      }
      if (answer.kind === 'unanswered' && landed === at) {
        if (unanswered++ === 0) unansweredSince = clock.now();
      }
      const expired =
        answer.kind === 'refused' ||
        (answer.kind === 'unanswered' &&
          unanswered >= UNANSWERED_IN_A_ROW &&
          clock.now() - unansweredSince >= UNANSWERED_MS);
      if (!expired) return settle(answer);
      // Another read walked meanwhile: this one goes to where that led.
      if (landed !== at || walking) continue;
      if (failed) return fail(failed);
      // The stream's link itself, with no redirect: nothing else to try.
      if (at === link) return settle(answer);
      const refusedAtOnce = !served && answer.kind === 'refused';
      unanswered = 0;
      if (!budgetLeft()) return fail(refusedAtOnce ? 'one-use' : 'refused');
      // Refused at its first read straight to it: good for one use. The read in hand walks once.
      // Expired otherwise: walked again while the walks allowed last.
      return walked(walk(start, length, refusedAtOnce ? 'one-use' : undefined), signal);
    }
  }

  async function read(start: number, length: number, signal?: ReadSignal): Promise<Uint8Array> {
    if (closed) return fail('aborted');
    if (failed) return fail(failed);
    if (signal?.aborted) return fail('aborted');
    let wanted = length;
    if (size !== undefined) wanted = Math.min(wanted, size - start);
    if (wanted <= 0 || start < 0) return EMPTY;
    if (head && start < head.length) {
      const held = head.subarray(start, Math.min(head.length, start + wanted));
      if (start + wanted <= head.length) return held;
      return join(held, await read(head.length, start + wanted - head.length, signal));
    }
    return fromNetwork(start, wanted, signal);
  }

  return {
    get size() {
      return size;
    },
    read,
    stats,
    failure: () => failed,
    close() {
      closed = true;
      stopWalk?.();
    },
  };
}
