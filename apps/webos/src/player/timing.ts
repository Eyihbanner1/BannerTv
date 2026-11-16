import type { Cue } from '@bannertv/core';

/** The steps the Timing tab offers, in seconds: negative shows subtitles earlier. */
export const TIMING_STEPS: readonly number[] = [-0.5, -0.1, 0.1, 0.5];

/** Big steps for a file that is far out, which the phone offers beside TIMING_STEPS. */
export const COARSE_TIMING_STEPS: readonly number[] = [-5, 5];

/**
 * The steps of the native TV app's Timing column, top to bottom: the fine ones first, each
 * later before earlier, then the big ones. The same steps as TIMING_STEPS and
 * COARSE_TIMING_STEPS together.
 */
export const TIMING_COLUMN_STEPS: readonly number[] = [0.1, -0.1, 0.5, -0.5, 5, -5];

/** How far a step moves, for its words: "0.5" or "5". */
export function stepAmount(step: number): string {
  const size = Math.abs(step);
  return size % 1 === 0 ? String(size) : size.toFixed(1);
}

/** A step's button: "−0.5 s", "+5 s", with a true minus sign. */
export function stepLabel(step: number): string {
  return `${step < 0 ? '−' : '+'}${stepAmount(step)} s`;
}

/** Tenths of a second, which is as fine as the steps go. */
function tenths(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

/** "+0.5 s", "−1.2 s" with a true minus sign, or "0.0 s". */
export function formatOffset(offset: number): string {
  const rounded = tenths(offset);
  if (rounded === 0) return '0.0 s';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} s`;
}

/**
 * What a Timing title says beside its name: the offset, whether BannerTV lined the file up and
 * whether a drift fix is on. Null with subtitles off, and for subtitles as the file has them
 * (no offset, no drift fix, not moved).
 */
export function timingSummary(s: {
  choice: unknown;
  offset: number;
  drift: unknown;
  sync: { state: string } | null;
}): { offset: string; linedUp: boolean; driftFixed: boolean } | null {
  if (s.choice === null) return null;
  const linedUp = s.sync?.state === 'moved';
  const driftFixed = s.drift !== null;
  if (s.offset === 0 && !driftFixed && !linedUp) return null;
  return { offset: formatOffset(s.offset), linedUp, driftFixed };
}

/** The offset one step on, kept to tenths so steps never drift. */
export function stepOffset(offset: number, step: number): number {
  return tenths(offset + step);
}

/** How far the subtitles move, and which way: later, earlier, or not at all. */
export function offsetWay(offset: number): { way: 'later' | 'earlier' | 'none'; amount: string } {
  const rounded = tenths(offset);
  const amount = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return { way: 'later', amount };
  if (rounded < 0) return { way: 'earlier', amount };
  return { way: 'none', amount };
}

/**
 * The longest the subtitle layer sleeps between clock reads. It wakes sooner
 * for the next line to start or end, and on every play, pause, seek or speed
 * change.
 */
export const MAX_READ_DELAY_MS = 250;
/** Never sooner than this, so a clock that lags its timer cannot spin. */
export const MIN_READ_DELAY_MS = 15;
/** This much after a change is due, so the clock has surely reached it. */
const LATE_MS = 4;

/**
 * How long the subtitle layer sleeps before reading the clock again: until
 * the next line starts or ends (`next`, on the subtitles' clock, from `now`)
 * at the speed playing. While paused, or with nothing more to come, only the
 * slow read, in case a seek comes without its events.
 */
export function nextReadDelay(now: number, next: number, rate: number, paused: boolean): number {
  if (paused || !isFinite(now) || !isFinite(next) || !(rate > 0)) return MAX_READ_DELAY_MS;
  const ms = ((next - now) / rate) * 1000 + LATE_MS;
  return Math.max(MIN_READ_DELAY_MS, Math.min(MAX_READ_DELAY_MS, ms));
}

/** Match a line offers the lines within this many seconds of now. */
export const MATCH_WINDOW_S = 30;
/** How many lines Match a line offers at once. */
export const MATCH_ROWS = 4;

/** A line offered to match: its place in the cues, a key that stays as lines come and go. */
export interface MatchRow {
  index: number;
  key: string;
  /** On screen now. */
  onScreen: boolean;
}

/** A line's words, for its row: shown on screen only, never logged or kept. */
export function lineText(cue: Cue): string {
  return cue.lines
    .map((line) =>
      line
        .map((span) => span.text)
        .join('')
        .trim(),
    )
    .filter((line) => line !== '')
    .join(' ');
}

const startMs = (cue: Cue) => Math.round(cue.start * 1000);

/**
 * A line's key: its start in milliseconds, and its place among the lines that start with it.
 * It stays when Android's history drops older lines.
 */
export function lineKey(cues: readonly Cue[], index: number): string {
  const ms = startMs(cues[index]!);
  let place = 0;
  for (let i = 0; i < index; i++) if (startMs(cues[i]!) === ms) place++;
  return `${ms}-${place}`;
}

/** The line a key names, or -1. */
function indexOfKey(cues: readonly Cue[], key: string): number {
  const match = /^(-?\d+)-(\d+)$/.exec(key);
  if (!match) return -1;
  const ms = Number(match[1]);
  let place = Number(match[2]);
  for (let i = 0; i < cues.length; i++) {
    if (startMs(cues[i]!) !== ms) continue;
    if (place === 0) return i;
    place--;
  }
  return -1;
}

/**
 * The lines to match, `drawnNow` on the lines' own clock (the viewer's timing taken out): of
 * those starting within MATCH_WINDOW_S, the two latest already started and the two next, one
 * side filling up for the other (a track Android hands over knows only past lines). The line
 * `pinnedKey` names, focused, stays among them in place of the farthest. Sorted by start.
 */
export function matchRows(cues: readonly Cue[], drawnNow: number, pinnedKey?: string): MatchRow[] {
  const past: number[] = [];
  const next: number[] = [];
  for (let i = 0; i < cues.length; i++) {
    const { start } = cues[i]!;
    if (start < drawnNow - MATCH_WINDOW_S || start > drawnNow + MATCH_WINDOW_S) continue;
    (start <= drawnNow ? past : next).push(i);
  }
  const byStart = (a: number, b: number) => cues[a]!.start - cues[b]!.start || a - b;
  past.sort(byStart);
  next.sort(byStart);
  const half = MATCH_ROWS / 2;
  const after = Math.min(next.length, Math.max(half, MATCH_ROWS - past.length));
  const before = Math.min(past.length, MATCH_ROWS - after);
  const chosen = past.slice(past.length - before).concat(next.slice(0, after));
  if (pinnedKey !== undefined) {
    const pinned = indexOfKey(cues, pinnedKey);
    if (pinned >= 0 && chosen.indexOf(pinned) < 0) {
      const at = cues[pinned]!.start;
      if (chosen.length < MATCH_ROWS) chosen.push(pinned);
      else {
        let farthest = 0;
        for (let i = 1; i < chosen.length; i++) {
          if (
            Math.abs(cues[chosen[i]!]!.start - at) > Math.abs(cues[chosen[farthest]!]!.start - at)
          ) {
            farthest = i;
          }
        }
        chosen[farthest] = pinned;
      }
    }
  }
  return chosen.sort(byStart).map((index) => {
    const cue = cues[index]!;
    return {
      index,
      key: lineKey(cues, index),
      onScreen: cue.start <= drawnNow && drawnNow < cue.end,
    };
  });
}

/** The row focused first: the newest line already heard, else the first. */
export function preferredRow(
  rows: readonly MatchRow[],
  cues: readonly Cue[],
  drawnNow: number,
): MatchRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (cues[rows[i]!.index]!.start <= drawnNow) return rows[i];
  }
  return rows[0];
}
