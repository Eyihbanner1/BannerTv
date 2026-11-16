/*
 * Lines one subtitle file up against another known to fit the video (the
 * stream's own track, a file linked to the video by its hash, or one named for
 * its release), by the timing of their lines alone, so the two may be in
 * different languages. It finds the one offset and frame-rate change that
 * puts the file's speech on the reference's, and says how sure it is: an
 * answer that stands far above every other, that holds in each part of the
 * film, with no drift left and no jump (a different cut, an advert break).
 *
 * How: each file's lines become stretches of speech (lines drawn over another,
 * as karaoke is, count once; short gaps are closed). For each frame rate, every
 * pair of stretches within MAX_OFFSET of each other votes for the offsets that
 * would put their starts on each other and their ends on each other, and
 * against those that would put a start on an end: the correlation of the two
 * files' speech edges, which is flat where nothing lines up and peaks where
 * the files agree. The highest peak over every rate is the answer, refined by
 * how much speech then overlaps. Its prominence is its height over the highest
 * answer that is clearly different (one that moves lines more than 5 s
 * elsewhere on average). The film is then cut into windows, each lined up on
 * its own near the answer: they must agree with it, a line fitted through
 * their offsets must show no drift, and no run of them may jump.
 *
 * Plain ES2017 and typed arrays, no BigInt: about 10 to 30 ms for a two-hour
 * film on a desktop, and it can run in slices (`alignSubtitlesInSlices`) so a
 * TV's interface never waits on it.
 */

/** A line's timing, in seconds on its file's clock. Cues are timings too. */
export interface LineTiming {
  start: number;
  end: number;
}

/**
 * How sure the answer is. 'sure': move the lines. 'unsure': the files match,
 * but not well enough, or not the same way all through (a drift no rate here
 * fixes, a different cut, adverts), or the reference covers too little of the
 * file to say: leave the lines alone. 'none': nothing lines up; the file is
 * for another video or another cut, as far as its timing shows.
 */
export type AlignConfidence = 'sure' | 'unsure' | 'none';

/** A file lined up against a reference. */
export interface SubtitleAlignment {
  /**
   * Seconds added once the rate is applied: a line the file times at t shows
   * at t / rate + offset, as the player's drift fix (`stretchCues`) has it.
   */
  offset: number;
  /** The file's seconds for one second of the video: 1, or one of ALIGN_RATES. */
  rate: number;
  /** Share of the file's speech, in the stretch both files cover, that lands on the reference's. */
  score: number;
  /** Share of the file's lines, in that stretch, that land on the reference's speech. */
  matched: number;
  /**
   * The same share with the file moved well away from the answer (13 to 47 s
   * either way): what chance gives, as dense dialogue lands on dense dialogue
   * anywhere.
   */
  chance: number;
  /** How evenly the matches spread: the share of tenths of that stretch whose lines match. */
  spread: number;
  /** The answer's peak over the best clearly different answer's (1 is no peak at all). */
  prominence: number;
  confidence: AlignConfidence;
  /** Each window's own offset from the answer, in seconds, or null where it showed none clearly. */
  windows: Array<number | null>;
  /** Seconds a line fitted through the windows' offsets moves over the stretch: a drift left over. */
  drift: number;
  /** Where the windows' offsets jump, and by how much: a different cut or an advert break. */
  split?: { at: number; jump: number };
  /** Seconds of the video both files cover, once lined up. */
  covered: number;
  /** That stretch as a share of the file's own, from its first line to its last. */
  coveredShare: number;
}

const FILM = 24000 / 1001;
const NTSC = 30000 / 1001;

/**
 * The rates tried, the file's seconds for one of the video's: as it is; a
 * 25 fps file on a film-speed (23.976) video and the other way round (4%); 24
 * and 23.976 (0.1%); 25 and 24; 30 and 29.97. Rate 1 first: it wins ties. 30
 * against 29.97 is the same 1001 to 1000 as 24 against 23.976, so it is worked
 * out once.
 */
export const ALIGN_RATES: readonly number[] = [
  1,
  FILM / 25,
  25 / FILM,
  FILM / 24,
  24 / FILM,
  24 / 25,
  25 / 24,
  NTSC / 30,
  30 / NTSC,
];

/** Offsets searched, in seconds either way. Files out by more are left alone. */
export const MAX_OFFSET = 300;
/** Offsets are voted for in bins this wide, in seconds, and smoothed over KERNEL bins each side. */
const BIN = 0.05;
const KERNEL = 3;
/** Gaps between lines shorter than this are closed: files differ in how they leave them. */
const MERGE_GAP = 0.3;
/** A line longer than this counts only this long: one left on by mistake says nothing more. */
const MAX_LINE = 10;
/** Lines shorter than this are not counted as lines matched (karaoke syllables, flashes). */
const MIN_LINE = 0.3;
/** A stretch of speech this short votes for less: karaoke syllables and flashes do not drown out lines. */
const FULL_WEIGHT = 1;
/** A clearly different answer moves lines more than this far, on average, from the best. */
const DIFFERENT = 5;
/** Another rate wins over rate 1 only when its peak is this much higher. */
const RATE_MARGIN = 1.02;

/** Windows: each at least this long and with this many stretches, at most MAX_WINDOWS. */
const WINDOW_SECONDS = 120;
const WINDOW_SPANS = 40;
const MAX_WINDOWS = 10;
/**
 * A window is lined up on its own over every offset searched, so a run of the
 * film that lines up far from the answer (a scene the video lacks, or has and
 * the file does not) shows as off, not unclear. Its peak near the answer must
 * stand out over the offsets within WINDOW_REACH of it, and WINDOW_NEAR of it
 * counts as near.
 */
const WINDOW_RANGE = MAX_OFFSET;
const WINDOW_REACH = 60;
const WINDOW_NEAR = 5;
const WINDOW_AGREE = 0.5;
/** A window's own peak must stand this far above the rest of its range to count. */
const WINDOW_PROMINENCE = 1.3;
/** A run of windows this far from the rest, each within SPLIT_TIGHT of its run's middle, is a split. */
const SPLIT_JUMP = 1;
const SPLIT_TIGHT = 0.5;

/*
 * The gates, calibrated on OpenSubtitles files of 18 titles (10 films, 8
 * episodes): 308 pairs of files of the same video against the files' most
 * shared timing, and 449 pairs of files for other videos (292 another film or
 * another show's episode, 157 another episode of the same show). Every pair
 * for another video peaked at 1.40 at most, and those over 1.25 had no more
 * than one window agreeing; the answers judged sure were within 0.8 s of an
 * independent FFT study's at both ends of the film. ADR 0003 item 9 has the
 * numbers.
 */
/** Under this prominence nothing lines up... */
const NONE_BELOW = 1.6;
/** ...unless it is at least this, with this many windows (and this share of them) agreeing. */
const NONE_FLOOR = 1.25;
const NONE_WINDOWS = 3;
const NONE_WINDOW_SHARE = 0.3;
/** Under this prominence there is no peak at all: nothing lines up, however few the windows. */
const NOTHING_BELOW = 1.15;
/** Sure: this prominence, most windows agreeing, at most one off, no drift or split, most lines matched. */
const SURE_PROMINENCE = 2;
const SURE_WINDOW_SHARE = 0.6;
const SURE_WINDOWS = 2;
const SURE_DRIFT = 0.6;
const SURE_MATCHED = 0.6;
/**
 * And that share this far beyond chance (0 is chance, 1 every line): with
 * fewer than FEW_WINDOWS windows usable, every one of them agreeing and
 * SURE_BEYOND_FEW beyond chance.
 */
const SURE_BEYOND = 0.25;
const FEW_WINDOWS = 4;
const SURE_BEYOND_FEW = 0.5;
/** Seconds the file is moved from the answer to see what chance gives. */
const CHANCE_SHIFTS: readonly number[] = [-47, -37, -23, -13, 13, 23, 37, 47];
/**
 * Sure needs this many lines of each file in the stretch both cover, and a
 * stretch this long. A reference still arriving (the stream's own lines as
 * they play) with less than that, or covering under MIN_COVERED_SHARE of the
 * file, never says a file is for another video: it is never passed over on
 * so little.
 */
const MIN_LINES = 40;
const MIN_COVERED = 300;
const MIN_COVERED_SHARE = 0.5;

/** Speech stretches of one file: starts, ends and votes, sorted, none overlapping. */
interface Speech {
  starts: Float64Array;
  ends: Float64Array;
  weights: Float64Array;
  count: number;
  /** Lines counted for the share matched, as [start, end] pairs in start order. */
  lineStarts: Float64Array;
  lineEnds: Float64Array;
}

function speechOf(lines: readonly LineTiming[]): Speech {
  const kept: Array<{ start: number; end: number }> = [];
  for (const line of lines) {
    const { start, end } = line;
    // Android leaves a line open (an end of Infinity) until the next one starts.
    if (!isFinite(start) || !isFinite(end) || !(end > start)) continue;
    kept.push({ start, end: Math.min(end, start + MAX_LINE) });
  }
  // By start then end, with the position as the tie-break: Chromium 68's sort is not stable.
  const order = kept.map((_, index) => index);
  order.sort((a, b) => kept[a]!.start - kept[b]!.start || kept[a]!.end - kept[b]!.end || a - b);
  const lineStarts: number[] = [];
  const lineEnds: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let latest = -Infinity;
  for (const index of order) {
    const { start, end } = kept[index]!;
    // A line drawn over another (karaoke, a second speaker's line) is not a line of its own.
    if (start >= latest - 0.05 && end - start >= MIN_LINE) {
      lineStarts.push(start);
      lineEnds.push(end);
    }
    latest = Math.max(latest, end);
    const last = ends.length - 1;
    if (last >= 0 && start <= ends[last]! + MERGE_GAP) {
      if (end > ends[last]!) ends[last] = end;
    } else {
      starts.push(start);
      ends.push(end);
    }
  }
  const weights = new Float64Array(starts.length);
  for (let i = 0; i < starts.length; i++) {
    weights[i] = Math.min(1, (ends[i]! - starts[i]!) / FULL_WEIGHT);
  }
  return {
    starts: Float64Array.from(starts),
    ends: Float64Array.from(ends),
    weights,
    count: starts.length,
    lineStarts: Float64Array.from(lineStarts),
    lineEnds: Float64Array.from(lineEnds),
  };
}

/** Where a pair loop over the candidate's stretches has got to, for running it in slices. */
interface PairCursor {
  next: number;
  first: number;
}

/**
 * Adds the edge votes of candidate stretches [from, to), mapped by `rate`, against
 * every reference stretch, into `curve` (offsets from `low`, BIN apart).
 */
function voteEdges(
  curve: Float64Array,
  low: number,
  candidate: Speech,
  reference: Speech,
  rate: number,
  from: number,
  to: number,
  cursor: PairCursor,
): void {
  const size = curve.length;
  const high = low + (size - 1) * BIN;
  const put = (at: number, vote: number) => {
    const place = (at - low) / BIN;
    if (place < 0 || place > size - 1) return;
    const bin = Math.floor(place);
    const part = place - bin;
    curve[bin] = curve[bin]! + vote * (1 - part);
    if (bin + 1 < size) curve[bin + 1] = curve[bin + 1]! + vote * part;
  };
  let first = cursor.first;
  for (let j = from; j < to; j++) {
    const a1 = candidate.starts[j]! / rate;
    const a2 = candidate.ends[j]! / rate;
    const weight = candidate.weights[j]!;
    while (first < reference.count && reference.ends[first]! - a1 < low) first++;
    for (let i = first; i < reference.count; i++) {
      const b1 = reference.starts[i]!;
      if (b1 - a2 > high) break;
      const b2 = reference.ends[i]!;
      const vote = weight * reference.weights[i]!;
      put(b1 - a1, vote);
      put(b2 - a2, vote);
      put(b1 - a2, -vote);
      put(b2 - a1, -vote);
    }
  }
  cursor.first = first;
}

/** The curve smoothed with a triangle KERNEL bins each side. */
function smooth(curve: Float64Array): Float64Array {
  const size = curve.length;
  const out = new Float64Array(size);
  const norm = (KERNEL + 1) * (KERNEL + 1);
  for (let n = 0; n < size; n++) {
    let sum = 0;
    for (let d = -KERNEL; d <= KERNEL; d++) {
      const m = n + d;
      if (m >= 0 && m < size) sum += (KERNEL + 1 - Math.abs(d)) * curve[m]!;
    }
    out[n] = sum / norm;
  }
  return out;
}

function highest(curve: Float64Array, from = 0, to = curve.length): number {
  let at = from;
  for (let n = from + 1; n < to; n++) if (curve[n]! > curve[at]!) at = n;
  return at;
}

/** The peak's place between bins, by a parabola through it and its neighbours. */
function between(curve: Float64Array, at: number): number {
  if (at <= 0 || at >= curve.length - 1) return at;
  const a = curve[at - 1]!;
  const b = curve[at]!;
  const c = curve[at + 1]!;
  const bend = a - 2 * b + c;
  return bend < 0 ? at + (0.5 * (a - c)) / bend : at;
}

/** The peak at `at` over the highest point more than `apart` seconds from it, in bins [from, to). */
function standsOut(
  curve: Float64Array,
  at: number,
  apart: number,
  from = 0,
  to = curve.length,
): number {
  let rest = 0;
  for (let n = Math.max(0, from); n < Math.min(curve.length, to); n++) {
    if (Math.abs(n - at) * BIN > apart) rest = Math.max(rest, curve[n]!);
  }
  const peak = curve[at]!;
  return peak / Math.max(rest, peak * 0.02, 1e-9);
}

/** Seconds of the candidate's speech, from stretch `from` to `to`, mapped, that lands on the reference's. */
function overlap(
  candidate: Speech,
  reference: Speech,
  rate: number,
  offset: number,
  from = 0,
  to = candidate.count,
): number {
  let i = 0;
  let total = 0;
  for (let j = from; j < to; j++) {
    const a = candidate.starts[j]! / rate + offset;
    const b = candidate.ends[j]! / rate + offset;
    while (i < reference.count && reference.ends[i]! <= a) i++;
    for (let k = i; k < reference.count && reference.starts[k]! < b; k++) {
      total += Math.min(b, reference.ends[k]!) - Math.max(a, reference.starts[k]!);
    }
  }
  return total;
}

/** How far apart two mappings put lines, on average, between the file's seconds t0 and t1. */
function apartOnAverage(
  rate1: number,
  offset1: number,
  rate2: number,
  offset2: number,
  t0: number,
  t1: number,
): number {
  const d0 = t0 / rate1 + offset1 - (t0 / rate2 + offset2);
  const d1 = t1 / rate1 + offset1 - (t1 / rate2 + offset2);
  if (d0 * d1 >= 0) return (Math.abs(d0) + Math.abs(d1)) / 2;
  return (d0 * d0 + d1 * d1) / (2 * (Math.abs(d0) + Math.abs(d1)));
}

function middle(values: readonly number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** What one window said of the answer. */
interface Window {
  at: number;
  kind: 'agrees' | 'off' | 'unclear' | 'empty';
  /** Its own offset from the answer, for those that agree or are off. */
  delta: number | null;
}

/** What the reference is. */
export interface AlignOptions {
  /**
   * The reference is still arriving (the stream's own lines, as the engine
   * hands them over while the video plays): until it covers half of the file,
   * nothing is said to be for another video.
   */
  growing?: boolean;
}

/** What a run so far has found: kept between slices. */
interface Found {
  rate: number;
  offset: number;
  peak: number;
  prominence: number;
}

/** Stretches the pair loop takes in one go, when run in slices. */
const PAIRS_STEP = 64;

const NOTHING: SubtitleAlignment = {
  offset: 0,
  rate: 1,
  score: 0,
  matched: 0,
  chance: 0,
  spread: 0,
  prominence: 1,
  confidence: 'none',
  windows: [],
  drift: 0,
  covered: 0,
  coveredShare: 0,
};

/**
 * The alignment, worked out a step at a time: each `yield` is a place to
 * pause. `alignSubtitles` runs it straight through; `alignSubtitlesInSlices`
 * gives the rest of the page a turn every few milliseconds.
 */
export function* alignSteps(
  candidateLines: readonly LineTiming[],
  referenceLines: readonly LineTiming[],
  options: AlignOptions = {},
): Generator<void, SubtitleAlignment, void> {
  const candidate = speechOf(candidateLines);
  const reference = speechOf(referenceLines);
  if (candidate.count === 0 || reference.count === 0) return NOTHING;
  yield;
  const size = Math.round((2 * MAX_OFFSET) / BIN) + 1;
  const low = -MAX_OFFSET;
  const curves: Float64Array[] = [];
  const peaks: number[] = [];
  for (let r = 0; r < ALIGN_RATES.length; r++) {
    const rate = ALIGN_RATES[r]!;
    // The same rate as one before it (30 to 29.97 is 24 to 23.976): its curve is that one's.
    const same = ALIGN_RATES.findIndex((other) => Math.abs(other - rate) < 1e-9);
    if (same < r) {
      curves.push(curves[same]!);
      peaks.push(peaks[same]!);
      continue;
    }
    const raw = new Float64Array(size);
    const cursor: PairCursor = { next: 0, first: 0 };
    while (cursor.next < candidate.count) {
      const to = Math.min(candidate.count, cursor.next + PAIRS_STEP);
      voteEdges(raw, low, candidate, reference, rate, cursor.next, to, cursor);
      cursor.next = to;
      yield;
    }
    const curve = smooth(raw);
    curves.push(curve);
    peaks.push(highest(curve));
    yield;
  }
  // The highest peak; another rate only when clearly higher than rate 1's.
  let best = 0;
  for (let r = 1; r < ALIGN_RATES.length; r++) {
    const value = curves[r]![peaks[r]!]!;
    const bar = best === 0 ? curves[0]![peaks[0]!]! * RATE_MARGIN : curves[best]![peaks[best]!]!;
    if (value > bar) best = r;
  }
  const rate = ALIGN_RATES[best]!;
  const curve = curves[best]!;
  const peak = curve[peaks[best]!]!;
  if (!(peak > 0)) return NOTHING;
  let offset = low + between(curve, peaks[best]!) * BIN;
  // Refined to a hundredth of a second by how much speech lands on speech.
  let most = -1;
  let refined = offset;
  for (let step = -10; step <= 10; step++) {
    const at = offset + step * 0.01;
    const landed = overlap(candidate, reference, rate, at);
    if (landed > most + 1e-9) {
      most = landed;
      refined = at;
    }
  }
  offset = refined;
  yield;
  // The best clearly different answer, at any rate: one that puts the lines elsewhere in the
  // stretch the reference covers. Outside it nothing tells answers apart, so against a stretch
  // late in the film an answer that differs only at the file's start is the same answer.
  const first = candidate.starts[0]!;
  const last = candidate.ends[candidate.count - 1]!;
  const fromRef = (reference.starts[0]! - offset) * rate;
  const toRef = (reference.ends[reference.count - 1]! - offset) * rate;
  const inside = Math.min(last, toRef) > Math.max(first, fromRef);
  const t0 = inside ? Math.max(first, fromRef) : first;
  const t1 = inside ? Math.min(last, toRef) : last;
  let second = 0;
  for (let r = 0; r < ALIGN_RATES.length; r++) {
    const other = curves[r]!;
    for (let n = 0; n < size; n++) {
      if (other[n]! <= second) continue;
      if (apartOnAverage(ALIGN_RATES[r]!, low + n * BIN, rate, offset, t0, t1) <= DIFFERENT) {
        continue;
      }
      second = other[n]!;
    }
  }
  const found: Found = {
    rate,
    offset,
    peak,
    prominence: Math.min(50, peak / Math.max(second, peak * 0.02, 1e-9)),
  };
  yield;
  return yield* judge(candidate, reference, found, !!options.growing);
}

/** Checks the answer over the stretch both files cover, window by window, and says how sure it is. */
function* judge(
  candidate: Speech,
  reference: Speech,
  found: Found,
  growing: boolean,
): Generator<void, SubtitleAlignment, void> {
  const { rate, offset, prominence } = found;
  const shown = (t: number) => t / rate + offset;
  const from = Math.max(shown(candidate.starts[0]!), reference.starts[0]!);
  const to = Math.min(
    shown(candidate.ends[candidate.count - 1]!),
    reference.ends[reference.count - 1]!,
  );
  const covered = Math.max(0, to - from);
  const ownSpan = shown(candidate.ends[candidate.count - 1]!) - shown(candidate.starts[0]!);

  // Speech landed, and lines matched, in the stretch both cover, by tenths of it.
  let firstSpan = -1;
  let lastSpan = -1;
  let speech = 0;
  for (let j = 0; j < candidate.count; j++) {
    const at = shown(candidate.starts[j]!);
    if (at < from - 1 || at > to + 1) continue;
    if (firstSpan < 0) firstSpan = j;
    lastSpan = j + 1;
    speech += (candidate.ends[j]! - candidate.starts[j]!) / rate;
  }
  const score =
    speech > 0 && firstSpan >= 0
      ? overlap(candidate, reference, rate, offset, firstSpan, lastSpan) / speech
      : 0;
  const tenths: Array<{ lines: number; matched: number }> = [];
  for (let n = 0; n < 10; n++) tenths.push({ lines: 0, matched: 0 });
  let lines = 0;
  let matched = 0;
  let i = 0;
  for (let j = 0; j < candidate.lineStarts.length; j++) {
    const a = shown(candidate.lineStarts[j]!);
    const b = shown(candidate.lineEnds[j]!);
    if (a < from - 1 || a > to + 1) continue;
    lines++;
    while (i < reference.count && reference.ends[i]! <= a) i++;
    let landed = 0;
    for (let k = i; k < reference.count && reference.starts[k]! < b; k++) {
      landed += Math.min(b, reference.ends[k]!) - Math.max(a, reference.starts[k]!);
    }
    const hit = landed >= 0.5 * (b - a);
    if (hit) matched++;
    const tenth =
      tenths[Math.min(9, Math.max(0, Math.floor(((a - from) / Math.max(covered, 1)) * 10)))]!;
    tenth.lines++;
    if (hit) tenth.matched++;
  }
  const share = lines > 0 ? matched / lines : 0;
  // What chance gives: the share of the same lines landing on speech with the file moved well
  // away from the answer. Dense dialogue lands on dense dialogue half the time or more anywhere.
  let chanceSum = 0;
  for (const shift of CHANCE_SHIFTS) {
    let tried = 0;
    let hits = 0;
    let r = 0;
    for (let j = 0; j < candidate.lineStarts.length; j++) {
      const at = shown(candidate.lineStarts[j]!);
      if (at < from - 1 || at > to + 1) continue;
      const a = at + shift;
      const b = shown(candidate.lineEnds[j]!) + shift;
      tried++;
      while (r < reference.count && reference.ends[r]! <= a) r++;
      let landed = 0;
      for (let k = r; k < reference.count && reference.starts[k]! < b; k++) {
        landed += Math.min(b, reference.ends[k]!) - Math.max(a, reference.starts[k]!);
      }
      if (landed >= 0.5 * (b - a)) hits++;
    }
    chanceSum += tried > 0 ? hits / tried : 0;
    yield;
  }
  const chance = chanceSum / CHANCE_SHIFTS.length;
  // How far the lines landing on speech are beyond chance: 0 at chance, 1 when every one lands.
  const beyond = chance < 1 ? (share - chance) / (1 - chance) : 0;
  const counted = tenths.filter((tenth) => tenth.lines >= 3);
  const spread =
    counted.length > 0
      ? counted.filter((tenth) => tenth.matched / tenth.lines >= 0.5 * share).length /
        counted.length
      : 0;
  let referenceLines = 0;
  for (let k = 0; k < reference.lineStarts.length; k++) {
    const at = reference.lineStarts[k]!;
    if (at >= from - 1 && at <= to + 1) referenceLines++;
  }
  yield;

  // Each window lined up on its own, near the answer.
  const count = Math.max(
    0,
    Math.min(
      MAX_WINDOWS,
      Math.floor(covered / WINDOW_SECONDS),
      Math.floor(candidate.count / WINDOW_SPANS),
    ),
  );
  const windows: Window[] = [];
  const size = Math.round((2 * WINDOW_RANGE) / BIN) + 1;
  const centre = Math.round(WINDOW_RANGE / BIN);
  const near = Math.round(WINDOW_NEAR / BIN);
  const reach = Math.round(WINDOW_REACH / BIN);
  let j = 0;
  for (let w = 0; w < count; w++) {
    const start = from + (w * covered) / count;
    const end = from + ((w + 1) * covered) / count;
    const at = (start + end) / 2;
    while (j < candidate.count && shown((candidate.starts[j]! + candidate.ends[j]!) / 2) < start)
      j++;
    let k = j;
    while (k < candidate.count && shown((candidate.starts[k]! + candidate.ends[k]!) / 2) < end) k++;
    if (k - j < WINDOW_SPANS / 2) {
      windows.push({ at, kind: 'empty', delta: null });
      continue;
    }
    const raw = new Float64Array(size);
    voteEdges(raw, offset - WINDOW_RANGE, candidate, reference, rate, j, k, { next: j, first: 0 });
    const local = smooth(raw);
    const close = highest(local, centre - near, centre + near + 1);
    const anywhere = highest(local);
    const window: Window = { at, kind: 'unclear', delta: null };
    // Its own clear peak far from the answer: this part of the film lines up elsewhere.
    const far =
      Math.abs(anywhere - centre) > reach &&
      standsOut(local, anywhere, 1.5) >= WINDOW_PROMINENCE * 1.15;
    if (
      !far &&
      standsOut(local, close, 1.5, centre - reach, centre + reach + 1) >= WINDOW_PROMINENCE
    ) {
      window.delta = (between(local, close) - centre) * BIN;
      window.kind = Math.abs(window.delta) <= WINDOW_AGREE ? 'agrees' : 'off';
    } else if (
      Math.abs(anywhere - centre) > near &&
      standsOut(local, anywhere, 1.5) >= WINDOW_PROMINENCE * 1.15
    ) {
      window.delta = (between(local, anywhere) - centre) * BIN;
      window.kind = 'off';
    }
    windows.push(window);
    yield;
  }
  const usable = windows.filter((window) => window.kind !== 'empty').length;
  const agreeing = windows.filter((window) => window.kind === 'agrees').length;
  const off = windows.filter((window) => window.kind === 'off').length;
  const clear = windows.filter((window) => window.delta !== null);

  // A line fitted through the windows' offsets: a drift left over moves along it.
  let drift = 0;
  if (clear.length >= 3) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const window of clear) {
      sx += window.at;
      sy += window.delta!;
      sxx += window.at * window.at;
      sxy += window.at * window.delta!;
    }
    const n = clear.length;
    const spread2 = n * sxx - sx * sx;
    if (spread2 > 0) drift = ((n * sxy - sx * sy) / spread2) * covered;
  }
  // A split: the windows before a point keep one offset and those after it another.
  let split: SubtitleAlignment['split'];
  for (let cut = 2; cut <= clear.length - 2 && !split; cut++) {
    const before = clear.slice(0, cut).map((window) => window.delta!);
    const after = clear.slice(cut).map((window) => window.delta!);
    const a = middle(before);
    const b = middle(after);
    const tight =
      before.every((d) => Math.abs(d - a) <= SPLIT_TIGHT) &&
      after.every((d) => Math.abs(d - b) <= SPLIT_TIGHT);
    if (tight && Math.abs(a - b) >= SPLIT_JUMP) {
      split = { at: (clear[cut - 1]!.at + clear[cut]!.at) / 2, jump: b - a };
    }
  }

  // Enough to go on: a reference still arriving that covers too little says nothing against a file.
  const enough = lines >= MIN_LINES && referenceLines >= MIN_LINES && covered >= MIN_COVERED;
  const coveredShare = ownSpan > 0 ? Math.min(1, covered / ownSpan) : 0;
  const thin = growing && (!enough || coveredShare < MIN_COVERED_SHARE);
  // A match, if not all the way through: a clear peak; a weaker one most windows agree with; a
  // split, whose two parts each peak in their windows (two equal parts peak as high as each
  // other); or, with too few windows to show whether they disagree, a peak at all: files for
  // the same video and for another one both peak that high then.
  const someMatch =
    prominence >= NONE_BELOW ||
    (prominence >= NONE_FLOOR &&
      agreeing >= NONE_WINDOWS &&
      agreeing >= NONE_WINDOW_SHARE * usable) ||
    (split !== undefined &&
      clear.length >= NONE_WINDOWS &&
      clear.length >= SURE_WINDOW_SHARE * usable) ||
    (usable < NONE_WINDOWS && prominence >= NOTHING_BELOW);
  // Rates 0.1% apart (24 and 23.976, 25 against either) put the lines a second apart in twenty
  // minutes, as close as files' timings are to each other, and far apart by the film's end: a
  // reference covering under half of the file never says which, so only the file as it is can be
  // sure then.
  const rateKnown = rate === 1 || coveredShare >= MIN_COVERED_SHARE;
  // With few windows, two blocks of lines timed alike in both (the opening and closing songs of
  // two episodes) can carry the vote: then every window must agree, and far beyond chance.
  const fewWindows = usable < FEW_WINDOWS;
  const sure =
    enough &&
    rateKnown &&
    beyond >= SURE_BEYOND &&
    (!fewWindows || (agreeing === usable && beyond >= SURE_BEYOND_FEW)) &&
    prominence >= SURE_PROMINENCE &&
    usable >= SURE_WINDOWS &&
    agreeing >= Math.max(SURE_WINDOWS, Math.ceil(SURE_WINDOW_SHARE * usable)) &&
    off <= 1 &&
    Math.abs(drift) <= SURE_DRIFT &&
    !split &&
    share >= SURE_MATCHED;
  const confidence: AlignConfidence = sure ? 'sure' : someMatch || thin ? 'unsure' : 'none';
  const result: SubtitleAlignment = {
    offset,
    rate,
    score,
    matched: share,
    chance,
    spread,
    prominence,
    confidence,
    windows: windows.map((window) => window.delta),
    drift,
    covered,
    coveredShare,
  };
  if (split) result.split = split;
  return result;
}

/** Lines `candidate` up against `reference` in one go. */
export function alignSubtitles(
  candidate: readonly LineTiming[],
  reference: readonly LineTiming[],
  options: AlignOptions = {},
): SubtitleAlignment {
  const steps = alignSteps(candidate, reference, options);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** What running in slices needs from the platform: a clock, and a way to let others go first. */
export interface Slicing {
  /** Milliseconds, as performance.now() gives them. */
  now(): number;
  /** Resolves once the page has had its turn (a setTimeout of 0). */
  pause(): Promise<void>;
  /** How long to work before pausing, in milliseconds: 8 by default. */
  sliceMs?: number;
}

/**
 * Lines `candidate` up against `reference`, pausing every `sliceMs` so the
 * page stays smooth on a TV. The same answer as alignSubtitles.
 */
export async function alignSubtitlesInSlices(
  candidate: readonly LineTiming[],
  reference: readonly LineTiming[],
  slicing: Slicing,
  options: AlignOptions = {},
): Promise<SubtitleAlignment> {
  const steps = alignSteps(candidate, reference, options);
  const slice = slicing.sliceMs ?? 8;
  let since = slicing.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    if (slicing.now() - since >= slice) {
      await slicing.pause();
      since = slicing.now();
    }
  }
}

/** Where a line the file times at `t` shows once lined up. */
export function alignedTime(
  t: number,
  alignment: Pick<SubtitleAlignment, 'offset' | 'rate'>,
): number {
  return t / alignment.rate + alignment.offset;
}
