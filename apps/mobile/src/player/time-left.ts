import type { SleepTimer } from '@bannertv/core';

const MINUTE_MS = 60 * 1000;

/**
 * When the video ends on the phone's clock, in milliseconds since 1970, as the TV's controls work
 * out "Ends at 22:41": what is left of it, at the speed playing, from now. Null on a broadcast and
 * until the file gives its length.
 */
export function endsAt(
  now: number,
  position: number,
  duration: number,
  rate: number,
  live: boolean,
): number | null {
  if (live || !(duration > 0) || !isFinite(duration)) return null;
  const speed = rate > 0 && isFinite(rate) ? rate : 1;
  return now + (Math.max(0, duration - position) * 1000) / speed;
}

/**
 * Whole minutes left on a minutes sleep timer, rounded up, so the last seconds still read
 * "1 min left". Null when it is off or waits for the end of the video, which has no deadline.
 */
export function sleepMinutesLeft(timer: SleepTimer, now: number): number | null {
  if (typeof timer.choice !== 'number' || timer.endsAt === null) return null;
  return Math.max(1, Math.ceil((timer.endsAt - now) / MINUTE_MS));
}
