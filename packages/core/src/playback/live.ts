/**
 * Where a broadcast is against its live point: how far behind, whether it
 * still counts as live, and where it sits on the bar. Times are seconds on the
 * video's own clock, as the playing engine reads them.
 */

/** The part of a broadcast the engine still keeps, and where it plays live. */
export interface LiveWindow {
  /** The earliest moment still kept. */
  start: number;
  /** Where the engine plays live: the newest moment less its safety gap. Go to live lands here. */
  live: number;
  /** How far behind `live` still counts as live: about a segment, as the engine's reading lags. */
  slack: number;
}

/** How a broadcast stands against live. */
export interface LiveJudgement {
  /** Seconds behind live: 0 while it counts as live, so the engine's wobble never shows. */
  behind: number;
  /** Within the slack of live: Go to live and Forward 10 s have nowhere to go. */
  atLive: boolean;
}

/**
 * Once behind, the viewer counts as live again only within this share of the
 * slack, so a reading that wobbles at the boundary does not flick back and forth.
 */
const RETURN_SHARE = 0.5;

/**
 * How far `position` is behind live. It turns behind once more than the
 * slack back, and live again only within half the slack, so pass whether the
 * last judgement was behind. A position past live is live. A reading that is
 * not a finite number counts as live, so no made-up distance is shown.
 */
export function judgeLive(
  window: Pick<LiveWindow, 'live' | 'slack'>,
  position: number,
  wasBehind: boolean,
): LiveJudgement {
  const distance = window.live - position;
  if (!isFinite(distance)) return { behind: 0, atLive: true };
  const slack = window.slack > 0 ? window.slack : 0;
  const limit = wasBehind ? slack * RETURN_SHARE : slack;
  return distance > limit ? { behind: distance, atLive: false } : { behind: 0, atLive: true };
}

/**
 * Where `position` sits on the bar, 0 at the window's start and 1 at live,
 * clamped. A window with no length, or a reading that is not a finite
 * number, reads as live.
 */
export function liveFraction(window: Pick<LiveWindow, 'start' | 'live'>, position: number): number {
  const span = window.live - window.start;
  const fraction = (position - window.start) / span;
  if (!(span > 0) || !isFinite(span) || !isFinite(fraction)) return 1;
  return Math.max(0, Math.min(1, fraction));
}

/**
 * A jump target kept within what the broadcast keeps: never before its start
 * and never past live. Live wins if the two cross, so Go to live always lands
 * on it; a target that is not a number goes to live. An end of the window
 * that is not a finite number holds nothing back, so a bad reading never
 * turns a good target into one the video can't take.
 */
export function clampToWindow(window: Pick<LiveWindow, 'start' | 'live'>, target: number): number {
  const { start, live } = window;
  const floored = isFinite(start) ? Math.max(start, target) : target;
  if (!isFinite(live)) return floored;
  return Number.isNaN(target) ? live : Math.min(live, floored);
}
