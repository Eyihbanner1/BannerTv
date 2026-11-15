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
import { type ReadCanceller, readCanceller } from './source';

/**
 * Keeps a text track's lines loaded around the playhead, about 5 s behind
 * it to 120 s ahead: it reads again once less than a minute ahead is
 * planned, so each batch of reads covers a minute or more and blocks close
 * together share a read. At most 4 reads are in flight.
 *
 * At most 800 lines are held, as the TV is short of memory. Where more
 * than that fall in the window (a stretch of karaoke or signs, a dozen
 * lines a second), the window holds the lines up now and next, as many as
 * fit, and looks less far ahead. Lines are let go farthest first: those
 * outside the window, then those behind the playhead, then those farthest
 * ahead, and never one that is up or due in the next 10 s.
 *
 * Each read is given 15 s, then aborted and counted as failed. A seek drops
 * the reads not yet made, aborts those in flight whose lines it no longer
 * wants, and plans the new window, its first lines first; close() aborts
 * every read. The lines of a read that failed are tried again after 1 s,
 * then 2 s, 4 s and so on, at most 30 s apart, for as long as the window
 * wants them; a seek tries them again at once.
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
  /** Seconds a read is given before it is aborted and counted as failed. */
  readTimeout?: number;
  /** Seconds before a failed line is tried again, doubled each time it fails again, to 30. */
  retryDelay?: number;
  /** The time and timers the window uses; the engine's own when left out. */
  clock?: WindowClock;
}

/** Time and timers, injected so tests can run on fake time. */
export interface WindowClock {
  /** Milliseconds, as Date.now() counts them. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
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
  /** Reads that rejected or ran out of time. */
  failedReads: number;
  /** Of those, reads aborted after `readTimeout`. */
  timedOut: number;
  /** Reads in flight aborted by a seek or close() as no longer wanted. */
  aborted: number;
  /** Lines whose read failed, waiting to be tried again. */
  waiting: number;
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
  /** Resolves once nothing is queued or in flight (lines waiting to be tried again aside). */
  settled(): Promise<void>;
  stats(): MatroskaWindowStats;
  /** Stops reading, aborting the reads in flight. */
  close(): void;
}

// The core is typed without the DOM, but every engine it runs in has these.
declare const setTimeout: (callback: () => void, ms: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

const engineClock: WindowClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

const BEHIND = 5;
const AHEAD = 120;
const REFILL = 60;
const MAX_IN_FLIGHT = 4;
const MAX_LINES = 800;
const READ_TIMEOUT = 15;
const RETRY_DELAY = 1;
const RETRY_MAX = 30;
/** Lines up now or due within this many seconds are never let go. */
const KEEP_AHEAD = 10;
/** A jump back of more than this, or forward of more than SEEK_FORWARD, is a seek. */
const SEEK_BACK = 1;
const SEEK_FORWARD = 10;
/** How long a line nothing gives a length to counts as being up, to place it in a window. */
const NO_DURATION = 4;
const LONGEST_LINE = 60;
/** Ranks a line behind the playhead, then one outside the window, after every line ahead. */
const TIER = 1e9;

const MISSING = 0;
const PENDING = 1;
const LOADED = 2;

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
      async read(start, length, signal) {
        const wanted = source.size === undefined ? length : Math.min(length, source.size - start);
        if (wanted <= 0) return new Uint8Array(0);
        stats.requests++;
        const bytes = await source.read(start, wanted, signal);
        stats.bytes += bytes.length;
        return bytes;
      },
    },
  };
}

/** A read in flight. */
interface Flight {
  read: PlannedRead;
  canceller: ReadCanceller;
  timer: unknown;
  over: boolean;
}

/** A line whose read failed: how many times in a row, and when it may be tried again (ms). */
interface Waiting {
  tries: number;
  at: number;
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
  const maxLines = Math.max(1, options.maxLines ?? MAX_LINES);
  const readTimeout = options.readTimeout ?? READ_TIMEOUT;
  const retryDelay = options.retryDelay ?? RETRY_DELAY;
  const retryMax = Math.max(RETRY_MAX, retryDelay);
  const clock = options.clock ?? engineClock;
  const counts = { requests: 0, bytes: 0 };
  const reader = createBlockReader(countingFile(file, counts), track, options);
  const timings = cueTimings(file, entries);
  const starts = timings.map((timing) => timing.start);
  const ends = timings.map((timing) => timing.end ?? timing.start + NO_DURATION);
  let longest = 0;
  for (let i = 0; i < starts.length; i++) longest = Math.max(longest, ends[i]! - starts[i]!);
  longest = Math.min(longest, LONGEST_LINE);

  const state = new Uint8Array(entries.length);
  const loaded = new Map<number, Cue | null>();
  const waiting = new Map<number, Waiting>();
  const flights = new Set<Flight>();
  const listeners = new Set<() => void>();
  let waiters: Array<() => void> = [];
  let queue: PlannedRead[] = [];
  let peakInFlight = 0;
  let evicted = 0;
  let failedReads = 0;
  let timedOut = 0;
  let aborted = 0;
  let lastTime = NaN;
  /** The end of the last window planned, whatever the lines it held: past it is a seek. */
  let plannedTo = -Infinity;
  /** The film time to plan again at. */
  let refillAt = -Infinity;
  let retryTimer: unknown;
  let retryTimerAt = Infinity;
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

  function inWindow(index: number, time: number): boolean {
    return starts[index]! < time + ahead && ends[index]! > time - behind;
  }

  /**
   * How readily a line is let go at `time`, the highest first: one outside
   * the window by how far, then one behind the playhead by how far, then
   * one up now or ahead by how far ahead it starts.
   */
  function rank(index: number, time: number): number {
    const from = time - behind;
    const to = time + ahead;
    if (ends[index]! <= from) return 2 * TIER + (from - ends[index]!);
    if (starts[index]! >= to) return 2 * TIER + (starts[index]! - to);
    if (ends[index]! <= time) return TIER + (time - ends[index]!);
    return Math.max(0, starts[index]! - time);
  }

  /** Tries the waiting lines again when the first of them is due. */
  function scheduleRetry(at: number) {
    if (closed || at >= retryTimerAt) return;
    if (retryTimer !== undefined) clock.clearTimeout(retryTimer);
    retryTimerAt = at;
    retryTimer = clock.setTimeout(
      () => {
        retryTimer = undefined;
        retryTimerAt = Infinity;
        if (!closed && !isNaN(lastTime)) plan(lastTime);
      },
      Math.max(0, at - clock.now()),
    );
  }

  function plan(time: number) {
    const from = time - behind;
    const to = time + ahead;
    // Lines that failed and have since left the window are no longer waited on.
    for (const index of Array.from(waiting.keys())) {
      if (!inWindow(index, time)) waiting.delete(index);
    }
    // The lines up now or next, by start, then those behind the playhead.
    const next: number[] = [];
    const past: number[] = [];
    for (let i = firstFrom(from); i < starts.length && starts[i]! < to; i++) {
      if (ends[i]! <= from) continue;
      if (ends[i]! > time) next.push(i);
      else past.push(i);
    }
    // At most maxLines of them: those nearest the playhead, looking less far ahead if need be.
    let until = to;
    if (next.length > maxLines) {
      until = starts[next[maxLines]!]!;
      next.length = maxLines;
    }
    const room = maxLines - next.length;
    const keep =
      past.length > room ? next.concat(past.slice(past.length - room)) : next.concat(past);
    plannedTo = to;
    refillAt = until === to ? to - refill : time + (until - time) / 2;

    const now = clock.now();
    let due = Infinity;
    const wanted: number[] = [];
    for (const index of keep) {
      if (state[index] !== MISSING) continue;
      const wait = waiting.get(index);
      if (wait && wait.at > now) {
        due = Math.min(due, wait.at);
        continue;
      }
      wanted.push(index);
    }
    if (due !== Infinity) scheduleRetry(due);
    if (wanted.length === 0) return;
    wanted.sort((a, b) => a - b);
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

  function evict() {
    if (loaded.size <= maxLines) return;
    const time = isNaN(lastTime) ? 0 : lastTime;
    const order = Array.from(loaded.keys(), (index) => ({ index, rank: rank(index, time) }));
    // Chromium 68 sorts unstably: the index settles ties.
    order.sort((a, b) => b.rank - a.rank || b.index - a.index);
    for (const { index, rank: ranked } of order) {
      if (loaded.size <= maxLines || ranked < KEEP_AHEAD) break;
      loaded.delete(index);
      state[index] = MISSING;
      evicted++;
    }
  }

  function store(results: readonly LineResult[]) {
    for (const result of results) {
      waiting.delete(result.index);
      if (state[result.index] === LOADED) continue;
      state[result.index] = LOADED;
      loaded.set(result.index, result.cue ?? null);
    }
    evict();
  }

  /** Lines of a read not made, or let go of, are missing again. */
  function release(read: PlannedRead) {
    for (const line of read.lines) {
      if (state[line.index] === PENDING) state[line.index] = MISSING;
    }
  }

  function failed(read: PlannedRead) {
    failedReads++;
    const now = clock.now();
    let due = Infinity;
    for (const line of read.lines) {
      if (state[line.index] !== PENDING) continue;
      state[line.index] = MISSING;
      const tries = (waiting.get(line.index)?.tries ?? 0) + 1;
      const delay = Math.min(retryMax, retryDelay * Math.pow(2, tries - 1));
      const at = now + delay * 1000;
      waiting.set(line.index, { tries, at });
      due = Math.min(due, at);
    }
    if (due !== Infinity) scheduleRetry(due);
  }

  function settle() {
    if (queue.length > 0 || flights.size > 0) return;
    const done = waiters;
    waiters = [];
    for (const resolve of done) resolve();
  }

  function land(flight: Flight, outcome: readonly LineResult[] | 'failed' | 'timeout' | 'dropped') {
    if (flight.over) return;
    flight.over = true;
    flights.delete(flight);
    clock.clearTimeout(flight.timer);
    if (outcome === 'timeout' || outcome === 'dropped') flight.canceller.abort();
    if (outcome === 'dropped') aborted++;
    if (!closed) {
      if (outcome === 'dropped') release(flight.read);
      else if (outcome === 'failed' || outcome === 'timeout') {
        if (outcome === 'timeout') timedOut++;
        failed(flight.read);
      } else {
        store(outcome);
        changed();
      }
      pump();
    }
    settle();
  }

  function pump() {
    while (!closed && flights.size < maxInFlight && queue.length > 0) {
      const read = queue.shift()!;
      const flight: Flight = { read, canceller: readCanceller(), timer: undefined, over: false };
      flights.add(flight);
      peakInFlight = Math.max(peakInFlight, flights.size);
      flight.timer = clock.setTimeout(() => land(flight, 'timeout'), readTimeout * 1000);
      reader.run(read, flight.canceller.signal).then(
        (results) => land(flight, results),
        () => land(flight, 'failed'),
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
        time > plannedTo;
      lastTime = time;
      if (seek) {
        for (const read of queue) release(read);
        queue = [];
        // Lines that failed are tried again at once in the new window.
        waiting.clear();
        // Reads in flight for none of the new window's lines are let go.
        for (const flight of Array.from(flights)) {
          if (!flight.read.lines.some((line) => inWindow(line.index, time))) {
            land(flight, 'dropped');
          }
        }
      }
      if (seek || time >= refillAt) plan(time);
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
        inFlight: flights.size,
        peakInFlight,
        queued: queue.length,
        cached: loaded.size,
        evicted,
        failedReads,
        timedOut,
        aborted,
        waiting: waiting.size,
      };
    },
    close() {
      if (closed) return;
      closed = true;
      queue = [];
      if (retryTimer !== undefined) clock.clearTimeout(retryTimer);
      retryTimer = undefined;
      for (const flight of Array.from(flights)) land(flight, 'dropped');
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
