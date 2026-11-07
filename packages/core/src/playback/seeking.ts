/**
 * The rules every way of skipping shares, on the TV and the phone: presses
 * (or taps) add up to one total that lands once, a moment after the last;
 * and a big jump offers, for a few seconds, to go back to where it came from.
 * Times are in media seconds.
 */

/** A skip in progress lands this long after the last press or tap. */
export const SKIP_LANDS_AFTER_MS = 800;

/**
 * How far one press skips: 10 s, the same for every way of skipping. A key
 * held down repeats, and goes further the longer it is held. `repeats`: how
 * often it has repeated so far.
 */
export function skipStep(repeats: number): number {
  if (repeats > 12) return 60;
  if (repeats > 4) return 30;
  return 10;
}

/** A jump at least this long offers "Back to 42:10". */
export const BACK_TO_MIN_JUMP_S = 120;
/** For this long. */
export const BACK_TO_MS = 8000;

/**
 * Whether a jump from `from` to `to` was big enough to offer going back to
 * `from`. Never while either is unknown.
 */
export function offersBackTo(from: number, to: number): boolean {
  return isFinite(from) && isFinite(to) && from >= 0 && Math.abs(to - from) >= BACK_TO_MIN_JUMP_S;
}
