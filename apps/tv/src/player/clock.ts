/** When the video will end on the TV's clock, if it plays on from here: null for live or unknown. */
export function endsAt(
  position: number,
  duration: number,
  rate: number,
  now: number,
): number | null {
  if (!(duration > 0) || !(rate > 0) || position >= duration) return null;
  return now + ((duration - Math.max(0, position)) / rate) * 1000;
}

/** Where a press of left or right lands: `step` seconds on, kept inside the video. */
export function seekTarget(from: number, step: number, duration: number): number {
  const target = Math.max(0, from + step);
  // Not right at the end, which would end the video under the viewer's thumb.
  return duration > 0 ? Math.min(target, Math.max(0, duration - 1)) : target;
}

/** How far along the bar a position is, from 0 to 1. */
export function fraction(position: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(1, Math.max(0, position / duration));
}
