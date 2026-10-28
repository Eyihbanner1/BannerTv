import { createStore } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';

/** The title the hero banner shows: whatever tile has focus, or Home's first title. */
export const heroItem = createStore<MetaPreview | null>(null);

let waiting: { item: MetaPreview; timer: ReturnType<typeof setTimeout> } | undefined;

/** Drops the title waiting to be shown, if any. */
export function cancelHero(): void {
  if (waiting) clearTimeout(waiting.timer);
  waiting = undefined;
}

/** Shows `item` in the hero after `delay` ms, in place of any title still waiting. */
export function showInHero(item: MetaPreview | undefined, delay: number): void {
  cancelHero();
  if (!item) return;
  const timer = setTimeout(() => {
    waiting = undefined;
    heroItem.set(item);
  }, delay);
  waiting = { item, timer };
}

/**
 * Shows the waiting title at once. Focus has come up to the hero, so the last
 * title focused is the one its Details button should open.
 */
export function showWaitingHero(): void {
  const item = waiting?.item;
  cancelHero();
  if (item) heroItem.set(item);
}
