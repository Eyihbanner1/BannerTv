/** The steps the Timing tab offers, in seconds: negative shows subtitles earlier. */
export const TIMING_STEPS: readonly number[] = [-0.5, -0.1, 0.1, 0.5];

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
