import type { SleepTimer } from '@bannertv/core';
import { sinceActivity } from '../navigation/activity';

/** No sleep timer. */
export const SLEEP_OFF: SleepTimer = { choice: 'off', endsAt: null };

let kept: { metaId: string; timer: SleepTimer } | null = null;

/**
 * The sleep timer set while watching this title: it lasts through All
 * streams and back, and on into the next episode. Another title starts with
 * it off.
 */
export function sleepTimerFor(metaId: string): SleepTimer {
  return kept && kept.metaId === metaId ? kept.timer : SLEEP_OFF;
}

export function keepSleepTimer(metaId: string, timer: SleepTimer): void {
  kept = timer.choice === 'off' ? null : { metaId, timer };
}

/** Episodes that started by themselves, and when the last one did. */
let autoplays = { count: 0, at: 0 };

/** Episodes that started by themselves since the last key press or pointer move. */
export function autoplaysSinceInput(): number {
  return sinceActivity() <= Date.now() - autoplays.at ? 0 : autoplays.count;
}

/** An episode is starting by itself. */
export function countAutoplay(): void {
  autoplays = { count: autoplaysSinceInput() + 1, at: Date.now() };
}
