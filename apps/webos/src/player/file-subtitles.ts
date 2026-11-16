import {
  type ByteSource,
  createMatroskaWindow,
  type Cue,
  cueTimings,
  hearingName,
  type Inflate,
  isForcedName,
  languageKey,
  type LineTiming,
  type MatroskaCueEntry,
  type MatroskaFile,
  type MatroskaOpened,
  type MatroskaRejection,
  type MatroskaWindow,
  type MatroskaWindowClock,
  openMatroska,
  type ReadCanceller,
  readCanceller,
  type ReadSignal,
  readableTextTracks,
  readMatroskaCues,
} from '@bannertv/core';
import { mark } from '../platform/marks';
import { isCommentary } from './audio';
import type { Engine, EngineListener, EngineTrack } from './engines/types';
import { createFetchSource, FileReadError, type FetchSource } from './file-source';
import {
  type HashReading,
  hashReadingFor,
  hashSkip,
  type Landing,
  takeLanding,
} from './stream-hash';

/*
 * The video file's own subtitles on the TV's own player (ADR 0003, item 9).
 * webOS plays a Matroska or WebM file's video and sound but never shows its
 * subtitle tracks, so the page reads them itself, by byte ranges: the head
 * and the Cues, the file's index, once the picture has played for a moment,
 * then a chosen track's lines a window at a time around the playhead
 * (`createMatroskaWindow`). Its text tracks are listed as the stream's own,
 * and drawn by BannerTV's subtitle layer like an addon's file. Every track's
 * timing is in the Cues, read with none of its text: it is the best
 * reference to line addon files up against, shown or not. Whatever fails,
 * the stream's subtitles are as they were without it.
 */

/** After the first picture, the reader waits this long playing before it reads. */
export const START_AFTER_MS = 1500;
/** The automatic choice waits for the file's tracks this long at most after the reader starts. */
export const FILE_WAIT_MS = 6000;
/**
 * A play that opens this far into the video (a resume, a stream changed mid-film, Try again)
 * holds no choice back: lines are due as it opens, and the file's tracks take over once listed.
 */
export const HOLD_BEFORE_S = 1;
/** The head and the Cues are given this long together. */
export const OPEN_MS = 20000;
/** A read of the head or the Cues the server was too busy for is tried again this often, 1 s then 2 s. */
const OPEN_RETRIES = 2;
/**
 * A track's Cues give this share of its lines an end, or its timing is not taken as whole; and
 * a place in the file, or its lines are not listed to show.
 */
export const DURATION_SHARE = 0.9;
/** A line the Cues give no end lasts this long at most, or until the next. */
const NO_END_S = 4;
/** Reads for lines in flight at once, beside the TV's own connection for the video. */
const LINE_READS = 2;

/** What the session knows of the file before it plays: its name, when the addon gave it. */
export interface FileHints {
  name?: string;
}

/** What a file's name says it is. */
export type FileKind = 'matroska' | 'other' | 'unknown';

const MATROSKA_NAME = /\.(mkv|mk3d|webm)$/i;
const OTHER_NAME = /\.(mp4|m4v|mov|avi|ts|m2ts|wmv|flv|mpg|iso)$/i;

/**
 * Matroska (MKV, WebM), another kind, or a name that does not say (a
 * debrid service's link with no extension): those are tried, and the bytes
 * decide.
 */
export function fileKindOf(name: string | undefined): FileKind {
  const bare = (name ?? '').replace(/[?#].*$/, '').trim();
  if (MATROSKA_NAME.test(bare)) return 'matroska';
  return OTHER_NAME.test(bare) ? 'other' : 'unknown';
}

/** A link's last path segment: its file name, where it has one. */
function nameOfLink(url: string): string {
  const path = url.replace(/[?#].*$/, '');
  const segment = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Why the file's subtitles were not read: its name says it is another kind;
 * it is not a Matroska file; its subtitles have no index; it is a recording
 * with no index; it has no subtitles; it could not be read, or its index is
 * too large; the server refused byte ranges, could not be read here (blocked),
 * refused the reads, gave a link good for one read, stayed too busy for every
 * read for two minutes (`BUSY_MS`), or did not answer them (busy, or no
 * network) even when asked again; or the head and the index took longer than
 * OPEN_MS.
 */
export type FileTextSkip =
  | 'named'
  | 'not-matroska'
  | 'no-index'
  | 'live'
  | 'no-subtitles'
  | 'corrupt'
  | 'too-large'
  | 'no-range'
  | 'blocked'
  | 'refused'
  | 'one-use'
  | 'busy'
  | 'unanswered'
  | 'timed-out';

/**
 * What reading the file has cost so far, kept up to date as lines are read:
 * the head and the index (`requests`, `bytes`), the walks through the
 * stream's link, and the lines read for the tracks shown.
 */
export interface FileTextCost {
  requests: number;
  bytes: number;
  walks: number;
  lines: number;
  lineRequests: number;
  lineBytes: number;
  failedReads: number;
}

/**
 * How reading the file's own subtitles went, for Diagnostics: waiting to
 * start; reading; read (the readable text tracks' languages, those this TV
 * cannot read, picture tracks, the time it took and how long after the
 * first picture it ended); or none, and why. Counts, codes and times only.
 */
export type FileTextReport =
  | { state: 'waiting' }
  | { state: 'reading' }
  | {
      state: 'read';
      text: string[];
      unreadable: number;
      picture: number;
      ms: number;
      afterFirstFrameMs: number;
      cost: FileTextCost;
      dropped?: FileTextSkip;
    }
  | { state: 'none'; why: FileTextSkip; ms: number; cost: FileTextCost };

/** Time and timers, injected so tests run on fake time. */
export type FileClock = MatroskaWindowClock;

export interface FileSubtitleDeps {
  fetcher: typeof fetch;
  clock: FileClock;
  takeLanding: (url: string) => Landing | undefined;
  hashReadingFor: (url: string) => Promise<HashReading> | undefined;
  /** As openMatroska takes it: left out, the engine's own; null, zlib is unreadable. */
  inflate?: Inflate | null;
}

const DEFAULT_DEPS: FileSubtitleDeps = {
  fetcher: (input, init) => fetch(input, init),
  clock: {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  takeLanding,
  hashReadingFor,
};

const REJECTIONS: Readonly<Record<MatroskaRejection, FileTextSkip>> = {
  'not-matroska': 'not-matroska',
  corrupt: 'corrupt',
  'too-large': 'too-large',
  'no-tracks': 'no-subtitles',
  'no-cues': 'no-index',
  unseekable: 'live',
  'cues-video-only': 'no-index',
};

/** A text track as listed, and what reading its lines needs. */
interface Listed {
  track: EngineTrack;
  number: number;
  entries: readonly MatroskaCueEntry[];
}

/** Thrown by a source that holds only the hash's first bytes, for a read past them. */
class PastHead extends Error {}

/** Each line's start and end from the Cues: a missing end is the next start, 4 s at most. */
export function wholeTimings(
  file: MatroskaFile,
  entries: readonly MatroskaCueEntry[],
): LineTiming[] {
  const timings = cueTimings(file, entries);
  const lines: LineTiming[] = [];
  for (let i = 0; i < timings.length; i++) {
    const { start, end } = timings[i]!;
    const next = timings[i + 1]?.start ?? Infinity;
    const until = end ?? Math.min(next, start + NO_END_S);
    if (isFinite(start) && until > start) lines.push({ start, end: until });
  }
  return lines;
}

/**
 * The listed tracks in their order: by the first appearance of each
 * language, then within it the full track, the one for the hard of hearing,
 * the forced one, a commentary; then the file's default first, then the
 * file's order.
 */
function inOrder(listed: Listed[], defaults: ReadonlySet<number>): Listed[] {
  const firstSeen = new Map<string, number>();
  listed.forEach((entry, index) => {
    const key = languageKey(entry.track.lang);
    if (!firstSeen.has(key)) firstSeen.set(key, index);
  });
  const kind = (track: EngineTrack) =>
    track.commentary ? 3 : track.forced ? 2 : track.hearing ? 1 : 0;
  return listed
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        firstSeen.get(languageKey(a.entry.track.lang))! -
          firstSeen.get(languageKey(b.entry.track.lang))! ||
        kind(a.entry.track) - kind(b.entry.track) ||
        Number(defaults.has(b.entry.number)) - Number(defaults.has(a.entry.number)) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

const zeroCost = (): FileTextCost => ({
  requests: 0,
  bytes: 0,
  walks: 0,
  lines: 0,
  lineRequests: 0,
  lineBytes: 0,
  failedReads: 0,
});

/**
 * The TV's own engine (`native`), with a direct-play Matroska or WebM file's
 * text subtitle tracks listed as the stream's own and their lines handed
 * over as Android's are (`listener.cues(id, cues, true)`). It plays nothing
 * itself. Not for a playlist, a link needing request headers, or a file
 * whose name says it is another kind (`fileKindOf`). The reader starts
 * START_AFTER_MS after the first picture, never while the video waits for
 * data, or as long after the video knows its length where it opened paused.
 * While a file named as Matroska may still list tracks the automatic choice
 * waits (`textComing`), FILE_WAIT_MS at most, only for a play that opens at
 * the start of the video, and not at all where the hash read is still going
 * when the reader starts.
 */
export function withFileSubtitles(
  engine: Engine,
  video: HTMLVideoElement,
  listener: EngineListener,
  hints: FileHints,
  deps: FileSubtitleDeps = DEFAULT_DEPS,
): Engine {
  const { clock } = deps;
  // Each load is a play of its own; anything an older one finds later is dropped.
  let generation = 0;
  let undo: Array<() => void> = [];
  let report: FileTextReport | null = null;
  let holding = false;
  let listed: Listed[] = [];
  // Tracks whose timing the index gives, but whose lines can't be shown here.
  let timedOnly: EngineTrack[] = [];
  let file: MatroskaFile | null = null;
  let source: FetchSource | null = null;
  let selected: string | null = null;
  let window: MatroskaWindow | null = null;
  let stopWindow: (() => void) | null = null;
  // The lines read by windows closed before the one open now.
  let before = { lines: 0, failedReads: 0 };
  let cost = zeroCost();

  const timer = (callback: () => void, ms: number) => {
    const handle = clock.setTimeout(callback, ms);
    const stop = () => clock.clearTimeout(handle);
    undo.push(stop);
    return stop;
  };

  function closeWindow() {
    if (window) {
      fold();
      const stats = window.stats();
      before = {
        lines: before.lines + stats.lines,
        failedReads: before.failedReads + stats.failedReads,
      };
      window.close();
    }
    stopWindow?.();
    window = null;
    stopWindow = null;
  }

  /**
   * The lines read so far, into the tally Diagnostics holds: the requests and bytes are the
   * source's own since the head and the index, so a read the hash's first bytes answered from
   * memory costs nothing.
   */
  function fold() {
    const stats = window?.stats();
    cost.lines = before.lines + (stats?.lines ?? 0);
    cost.failedReads = before.failedReads + (stats?.failedReads ?? 0);
    if (source && file) {
      cost.lineRequests = source.stats.requests - cost.requests;
      cost.lineBytes = source.stats.bytes - cost.bytes;
      cost.walks = source.stats.walks;
    }
  }

  function reset() {
    generation++;
    closeWindow();
    source?.close();
    undo.forEach((stop) => stop());
    undo = [];
    report = null;
    holding = false;
    listed = [];
    timedOnly = [];
    file = null;
    source = null;
    selected = null;
    before = { lines: 0, failedReads: 0 };
    cost = zeroCost();
  }

  function update() {
    const time = video.currentTime;
    if (window && isFinite(time)) window.update(time);
  }

  function load(url: string, startAt: number): Promise<void> {
    reset();
    const mine = generation;
    const current = () => mine === generation;
    const kind = fileKindOf(hints.name ?? nameOfLink(url));
    // Playlists, links needing request headers, and anything that is not one file by a link.
    if (hashSkip(url) !== undefined) return engine.load(url, startAt);
    if (kind === 'other') {
      report = { state: 'none', why: 'named', ms: 0, cost };
      mark('sub:file:none:named');
      return engine.load(url, startAt);
    }
    report = { state: 'waiting' };
    holding = kind === 'matroska' && startAt < HOLD_BEFORE_S;
    let firstPlayingAt: number | undefined;
    let startedAt: number | undefined;
    let stopStart: (() => void) | null = null;
    let landing: Landing | undefined;
    // Walks through the stream's link the hash read made: the play's walks count them in.
    let hashWalks = 0;
    // The hash read's outcome, looked at once: before the first picture where it is in already.
    let heard: Promise<boolean> | undefined;
    // Whether that outcome is in.
    let hashIn = false;
    let canceller: ReadCanceller | null = null;
    let timedOut = false;
    let done = false;

    const tell = () => {
      if (current()) listener.tracks();
    };
    const elapsed = () => (startedAt === undefined ? 0 : clock.now() - startedAt);
    const release = () => {
      if (!holding) return;
      holding = false;
      tell();
    };

    function giveUp(why: FileTextSkip) {
      if (!current() || done) return;
      done = true;
      canceller?.abort();
      source?.close();
      if (source) {
        cost.requests = source.stats.requests;
        cost.bytes = source.stats.bytes;
        cost.walks = source.stats.walks;
      }
      report = { state: 'none', why, ms: elapsed(), cost };
      mark(`sub:file:none:${why}`);
      holding = false;
      tell();
    }

    /**
     * The tracks to list, the timing of those the index timed, the tracks only timed, and how
     * many readable text tracks could not be listed (the index says nothing of where their
     * lines are).
     */
    function finish(
      opened: MatroskaFile,
      tracks: Listed[],
      whole: Record<string, LineTiming[]>,
      timing: EngineTrack[] = [],
      unlisted = 0,
    ) {
      if (!current() || done) return;
      done = true;
      file = opened;
      listed = tracks;
      timedOnly = timing;
      if (source) {
        cost.requests = source.stats.requests;
        cost.bytes = source.stats.bytes;
        cost.walks = source.stats.walks;
      }
      const subtitles = opened.tracks.filter((track) => track.kind === 'subtitle');
      report = {
        state: 'read',
        text: tracks.map((entry) => entry.track.lang),
        unreadable:
          subtitles.filter(
            (track) => track.subtitle !== 'picture' && track.unreadable !== undefined,
          ).length + unlisted,
        picture: subtitles.filter((track) => track.subtitle === 'picture').length,
        ms: elapsed(),
        afterFirstFrameMs:
          firstPlayingAt === undefined ? 0 : Math.max(0, clock.now() - firstPlayingAt),
        cost,
      };
      mark('sub:file:read');
      holding = false;
      if (Object.keys(whole).length > 0) listener.timings?.(whole);
      tell();
    }

    /** What the hash read's outcome says: whether the reader may go on. */
    function hear(): Promise<boolean> {
      if (heard) return heard;
      const reading = deps.hashReadingFor(url);
      if (!reading) return Promise.resolve(true);
      heard = reading.then((outcome) => {
        hashIn = true;
        if (!current() || done) return false;
        if ('walks' in outcome) hashWalks = outcome.walks;
        if (outcome.found) {
          if (outcome.fellBack) {
            giveUp('one-use');
            return false;
          }
        } else if ('failed' in outcome) {
          if (outcome.step === 'start') {
            if (outcome.failed === 'refused') giveUp('blocked');
            else if (outcome.failed === 'no range') giveUp('no-range');
          } else if (outcome.failed === 'refused' && outcome.step === 'end') {
            // Its read of the end was refused by the stream's own link too: so would ours be.
            giveUp('refused');
          }
          if (done) return false;
        }
        // Its first bytes are good whatever came after, and where they landed, unless that
        // refused a read later.
        landing = deps.takeLanding(url);
        return landing ? fromHead(landing) : true;
      });
      return heard;
    }

    /**
     * Reads what the hash's first bytes alone can say, with no request: another kind of file,
     * no index, or no text track to read. Whether the reader must go on, to the network.
     */
    async function fromHead(taken: Landing): Promise<boolean> {
      const { head } = taken;
      const inMemory: ByteSource = {
        size: taken.total,
        read: (start, length) =>
          start + length <= head.length || (taken.total !== undefined && taken.total <= head.length)
            ? Promise.resolve(head.subarray(start, Math.min(head.length, start + length)))
            : Promise.reject(new PastHead()),
      };
      let opened: MatroskaOpened;
      try {
        opened = await openMatroska(inMemory, { inflate: deps.inflate });
      } catch {
        return current() && !done;
      }
      if (!current() || done) return false;
      if (!opened.ok) {
        giveUp(REJECTIONS[opened.reason]);
        return false;
      }
      return !endsAtHead(opened.file);
    }

    /**
     * Ends a file whose head lists no text track to read, with no Cues read: one with no
     * subtitles at all, or pictures and tracks this TV can't read only. Whether it did.
     */
    function endsAtHead(opened: MatroskaFile): boolean {
      if (textTracksOf(opened).length > 0 || timingTracksOf(opened).length > 0) return false;
      if (opened.tracks.some((track) => track.kind === 'subtitle')) finish(opened, [], {});
      else giveUp('no-subtitles');
      return true;
    }

    async function read() {
      if (!current() || done) return;
      startedAt = clock.now();
      mark('sub:file:start');
      report = { state: 'reading' };
      const hashing = hear();
      // A hash read still going this late is slow, and so would be the head after it: the
      // choice waits no longer, and tracks found later are listed all the same.
      if (heard && !hashIn) holding = false;
      tell();
      if (holding) timer(release, FILE_WAIT_MS);
      if (!(await hashing) || !current() || done) return;
      source = createFetchSource(
        {
          link: url,
          landed: landing?.landed,
          head: landing?.head,
          size: landing?.total,
          walked: hashWalks,
          clock,
        },
        deps.fetcher,
      );
      canceller = readCanceller();
      const { signal } = canceller;
      const stopOpen = timer(() => {
        timedOut = true;
        canceller?.abort();
      }, OPEN_MS);
      try {
        const fetched = source;
        const tryRead = async (
          start: number,
          length: number,
          readSignal: ReadSignal | undefined,
          tries: number,
        ): Promise<Uint8Array> => {
          try {
            return await fetched.read(start, length, readSignal);
          } catch (error) {
            // The walks are used up, or the link is good for one use: no line can be read now.
            const failure = fetched.failure();
            if (current() && done && failure !== undefined) lost(failure);
            // The head and the Cues, which nothing else tries again, are asked for again after a
            // busy answer, or none; a line is, by the window.
            const again =
              !done &&
              tries < OPEN_RETRIES &&
              error instanceof FileReadError &&
              error.code === 'transient';
            if (!again) throw error;
            await pause(1000 * Math.pow(2, tries), readSignal);
            return tryRead(start, length, readSignal, tries + 1);
          }
        };
        const watched: ByteSource = {
          size: fetched.size,
          read: (start, length, readSignal) => tryRead(start, length, readSignal, 0),
        };
        const opened = await openMatroska(watched, { signal, inflate: deps.inflate });
        if (!current() || done) return;
        // The read in hand was answered, but no later one will be (a link good for one use).
        const stopped = fetched.failure();
        if (stopped) {
          giveUp(stopped);
          return;
        }
        if (!opened.ok) {
          giveUp(REJECTIONS[opened.reason]);
          return;
        }
        if (endsAtHead(opened.file)) return;
        const tracks = textTracksOf(opened.file);
        const timingOnly = timingTracksOf(opened.file);
        const cues = await readMatroskaCues(
          opened.file,
          tracks.concat(timingOnly).map((track) => track.number),
          { signal },
        );
        if (!current() || done) return;
        const stoppedNow = fetched.failure();
        if (stoppedNow) {
          giveUp(stoppedNow);
          return;
        }
        if (!cues.ok) {
          giveUp(REJECTIONS[cues.reason]);
          return;
        }
        const whole: Record<string, LineTiming[]> = {};
        const defaults = new Set<number>();
        const made: Listed[] = [];
        const timing: EngineTrack[] = [];
        let unlisted = 0;
        for (const track of tracks.concat(timingOnly)) {
          const id = `mkv:${track.number}`;
          const entries = cues.cues.entries.get(track.number) ?? [];
          const forced = track.forced || isForcedName(track.name ?? '');
          const listedTrack: EngineTrack = {
            id,
            lang: track.languageIetf ?? track.language,
            label: track.name ?? '',
            active: false,
            picture: false,
          };
          if (forced) listedTrack.forced = true;
          if (track.hearingImpaired || hearingName(track.name)) listedTrack.hearing = true;
          if (track.commentary || isCommentary(listedTrack)) listedTrack.commentary = true;
          const count = cues.cues.counts.get(track.number);
          const points = count?.points ?? 0;
          // Neither forced lines nor a commentary are the film's lines to line files up against.
          if (
            !forced &&
            !listedTrack.commentary &&
            count &&
            points > 0 &&
            count.duration >= DURATION_SHARE * points
          ) {
            const timings = wholeTimings(opened.file, entries);
            if (timings.length > 0) {
              whole[id] = timings;
              listedTrack.timed = true;
            }
          }
          // Lines the index gives no place in the file for are never found: such a track would
          // draw nothing, in place of a file that would.
          const shown =
            track.unreadable === undefined &&
            !!count &&
            points > 0 &&
            count.relative >= DURATION_SHARE * points;
          if (shown) {
            if (track.default) defaults.add(track.number);
            made.push({ track: listedTrack, number: track.number, entries });
          } else {
            if (track.unreadable === undefined) unlisted++;
            if (listedTrack.timed) timing.push(listedTrack);
          }
        }
        if (made.length === 0 && timing.length === 0 && timingOnly.length === 0) {
          giveUp('no-index');
          return;
        }
        finish(opened.file, inOrder(made, defaults), whole, timing, unlisted);
      } catch (error) {
        if (!current() || done) return;
        if (error instanceof FileReadError) {
          giveUp(
            error.code === 'aborted'
              ? timedOut
                ? 'timed-out'
                : 'refused'
              : error.code === 'transient'
                ? 'unanswered'
                : error.code,
          );
        } else {
          giveUp(timedOut ? 'timed-out' : 'corrupt');
        }
      } finally {
        stopOpen();
      }
    }

    /**
     * The source gave up after the tracks were listed: they go, and a file takes their place.
     * Diagnostics says why.
     */
    function lost(why: FileTextSkip) {
      if (!current() || listed.length === 0) return;
      closeWindow();
      // Their timing came from the index, read already: still a reference, though not shown.
      timedOnly = timedOnly.concat(
        listed.filter((entry) => entry.track.timed).map((entry) => entry.track),
      );
      listed = [];
      selected = null;
      fold();
      if (report?.state === 'read') report = { ...report, dropped: why };
      mark(`sub:file:dropped:${why}`);
      tell();
    }

    /** Waits `ms`, or rejects ('aborted') once `signal` aborts. */
    function pause(ms: number, signal: ReadSignal | undefined): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new FileReadError('aborted'));
          return;
        }
        const stop = () => {
          clock.clearTimeout(handle);
          reject(new FileReadError('aborted'));
        };
        const handle = clock.setTimeout(() => {
          signal?.removeEventListener('abort', stop);
          resolve();
        }, ms);
        signal?.addEventListener('abort', stop);
      });
    }

    const on = (
      type: 'playing' | 'waiting' | 'timeupdate' | 'seeking' | 'loadedmetadata',
      handler: () => void,
    ) => {
      video.addEventListener(type, handler);
      undo.push(() => video.removeEventListener(type, handler));
    };
    const startSoon = () => {
      void hear();
      if (startedAt !== undefined || done || stopStart) return;
      stopStart = timer(() => {
        stopStart = null;
        void read();
      }, START_AFTER_MS);
    };
    on('playing', () => {
      if (firstPlayingAt === undefined) {
        firstPlayingAt = clock.now();
        // However often the video waits for data before it plays on, the choice waits no longer.
        if (holding) timer(release, START_AFTER_MS + FILE_WAIT_MS);
      }
      startSoon();
    });
    // Opened paused, the video takes nothing more for now: the reader need not wait for Play.
    on('loadedmetadata', () => {
      if (video.paused) startSoon();
    });
    on('waiting', () => {
      stopStart?.();
      stopStart = null;
    });
    on('timeupdate', update);
    on('seeking', update);
    undo.push(() => canceller?.abort());

    const loading = engine.load(url, startAt);
    // A hash read already in by now is heard at once: a file it says cannot be read waits no more.
    void Promise.resolve().then(() => {
      if (current()) void hear();
    });
    return loading;
  }

  /** The text tracks to list: readable, and enabled. */
  function textTracksOf(opened: MatroskaFile) {
    return readableTextTracks(opened).filter((track) => track.enabled);
  }

  /**
   * The enabled text tracks this TV can't read the lines of only for how they are compressed
   * (zlib on webOS 5): their timing, in the index, needs none of their text.
   */
  function timingTracksOf(opened: MatroskaFile) {
    return opened.tracks.filter(
      (track) => track.subtitle === 'text' && track.unreadable === 'compression' && track.enabled,
    );
  }

  return {
    get name() {
      return engine.name;
    },
    load,
    isLive: () => engine.isLive(),
    liveWindow: () => engine.liveWindow(),
    audioTracks: () => engine.audioTracks(),
    selectAudio: (id) => engine.selectAudio(id),
    textTracks: () =>
      listed.map((entry) => ({ ...entry.track, active: entry.track.id === selected })),
    timedTracks: () => timedOnly.slice(),
    selectText(id) {
      closeWindow();
      selected = null;
      const entry = listed.find((candidate) => candidate.track.id === id);
      if (!entry || !file) return;
      const trackId = entry.track.id;
      selected = trackId;
      const opened = createMatroskaWindow(file, entry.number, entry.entries, {
        maxInFlight: LINE_READS,
        clock,
      });
      window = opened;
      let told = false;
      const hand = () => {
        if (window !== opened) return;
        told = true;
        fold();
        // Handed over whole each time, as Android's are: what the window holds now.
        listener.cues(trackId, opened.cues() as Cue[], true);
      };
      stopWindow = opened.onChange(hand);
      update();
      // Once even with no line in the window, so the track is not taken as still loading.
      void opened.settled().then(() => {
        if (!told) hand();
      });
    },
    textComing: () => holding,
    fileText: () => report,
    seeked() {
      engine.seeked?.();
      update();
    },
    destroy() {
      reset();
      return engine.destroy();
    },
  };
}
