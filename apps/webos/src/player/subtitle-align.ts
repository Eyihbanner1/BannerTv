import {
  alignSubtitlesInSlices,
  type Cue,
  fileReleaseMatch,
  type LineTiming,
  linkedToVideo,
  otherEpisode,
  type Slicing,
  type SubtitleAlignment,
  type SubtitleFit,
} from '@bannertv/core';
import { type LineMove, retimeCues } from './drift';
import type { EngineTrack } from './engines/types';
import type { PickableSubtitle, PlayingRelease } from './subtitle-pick';

/*
 * Lining subtitle files up against the video by themselves (ADR 0003): a
 * file that is right for the video but a few seconds out, or timed for
 * another frame rate, is moved onto the timing of a reference known to fit
 * it. The reference is, in this order, the stream's own subtitle track in
 * any language (its lines come in step with the picture); a file the addon
 * found by the video's hash with no name saying otherwise; a file named for
 * the video's release, with the group confirming it. A file is a reference
 * only once it has been read as whole, with no drift. A group of files that
 * agree with each other is never one: they may all be for another cut. With
 * no reference, nothing is moved.
 */

/** What the files are lined up against. */
export type ReferenceKind = 'track' | 'linked' | 'release';

export interface Reference {
  kind: ReferenceKind;
  /** The track's id, or the file's link. */
  id: string;
  lines: readonly LineTiming[];
  /** Still arriving: the stream's own lines, as the engine hands them over while the video plays. */
  growing: boolean;
}

/** Lines a reference needs before anything is lined up against it: as the aligner needs. */
export const MIN_REFERENCE_LINES = 40;

/**
 * Minutes of a reference still arriving at which the files are lined up
 * against it: the first look, then again as it grows, then once it covers
 * the video, so a file is lined up again twice at most. Against ten
 * minutes most files cannot be told for sure, against twenty a quarter
 * can, and against forty nearly all. Minutes with lines, not the span from
 * the first line to the last: a stretch the viewer skipped has none.
 */
const GROWING_STAGES = [20, 40];
/** A reference that covers the video: no more of it is coming. */
const COMPLETE = GROWING_STAGES.length + 1;
/**
 * A stream track covers the video once its lines reach this share of the
 * video's length (the end credits have no lines)...
 */
const COMPLETE_SHARE = 0.75;
/**
 * ...and its stretches with lines add up to this share of it: a play
 * resumed late in the film, or a skip to its end, reaches the end with a
 * few minutes of lines.
 */
const COVERED_SHARE = 0.5;
/** Runs at most for one file against references still arriving. */
const MAX_RUNS = COMPLETE;
/**
 * A track says a file is for another video only with no stretch longer
 * than this without a line: one the viewer skipped through has gaps the
 * aligner would take for silence. Stretches with lines are counted so too.
 */
const LONGEST_SILENCE = 300;
/** Share of the file a sure answer must be checked against to stand for good. */
const FINAL_SHARE = 0.5;

/**
 * Whether the engine can hand over a track's lines without showing them, so
 * it can be a reference while a file shows: hls.js and Shaka always (BannerTV
 * draws every line); Android only for a track it says is text, as it draws
 * picture subtitles (PGS, VobSub, DVB) itself. Never a track of forced lines
 * only. The TV's own player lists no tracks.
 */
export function readableTrack(track: EngineTrack, engine: string | null): boolean {
  if (track.forced) return false;
  if (engine === 'hls.js' || engine === 'shaka') return true;
  return engine === 'android' && track.picture === false;
}

/**
 * The stream's track to line files up against, and to read while a file
 * shows: of those the engine can read without showing them, the one that
 * has handed over the most lines, else the first.
 */
export function referenceTrack(
  tracks: readonly EngineTrack[],
  engine: string | null,
  timings: Readonly<Record<string, readonly LineTiming[]>>,
): EngineTrack | null {
  let best: EngineTrack | null = null;
  let most = -1;
  for (const track of tracks) {
    if (!readableTrack(track, engine)) continue;
    const lines = timings[track.id]?.length ?? 0;
    if (lines > most) {
      best = track;
      most = lines;
    }
  }
  return best;
}

/** Whether a file read whole, with no drift: what a file must be to be a reference. */
export function readsWhole(fit: SubtitleFit | undefined): boolean {
  return (
    !!fit &&
    !fit.unfit &&
    fit.script !== 'wrong' &&
    fit.length === 'fits' &&
    fit.drift === undefined &&
    !fit.runsOn
  );
}

/** What a stream track's lines so far cover of the video. */
export interface TrackCoverage {
  /**
   * Seconds in stretches with lines: from a line to the last before a
   * silence longer than LONGEST_SILENCE, added up.
   */
  heard: number;
  /** Where the last line ends, in seconds. */
  lastEnd: number;
  /** Whether it has a silence longer than LONGEST_SILENCE between two lines (a skip). */
  gap: boolean;
}

export function trackCoverage(lines: readonly LineTiming[]): TrackCoverage {
  const order = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isFinite(line.start))
    // By start, with the position as the tie-break: Chromium 68's sort is not stable.
    .sort((a, b) => a.line.start - b.line.start || a.index - b.index);
  let heard = 0;
  let gap = false;
  let lastEnd = 0;
  let runStart = -Infinity;
  let runEnd = -Infinity;
  for (const { line } of order) {
    const end = isFinite(line.end) ? Math.max(line.end, line.start) : line.start;
    if (end > lastEnd) lastEnd = end;
    if (line.start - runEnd > LONGEST_SILENCE) {
      if (runEnd > runStart) heard += runEnd - runStart;
      if (runEnd !== -Infinity) gap = true;
      runStart = line.start;
      runEnd = end;
    } else if (end > runEnd) {
      runEnd = end;
    }
  }
  if (runEnd > runStart) heard += runEnd - runStart;
  return { heard, lastEnd, gap };
}

/**
 * Whether a stream track's lines cover the video, so no more is coming
 * that would change an answer: they reach COMPLETE_SHARE of its length,
 * and their stretches with lines add up to COVERED_SHARE of it.
 */
function trackComplete(lines: readonly LineTiming[], duration: number): boolean {
  if (!(duration > 0)) return false;
  const { heard, lastEnd } = trackCoverage(lines);
  return lastEnd >= COMPLETE_SHARE * duration && heard >= COVERED_SHARE * duration;
}

export interface ReferenceInput<T extends PickableSubtitle> {
  /** The stream's track read for a reference, and its lines so far, if any. */
  track: { id: string; lines: readonly LineTiming[] } | null;
  /** The video's length in seconds, 0 while unknown. */
  duration: number;
  offered: readonly T[];
  /** What reading each file found, judged in its own language. */
  fit: (option: T) => SubtitleFit | undefined;
  /** Each file's lines, once read. */
  lines: (url: string) => readonly LineTiming[] | undefined;
  broken: (url: string) => boolean;
  video: PlayingRelease;
}

/**
 * The reference to line files up against, if any: the stream's own track
 * once its lines cover the video (`trackComplete`); a file read whole and linked to the video
 * by its hash (`linkedToVideo`); one read whole and named for its release
 * (the same name, or the group confirming it); else the stream's track while
 * its lines still arrive, once it has enough of them. The reference used
 * before (`previous`) stays while it still is one and nothing of a better
 * kind has come, so files are not lined up against one and then another.
 */
export function findReference<T extends PickableSubtitle>(
  input: ReferenceInput<T>,
  previous?: Pick<Reference, 'kind' | 'id'> | null,
): Reference | null {
  // Each reference there is, best kind first.
  const found: Array<{ rank: number; reference: Reference }> = [];
  const { track } = input;
  if (track && track.lines.length >= MIN_REFERENCE_LINES) {
    const growing = !trackComplete(track.lines, input.duration);
    const reference: Reference = { kind: 'track', id: track.id, lines: track.lines, growing };
    found.push({ rank: growing ? 3 : 0, reference });
  }
  for (const option of input.offered) {
    if (input.broken(option.url) || otherEpisode(option, input.video)) continue;
    const lines = input.lines(option.url);
    if (!readsWhole(input.fit(option)) || !lines || lines.length < MIN_REFERENCE_LINES) continue;
    const match = fileReleaseMatch(option, input.video);
    const kind: ReferenceKind | null = linkedToVideo(option, input.video)
      ? 'linked'
      : match === 'exact' || match === 'group'
        ? 'release'
        : null;
    if (kind === null || found.some((entry) => entry.reference.id === option.url)) continue;
    found.push({
      rank: kind === 'linked' ? 1 : 2,
      reference: { kind, id: option.url, lines, growing: false },
    });
  }
  if (found.length === 0) return null;
  // The best kind, the first of it in the list's order: the sort keeps ties as found.
  const best = found
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)[0]!;
  const kept = previous
    ? found.find(
        (entry) => entry.reference.kind === previous.kind && entry.reference.id === previous.id,
      )
    : undefined;
  return kept && kept.rank <= best.rank ? kept.reference : best.reference;
}

/**
 * How far a reference has come: higher as more of it has arrived (by its
 * minutes with lines), COMPLETE once whole.
 */
export function referenceStage(reference: Reference): number {
  if (!reference.growing) return COMPLETE;
  const minutes = trackCoverage(reference.lines).heard / 60;
  return GROWING_STAGES.filter((stage) => minutes >= stage).length;
}

/** What lining one file up found, against the reference as it was then. */
export interface AlignRecord {
  alignment: SubtitleAlignment;
  reference: ReferenceKind;
  referenceId: string;
  stage: number;
  /** Runs so far for this file. */
  runs: number;
  /** Milliseconds of work it took, the pauses left out. */
  ms: number;
  /** No later run will change it. */
  final: boolean;
}

/**
 * What a record says of the file, for ranking it: 'sure' it is in step once
 * moved; 'none' its timing matches nothing in the video's, said for good;
 * nothing while unclear or still to be looked at again.
 */
export function syncedOf(record: AlignRecord | undefined): SubtitleFit['synced'] {
  if (!record) return undefined;
  if (record.alignment.confidence === 'sure') return 'sure';
  return record.alignment.confidence === 'none' && record.final ? 'none' : undefined;
}

/** A fit with what lining the file up found, for ranking it. */
export function withSync(
  fit: SubtitleFit | undefined,
  synced: SubtitleFit['synced'],
): SubtitleFit | undefined {
  if (!fit || synced === undefined) return fit;
  return { ...fit, synced };
}

/** The move a sure answer makes on a file's lines. */
export function moveOf(record: AlignRecord | undefined): LineMove | null {
  if (!record || record.alignment.confidence !== 'sure') return null;
  return { offset: record.alignment.offset, rate: record.alignment.rate };
}

/** A file waiting to be lined up: its link, and its lines' timing. */
export interface AlignFile {
  url: string;
  lines: readonly LineTiming[];
}

/** One run's outcome, for Diagnostics: never a link. */
export interface AlignOutcome {
  /** The file, by link: the caller keeps no link in what it records. */
  url: string;
  record: AlignRecord;
}

/**
 * Lines files up against a reference, one at a time, in slices that leave
 * the TV's interface room to breathe (`alignSubtitlesInSlices`). Kept by
 * link, in memory only, for the video playing.
 */
export interface SubtitleAligner {
  /** What lining the file up found last, if it has been. */
  result(url: string): AlignRecord | undefined;
  /** Every file's record: a new map after each run, for useSyncExternalStore. */
  results(): ReadonlyMap<string, AlignRecord>;
  /** Whether the file waits to be lined up, or is being. */
  pending(url: string): boolean;
  /**
   * Lines the files up against the reference, those whose last answer could
   * still change: not lined up yet, or against less of a reference still
   * arriving, or against another reference before it was sure.
   */
  request(files: readonly AlignFile[], reference: Reference): void;
  subscribe(listener: () => void): () => void;
  /** Told of every run as it ends, for Diagnostics. */
  outcomes(listener: (outcome: AlignOutcome) => void): () => void;
  /** Forgets every answer and stops: for another stream of the video. */
  reset(): void;
}

/** The slicing a browser gives: a timer of 0 to let others go first. */
export const PAGE_SLICING: Slicing = {
  now: () => performance.now(),
  pause: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
  sliceMs: 8,
};

/**
 * Whether a file still needs lining up against this reference: not when its
 * answer is final, nor when it was lined up against as much of this
 * reference already, nor after MAX_RUNS.
 */
function needsRun(record: AlignRecord | undefined, reference: Reference, stage: number): boolean {
  if (stage === 0) return false;
  if (!record) return true;
  if (record.final || record.runs >= MAX_RUNS) return false;
  if (record.referenceId !== reference.id) return true;
  return stage > record.stage;
}

export function createSubtitleAligner(slicing: Slicing = PAGE_SLICING): SubtitleAligner {
  let results: ReadonlyMap<string, AlignRecord> = new Map();
  const told = new Set<(outcome: AlignOutcome) => void>();
  const queue: Array<{ file: AlignFile; reference: Reference; stage: number }> = [];
  let running: string | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

  async function run(): Promise<void> {
    const mine = generation;
    while (queue.length > 0 && mine === generation) {
      const job = queue[0]!;
      running = job.file.url;
      // Each run starts on a task of its own, not inside the one that asked for it (a player's
      // own work as it hands the track's lines over).
      await slicing.pause();
      if (mine !== generation) break;
      queue.shift();
      let paused = 0;
      const started = slicing.now();
      const alignment = await alignSubtitlesInSlices(
        job.file.lines,
        job.reference.lines,
        {
          ...slicing,
          pause: async () => {
            const before = slicing.now();
            await slicing.pause();
            paused += slicing.now() - before;
          },
        },
        { growing: job.reference.growing },
      );
      if (mine !== generation) break;
      const before = results.get(job.file.url);
      const runs = (before?.referenceId === job.reference.id ? before.runs : 0) + 1;
      const record: AlignRecord = {
        alignment,
        reference: job.reference.kind,
        referenceId: job.reference.id,
        stage: job.stage,
        runs,
        ms: Math.max(0, slicing.now() - started - paused),
        final: isFinal(alignment, job.reference),
      };
      results = new Map(results).set(job.file.url, record);
      running = null;
      told.forEach((listener) => listener({ url: job.file.url, record }));
      changed();
    }
    if (mine === generation) running = null;
  }

  return {
    result: (url) => results.get(url),
    results: () => results,
    pending: (url) => running === url || queue.some((job) => job.file.url === url),
    request(files, reference) {
      const stage = referenceStage(reference);
      const idle = running === null && queue.length === 0;
      let added = false;
      for (const file of files) {
        if (file.url === reference.id || file.lines.length === 0) continue;
        if (!needsRun(results.get(file.url), reference, stage)) continue;
        // A run already waiting takes the reference as it is now.
        const waiting = queue.find((job) => job.file.url === file.url);
        if (waiting) {
          waiting.reference = reference;
          waiting.stage = stage;
          continue;
        }
        if (running === file.url) continue;
        queue.push({ file, reference, stage });
        added = true;
      }
      if (added && idle) void run();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    outcomes(listener) {
      told.add(listener);
      return () => {
        told.delete(listener);
      };
    },
    reset() {
      generation++;
      queue.length = 0;
      running = null;
      if (results.size > 0) {
        results = new Map();
        changed();
      }
    },
  };
}

/**
 * Whether an answer stands for good. A sure one, unless it was found
 * against a reference still arriving that covers under half of the file:
 * a later look may find it out by a little, and then moves the lines
 * again. Any answer against a reference that will not grow. One that says
 * the file is for another video only where the track it was found against
 * has no long stretch without a line (none skipped through); a file
 * reference is a whole file, whose silences are the film's.
 */
export function isFinal(
  alignment: Pick<SubtitleAlignment, 'confidence' | 'coveredShare'>,
  reference: Pick<Reference, 'kind' | 'growing' | 'lines'>,
): boolean {
  const { confidence } = alignment;
  if (confidence === 'sure') return !reference.growing || alignment.coveredShare >= FINAL_SHARE;
  if (confidence === 'unsure') return !reference.growing;
  if (reference.kind !== 'track') return true;
  return reference.lines.length > 0 && !trackCoverage(reference.lines).gap;
}

/** The cues moved onto the video's clock by a move: a line the file times at t shows at t / rate + offset. */
export function moveCues(cues: readonly Cue[], move: LineMove): Cue[] {
  return retimeCues(cues, (t) => t / move.rate + move.offset);
}

/** How far, at most, one way of showing a file's lines puts them from another, over the file. */
export function moveSize(from: LineMove, to: LineMove, lines: readonly LineTiming[]): number {
  if (lines.length === 0) return 0;
  let first = Infinity;
  let last = -Infinity;
  for (const line of lines) {
    if (line.start < first) first = line.start;
    if (line.end > last) last = line.end;
  }
  const at = (t: number, move: LineMove) => t / move.rate + move.offset;
  return Math.max(
    Math.abs(at(first, to) - at(first, from)),
    Math.abs(at(last, to) - at(last, from)),
  );
}

/**
 * Once a file's lines have started to show, lining it up moves them only if
 * they move this far (seconds), and only so many times in a stream: lines
 * that jump about are worse than lines a little out.
 */
export const LATE_MOVE_S = 0.3;
export const MAX_LATE_MOVES = 2;

/** What is done with a sure answer from lining a file up: its lines moved, or left, and why. */
export interface MoveDecision {
  move: LineMove | null;
  /** Left as they showed: already in step, set by the viewer first, or too late in the stream. */
  left?: 'inStep' | 'yours' | 'late';
  /** Moved after its lines had started to show. */
  late?: boolean;
}

/**
 * Whether to make a sure move on the file showing, decided once for the
 * file in a stream. Not where the viewer set its timing on this stream
 * before the move came: theirs stands. Before its first line shows
 * (`early`), the move is made; after, only when it puts the lines at least
 * LATE_MOVE_S from where they show (`before`, against `after`), and only
 * while fewer than MAX_LATE_MOVES such moves were made in the stream.
 */
export function decideMove(input: {
  move: LineMove;
  before: LineMove;
  after: LineMove;
  lines: readonly LineTiming[];
  early: boolean;
  touched: boolean;
  lateMoves: number;
}): MoveDecision {
  if (input.touched) return { move: null, left: 'yours' };
  if (input.early) return { move: input.move };
  if (moveSize(input.before, input.after, input.lines) < LATE_MOVE_S) {
    return { move: null, left: 'inStep' };
  }
  if (input.lateMoves >= MAX_LATE_MOVES) return { move: null, left: 'late' };
  return { move: input.move, late: true };
}

/** Lines' timing, for lining them up: only lines with a start and an end. */
export function timingOf(cues: readonly LineTiming[]): LineTiming[] {
  const lines: LineTiming[] = [];
  for (const cue of cues) {
    if (isFinite(cue.start) && isFinite(cue.end) && cue.end > cue.start) {
      lines.push({ start: cue.start, end: cue.end });
    }
  }
  return lines;
}
