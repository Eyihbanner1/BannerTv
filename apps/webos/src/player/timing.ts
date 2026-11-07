/** The steps the Timing tab offers, in seconds: negative shows subtitles earlier. */
export const TIMING_STEPS: readonly number[] = [-0.5, -0.1, 0.1, 0.5];

/** Big steps for a file that is far out, which the phone offers beside TIMING_STEPS. */
export const COARSE_TIMING_STEPS: readonly number[] = [-5, 5];

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
