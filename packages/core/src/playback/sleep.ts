/**
 * The sleep timer: pause the video after a number of minutes, or at the end
 * of what is playing. A minutes timer runs on the wall clock, so it keeps
 * counting while the video is paused, and its deadline reads as a time of
 * day ("Until 23:40").
 */

const MINUTE_MS = 60 * 1000;

/** Minutes, or 'end' for the end of the episode or film playing. */
export type SleepChoice = 'off' | 15 | 30 | 45 | 60 | 90 | 'end';

/** The menu's choices, in order. Leave 'end' out on live: a broadcast's end is not known. */
export const SLEEP_CHOICES: readonly SleepChoice[] = ['off', 15, 30, 45, 60, 90, 'end'];

/** What the viewer picked, and when a minutes timer runs out. */
export interface SleepTimer {
  choice: SleepChoice;
  /** When a minutes timer runs out, in milliseconds since 1970. Null for 'off' and 'end'. */
  endsAt: number | null;
}

/** The warning shows this long before a minutes timer runs out, or before the end for 'end'. */
export const SLEEP_WARN_MS = MINUTE_MS;
/** What "Add 15 min" adds. */
export const SLEEP_ADD_MS = 15 * MINUTE_MS;
/**
 * With less than this left on a minutes timer, the player stops at the end
 * of the episode rather than start the next one only to pause it minutes in.
 */
export const SLEEP_SKIPS_NEXT_MS = 5 * MINUTE_MS;

/** 'due' means pause now. */
export type SleepPhase = 'off' | 'counting' | 'warning' | 'due';

/** What the player knows about the video, for an 'end' timer. */
export interface SleepMedia {
  /** Media seconds left. Infinity or NaN while the length is unknown. */
  remainingS: number;
  ended: boolean;
  live: boolean;
  /** Playback speed, 1 when left out. */
  rate?: number;
}

/** A timer for this choice, started at `now`. Picking a minutes choice again starts it again. */
export function startSleep(choice: SleepChoice, now: number): SleepTimer {
  return { choice, endsAt: typeof choice === 'number' ? now + choice * MINUTE_MS : null };
}

/**
 * The timer with SLEEP_ADD_MS more: from the deadline while it is ahead,
 * from `now` once it has passed. An 'end' or 'off' timer has no deadline to
 * move and comes back as it is, so the warning for 'end' offers only
 * turning the timer off.
 */
export function addSleepTime(timer: SleepTimer, now: number): SleepTimer {
  if (typeof timer.choice !== 'number' || timer.endsAt === null) return timer;
  return { choice: timer.choice, endsAt: Math.max(timer.endsAt, now) + SLEEP_ADD_MS };
}

function endPhase(media: SleepMedia): SleepPhase {
  if (media.ended) return 'due';
  const rate = media.rate !== undefined && isFinite(media.rate) && media.rate > 0 ? media.rate : 1;
  const leftMs = (Math.max(0, media.remainingS) * 1000) / rate;
  return leftMs <= SLEEP_WARN_MS ? 'warning' : 'counting';
}

/**
 * Where the timer stands at `now`. A minutes timer warns in its last
 * SLEEP_WARN_MS and is due at its deadline, playing or paused. An 'end'
 * timer warns in the last SLEEP_WARN_MS of watching time and is due once
 * the video has ended; while the length is unknown it only counts.
 *
 * On live an 'end' timer is 'off': a broadcast's end is not known, and an
 * 'ended' there is more often a dropped stream than the programme's end.
 */
export function sleepPhase(timer: SleepTimer, now: number, media: SleepMedia): SleepPhase {
  if (timer.choice === 'off') return 'off';
  if (timer.choice === 'end') return media.live ? 'off' : endPhase(media);
  if (timer.endsAt === null) return 'off';
  const left = timer.endsAt - now;
  if (left <= 0) return 'due';
  return left <= SLEEP_WARN_MS ? 'warning' : 'counting';
}

/**
 * Milliseconds from `now` to a minutes timer's next change of phase: to the
 * warning, then to the deadline. Null when the clock changes nothing more:
 * 'off', 'end' (it follows the video), or already due.
 */
export function nextSleepCheck(timer: SleepTimer, now: number): number | null {
  if (typeof timer.choice !== 'number' || timer.endsAt === null) return null;
  const left = timer.endsAt - now;
  if (left > SLEEP_WARN_MS) return left - SLEEP_WARN_MS;
  return left > 0 ? left : null;
}

/**
 * Whether the player should stop at this end rather than start the next
 * episode: always for 'end', and for a minutes timer with less than
 * SLEEP_SKIPS_NEXT_MS left (or already due).
 */
export function stopsBeforeNext(timer: SleepTimer, now: number): boolean {
  if (timer.choice === 'end') return true;
  if (timer.choice === 'off' || timer.endsAt === null) return false;
  return timer.endsAt - now < SLEEP_SKIPS_NEXT_MS;
}
