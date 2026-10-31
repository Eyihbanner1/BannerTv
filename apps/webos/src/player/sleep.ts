import type { SleepTimer } from '@bannertv/core';
import type { Route } from '../app/router';
import { sinceInput } from '../navigation/activity';

/** No sleep timer. */
export const SLEEP_OFF: SleepTimer = { choice: 'off', endsAt: null };

let kept: { metaId: string; timer: SleepTimer } | null = null;

/**
 * The sleep timer set while watching this title: it lasts through All
 * streams and back, and on into the next episode. Another title starts with
 * it off, and so does a timer that ran out while nothing played.
 */
export function sleepTimerFor(metaId: string, now = Date.now()): SleepTimer {
  if (!kept || kept.metaId !== metaId) return SLEEP_OFF;
  const { timer } = kept;
  return timer.endsAt !== null && timer.endsAt <= now ? SLEEP_OFF : timer;
}

export function keepSleepTimer(metaId: string, timer: SleepTimer): void {
  kept = timer.choice === 'off' ? null : { metaId, timer };
}

/**
 * The player for this title closed onto `next`. Only its next episode, or
 * another stream of it (All streams), carries the timer on.
 */
export function leaveSleepTimer(metaId: string, next: Route): void {
  if ((next.name === 'player' || next.name === 'streams') && next.metaId === metaId) return;
  if (kept?.metaId === metaId) kept = null;
}

/** Episodes that started by themselves, and when the last one did. */
let autoplays = { count: 0, at: 0 };

/** Episodes that started by themselves since anyone last used the remote, the pointer included. */
export function autoplaysSinceInput(): number {
  return sinceInput() <= Date.now() - autoplays.at ? 0 : autoplays.count;
}

/** An episode is starting by itself. */
export function countAutoplay(): void {
  autoplays = { count: autoplaysSinceInput() + 1, at: Date.now() };
}
