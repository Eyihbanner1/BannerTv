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
 * Why the file can no longer be read this way: the server answers a range
 * with the whole file or another piece of it; the first request was blocked
 * (cross-origin checks, or no network: the page cannot tell which); the
 * server refused the reads, or the walks allowed are used up; the link the
 * walk led to refused its first read straight to it, as a link good for one
 * use does; the first answer says it is another kind of file; or the caller
 * aborted the read (which is not kept).
 */
export type FileReadFailure =
  'no-range' | 'blocked' | 'refused' | 'one-use' | 'not-matroska' | 'aborted';

/** A read that failed, by its code alone: never a link. */
export class FileReadError extends Error {
  constructor(readonly code: FileReadFailure) {
    super(code);
    this.name = 'FileReadError';
  }
}

/** Walks through the stream's link in a play, at most: the first, and two after links that expired. */
export const MAX_WALKS = 3;

export interface FetchSourceOptions {
  /** The stream's own link. */
  link: string;
  /** Where the hash read's walk landed, which answered its reads straight: for this play only. */
  landed?: string;
  /** The hash read's first 64 KB, served from memory. */
  head?: Uint8Array;
  /** The file's size, only from a Content-Range seen. */
  size?: number;
  maxWalks?: number;
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
  failure(): Exclude<FileReadFailure, 'aborted'> | undefined;
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
  | { kind: 'refused'; typeError: boolean }
  | { kind: 'aborted' };

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

/**
 * A ByteSource over the file at `options.link`. Reads inside `head` come from
 * memory. Others go to the link the last walk landed on; a walk is a read
 * through the stream's link, whose answer says where it led. A link that
 * served reads and then refuses one has expired: the read walks again, while
 * fewer than `maxWalks` walks were made. One that refuses its very first read
 * is good for one use: the read walks once more, and the source then gives up
 * ('one-use'), as walking for every line would ration the service. No time
 * limit of its own: the callers abort their reads (ByteSource).
 */
export function createFetchSource(
  options: FetchSourceOptions,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): FetchSource {
  const { link, head } = options;
  const maxWalks = options.maxWalks ?? MAX_WALKS;
  let landed = options.landed;
  // The hash read's walk landed there and its later reads were answered there.
  let served = landed !== undefined;
  let size = options.size;
  let failed: Exclude<FileReadFailure, 'aborted'> | undefined;
  // A walk in flight, which reads refused meanwhile wait for rather than walk again.
  let walking: Promise<void> | null = null;
  // The kind of file is checked on the first answer when the head is read here.
  let kindUnchecked = !head;
  const stats: FetchStats = { requests: 0, bytes: 0, walks: 0 };

  const fail = (code: FileReadFailure): never => {
    if (code !== 'aborted' && failed === undefined) failed = code;
    throw new FileReadError(code === 'aborted' ? code : failed!);
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
        return { kind: 'refused', typeError: error instanceof TypeError };
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
        return { kind: 'refused', typeError: false };
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
      return signal?.aborted ? { kind: 'aborted' } : { kind: 'refused', typeError: false };
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  /** What a read's answer gives, or why the source gives up; a refusal is the caller's. */
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
      default:
        return fail('refused');
    }
  }

  /**
   * A read through the stream's link, its walk shared with reads waiting on it; `then`, the
   * source gives up once it is read, before those reads go on.
   */
  async function walk(
    start: number,
    length: number,
    signal: ReadSignal | undefined,
    then?: 'one-use',
  ) {
    let done!: () => void;
    walking = new Promise<void>((resolve) => (done = resolve));
    try {
      stats.walks++;
      const first = stats.requests === 0;
      const answer = await fetchRange(link, start, length, signal);
      if (answer.kind === 'bytes') {
        landed = answer.url;
        served = false;
      }
      if (answer.kind === 'refused' && first && answer.typeError) return fail('blocked');
      const bytes = settle(answer);
      if (then) failed = then;
      return bytes;
    } finally {
      walking = null;
      done();
    }
  }

  async function fromNetwork(
    start: number,
    length: number,
    signal: ReadSignal | undefined,
  ): Promise<Uint8Array> {
    for (;;) {
      if (walking) await walking;
      if (failed) return fail(failed);
      if (signal?.aborted) return fail('aborted');
      if (landed === undefined) return walk(start, length, signal);
      const at = landed;
      const answer = await fetchRange(at, start, length, signal);
      if (answer.kind !== 'refused') {
        if (answer.kind === 'bytes' && landed === at) served = true;
        return settle(answer);
      }
      // Another read walked meanwhile: this one goes to where that led.
      if (landed !== at || walking) continue;
      if (failed) return fail(failed);
      // The stream's link itself, with no redirect: nothing else to try.
      if (at === link) return fail('refused');
      if (!served) {
        // Refused at its first read straight to it: good for one use. The read in hand walks once.
        return walk(start, length, signal, 'one-use');
      }
      // Expired: walked again while the walks allowed last.
      if (stats.walks >= maxWalks) return fail('refused');
      return walk(start, length, signal);
    }
  }

  async function read(start: number, length: number, signal?: ReadSignal): Promise<Uint8Array> {
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
  };
}
