/**
 * The phone player's clock, as the page's own subtitles read it. Android's player says where it
 * is twice a second (phone-host.ts), and the shared Android engine moves its clock on at normal
 * speed in between. At 1.5× that clock falls a quarter of a second behind the picture before each
 * report puts it right, and the lines with it. This one moves on at the speed playing, so the
 * lines follow the player's own time at any speed.
 */

/** One reading of the player's clock. */
export interface ClockReading {
  /** Seconds into the video. */
  position: number;
  /** When it was read, in milliseconds (Date.now()). */
  at: number;
  /** The playback speed. */
  rate: number;
  /** The video was moving on: playing, not paused, buffering or ended. */
  running: boolean;
  /** The video's length in seconds; 0 while it is unknown, and on a broadcast. */
  duration: number;
}

/** No video: the clock stands at 0. */
export const STOPPED_CLOCK: ClockReading = {
  position: 0,
  at: 0,
  rate: 1,
  running: false,
  duration: 0,
};

/** Where the video is at `now`, from the last reading: never past its end. */
export function readClock(reading: ClockReading, now: number): number {
  if (!reading.running) return reading.position;
  const rate = reading.rate > 0 && isFinite(reading.rate) ? reading.rate : 1;
  const moved = reading.position + (Math.max(0, now - reading.at) / 1000) * rate;
  return reading.duration > 0 ? Math.min(moved, reading.duration) : moved;
}
