/*
 * Match a line: the viewer presses on the line they just heard, and the
 * subtitles are timed to it. One press sets the timing; a second, much later
 * in the film, also tells whether the lines drift (a file timed for another
 * frame rate). A line the file times at t shows at t / rate + offset.
 */

/** How long a viewer takes to press after hearing a line, in seconds of real time. */
export const REACTION_S = 0.3;
/** Two presses closer than this (seconds) are too close to tell a drift. */
export const MIN_TAP_GAP_S = 120;
/** Two presses fit one rate when their timings for it are this close (seconds). */
export const TAP_FIT_S = 1.0;
/** Further than this is another film's subtitles, not a timing to fix (as the offsets keep). */
export const MAX_TAP_OFFSET_S = 600;

/** One press on a line. */
export interface Tap {
  /** The video's clock at the press, in seconds. */
  at: number;
  /** The playback speed. */
  speed: number;
  /** The line's start on the clock in question, in seconds. */
  start: number;
}

/** The timing that puts the line pressed where it was heard: the reaction scaled by speed. */
export function tapOffset(tap: Tap, reaction = REACTION_S): number {
  return tap.at - reaction * tap.speed - tap.start;
}

/** What two presses found: one timing at one rate, or no steady pace. */
export type TapFit = { offset: number; rate: number } | { unsteady: true };

const tenths = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * The rate and timing two presses on the file's own lines agree on: for each
 * rate, the timing each press gives, and the rate whose two are closest.
 * Null when the presses are too close together to tell; unsteady when no
 * rate puts them within TAP_FIT_S of each other, or the timing is past
 * MAX_TAP_OFFSET_S.
 */
export function fitTwoTaps(
  a: Tap,
  b: Tap,
  rates: readonly number[],
  reaction = REACTION_S,
): TapFit | null {
  if (Math.abs(b.at - a.at) < MIN_TAP_GAP_S) return null;
  const timing = (tap: Tap, rate: number) => tap.at - reaction * tap.speed - tap.start / rate;
  let best: { rate: number; gap: number; mean: number } | null = null;
  for (const rate of rates) {
    if (!(rate > 0)) continue;
    const ta = timing(a, rate);
    const tb = timing(b, rate);
    const gap = Math.abs(ta - tb);
    if (!best || gap < best.gap) best = { rate, gap, mean: (ta + tb) / 2 };
  }
  if (!best || best.gap > TAP_FIT_S || Math.abs(best.mean) > MAX_TAP_OFFSET_S) {
    return { unsteady: true };
  }
  return { offset: tenths(best.mean), rate: best.rate };
}
