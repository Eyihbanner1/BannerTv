import type { LiveWindow } from '@bannertv/core';

/** A broadcast this far behind live after a stall goes back to live by itself, at the least. */
export const AUTO_LIVE_MIN_S = 20;
/** And at least this many times the engine's slack, so a player that plays short of live is left alone. */
export const AUTO_LIVE_SLACK_TIMES = 3;
/** One jump back to live per this long: a stream that stalls near live is not chased round. */
export const AUTO_LIVE_EVERY_MS = 60000;

/**
 * Whether a broadcast that just stalled should go back to live by itself: it
 * is well behind, the viewer did not move back or pause on purpose, and it
 * did not go back a moment ago.
 */
export function shouldReturnToLive(
  kept: LiveWindow,
  position: number,
  options: { viewerBehind: boolean; lastAt: number; now: number },
): boolean {
  if (options.viewerBehind || options.now - options.lastAt < AUTO_LIVE_EVERY_MS) return false;
  const behind = kept.live - position;
  return behind >= Math.max(AUTO_LIVE_MIN_S, AUTO_LIVE_SLACK_TIMES * kept.slack);
}
