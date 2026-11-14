import type { Cue } from '../subtitles/types';
import { type CueEntry, cueTimings, type LineTiming, type MatroskaFile } from './matroska';
import {
  type BlockReaderOptions,
  type BlockReaderStats,
  createBlockReader,
  type LineRequest,
  type LineResult,
  type PlannedRead,
} from './matroska-blocks';

/**
 * Keeps a text track's lines loaded around the playhead, about 5 s behind
 * it to 120 s ahead: it reads again once less than a minute ahead is
 * planned, so each batch of reads covers a minute or more and blocks close
 * together share a read. At most 4 reads are in flight. After a seek the
 * reads not yet made are dropped and the new window is planned, its first
 * lines first; reads already in flight still land in the cache. The cache
 * holds a bounded number of lines and lets go of those farthest from the
 * playhead first, as the TV is short of memory.
 */

export interface MatroskaWindowOptions extends BlockReaderOptions {
  /** Seconds kept loaded before the playhead. */
  behind?: number;
  /** Seconds kept loaded after it. */
  ahead?: number;
  /** Reads again once less than this many seconds after the playhead are planned. */
  refill?: number;
  /** Reads in flight at once. */
  maxInFlight?: number;
  /** Lines kept in memory. */
  maxLines?: number;
  /** Times a read that failed is tried for the same lines. */
  maxAttempts?: number;
}

export interface MatroskaWindowStats extends BlockReaderStats {
  /** Reads made for lines (the head and the Cues not counted). */
  requests: number;
  bytes: number;
  inFlight: number;
  /** The most reads that were in flight at once. */
  peakInFlight: number;
  queued: number;
  /** Lines read and kept, with or without a cue. */
  cached: number;
  evicted: number;
  failedReads: number;
}

export interface MatroskaWindow {
  readonly track: number;
  /** Every line's time from the Cues, read or not. */
  readonly timings: readonly LineTiming[];
  /** Where the video is, in seconds: on every clock tick and after a seek. */
  update(time: number): void;
  /** The lines in memory as cues, by start; the same array until one is read or let go. */
  cues(): readonly Cue[];
  /** Called after lines are read or let go. Returns a function that stops it. */
  onChange(listener: () => void): () => void;
  /** Resolves once nothing is queued or in flight. */
  settled(): Promise<void>;
  stats(): MatroskaWindowStats;
  /** Stops reading; reads in flight are let go when they land. */
  close(): void;
}

const BEHIND = 5;
const AHEAD = 120;
const REFILL = 60;
const MAX_IN_FLIGHT = 4;
const MAX_LINES = 800;
const MAX_ATTEMPTS = 3;
/** A jump back of more than this, or forward of more than SEEK_FORWARD, is a seek. */
const SEEK_BACK = 1;
const SEEK_FORWARD = 10;
/** How long a line nothing gives a length to counts as being up, to place it in a window. */
const NO_DURATION = 4;
const LONGEST_LINE = 60;

const MISSING = 0;
const PENDING = 1;
const LOADED = 2;
const FAILED = 3;

function requestsFor(entries: readonly CueEntry[], indexes: readonly number[]): LineRequest[] {
  return indexes.map((index) => {
    const line: LineRequest = { index, entry: entries[index]! };
    const next = entries[index + 1];
    if (next) line.nextTime = next.time;
    return line;
  });
}

/** Wraps a reader so its reads are counted apart from the head's and the Cues'. */
function countingFile(
  file: MatroskaFile,
  stats: { requests: number; bytes: number },
): MatroskaFile {
  const { source } = file;
  return {
    ...file,
    source: {
      size: source.size,
      async read(start, length) {
        const wanted = source.size === undefined ? length : Math.min(length, source.size - start);
        if (wanted <= 0) return new Uint8Array(0);
        stats.requests++;
        const bytes = await source.read(start, wanted);
        stats.bytes += bytes.length;
        return bytes;
      },
    },
  };
}

/** The window over one text track; `entries` are its cue points from readMatroskaCues. */
export function createMatroskaWindow(
  file: MatroskaFile,
  track: number,
  entries: readonly CueEntry[],
  options: MatroskaWindowOptions = {},
): MatroskaWindow {
  const behind = options.behind ?? BEHIND;
  const ahead = options.ahead ?? AHEAD;
  const refill = options.refill ?? REFILL;
  const maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT;
  const maxLines = options.maxLines ?? MAX_LINES;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const counts = { requests: 0, bytes: 0 };
  const reader = createBlockReader(countingFile(file, counts), track, options);
  const timings = cueTimings(file, entries);
  const starts = timings.map((timing) => timing.start);
  const ends = timings.map((timing) => timing.end ?? timing.start + NO_DURATION);
  let longest = 0;
  for (let i = 0; i < starts.length; i++) longest = Math.max(longest, ends[i]! - starts[i]!);
  longest = Math.min(longest, LONGEST_LINE);

  const state = new Uint8Array(entries.length);
  const attempts = new Uint8Array(entries.length);
  const loaded = new Map<number, Cue | null>();
  const listeners = new Set<() => void>();
  let waiters: Array<() => void> = [];
  let queue: PlannedRead[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  let evicted = 0;
  let failedReads = 0;
  let lastTime = NaN;
  let plannedUntil = -Infinity;
  let retry = false;
  let closed = false;
  let memo: Cue[] | undefined;

  /** The first line that could still be up at `time`. */
  function firstFrom(time: number): number {
    let low = 0;
    let high = starts.length;
    const from = time - longest;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! < from) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function plan(time: number) {
    const from = time - behind;
    const to = time + ahead;
    const wanted: number[] = [];
    for (let i = firstFrom(from); i < starts.length && starts[i]! < to; i++) {
      if (state[i] === MISSING && ends[i]! > from) wanted.push(i);
    }
    plannedUntil = to;
    if (wanted.length === 0) return;
    for (const index of wanted) state[index] = PENDING;
    // The reads for the lines nearest the playhead first.
    const reads = reader.plan(requestsFor(entries, wanted)).map((read, order) => {
      let first = Infinity;
      for (const line of read.lines) first = Math.min(first, line.index);
      return { read, first, order };
    });
    reads.sort((a, b) => a.first - b.first || a.order - b.order);
    for (const { read } of reads) queue.push(read);
    pump();
  }

  function changed() {
    memo = undefined;
    for (const listener of Array.from(listeners)) listener();
  }

  function distance(index: number, time: number): number {
    const from = time - behind;
    const to = time + ahead;
    if (ends[index]! <= from) return from - ends[index]!;
    if (starts[index]! >= to) return starts[index]! - to;
    return 0;
  }

  function evict() {
    if (loaded.size <= maxLines) return;
    const time = isNaN(lastTime) ? 0 : lastTime;
    const order = Array.from(loaded.keys()).sort((a, b) => distance(b, time) - distance(a, time));
    for (let i = 0; i < order.length && loaded.size > maxLines; i++) {
      const index = order[i]!;
      loaded.delete(index);
      state[index] = MISSING;
      evicted++;
    }
  }

  function store(results: readonly LineResult[]) {
    for (const result of results) {
      if (state[result.index] === LOADED) continue;
      state[result.index] = LOADED;
      loaded.set(result.index, result.cue ?? null);
    }
    evict();
  }

  function failed(read: PlannedRead) {
    failedReads++;
    for (const line of read.lines) {
      if (state[line.index] !== PENDING) continue;
      const tried = attempts[line.index]! + 1;
      attempts[line.index] = tried;
      state[line.index] = tried >= maxAttempts ? FAILED : MISSING;
    }
    retry = true;
  }

  function settle() {
    if (queue.length > 0 || inFlight > 0) return;
    const done = waiters;
    waiters = [];
    for (const resolve of done) resolve();
  }

  function pump() {
    while (!closed && inFlight < maxInFlight && queue.length > 0) {
      const read = queue.shift()!;
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      reader.run(read).then(
        (results) => {
          inFlight--;
          if (closed) return settle();
          store(results);
          changed();
          pump();
          settle();
        },
        () => {
          inFlight--;
          if (!closed) failed(read);
          pump();
          settle();
        },
      );
    }
    settle();
  }

  return {
    track,
    timings,
    update(time) {
      if (closed || !isFinite(time)) return;
      const seek =
        isNaN(lastTime) ||
        time < lastTime - SEEK_BACK ||
        time > lastTime + SEEK_FORWARD ||
        time > plannedUntil;
      lastTime = time;
      if (seek) {
        for (const read of queue) {
          for (const line of read.lines)
            if (state[line.index] === PENDING) state[line.index] = MISSING;
        }
        queue = [];
      }
      if (seek || retry || plannedUntil - time < refill) {
        retry = false;
        plan(time);
      }
    },
    cues() {
      if (!memo) {
        const indexes = Array.from(loaded.keys()).sort((a, b) => a - b);
        memo = [];
        for (const index of indexes) {
          const cue = loaded.get(index);
          if (cue) memo.push(cue);
        }
      }
      return memo;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settled() {
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        settle();
      });
    },
    stats() {
      return {
        ...reader.stats,
        problems: { ...reader.stats.problems },
        requests: counts.requests,
        bytes: counts.bytes,
        inFlight,
        peakInFlight,
        queued: queue.length,
        cached: loaded.size,
        evicted,
        failedReads,
      };
    },
    close() {
      closed = true;
      queue = [];
      listeners.clear();
      settle();
    },
  };
}

export interface MatroskaLines {
  /** By start, one for each line with something to draw. */
  cues: Cue[];
  /** One for each entry, in the entries' order. */
  results: LineResult[];
  stats: BlockReaderStats & { requests: number; bytes: number };
}

/** Reads every line of a text track at once, `maxInFlight` reads at a time. */
export async function readMatroskaLines(
  file: MatroskaFile,
  track: number,
  entries: readonly CueEntry[],
  options: BlockReaderOptions & { maxInFlight?: number } = {},
): Promise<MatroskaLines> {
  const counts = { requests: 0, bytes: 0 };
  const reader = createBlockReader(countingFile(file, counts), track, options);
  const reads = reader.plan(
    requestsFor(
      entries,
      entries.map((_, index) => index),
    ),
  );
  const results: LineResult[] = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < reads.length) {
      const read = reads[next++]!;
      for (const result of await reader.run(read)) results[result.index] = result;
    }
  };
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < (options.maxInFlight ?? MAX_IN_FLIGHT); i++) workers.push(worker());
  await Promise.all(workers);
  const cues: Cue[] = [];
  for (const result of results) if (result?.cue) cues.push(result.cue);
  return { cues, results, stats: { ...reader.stats, ...counts } };
}
