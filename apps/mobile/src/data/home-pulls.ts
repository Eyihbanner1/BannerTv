import type { Timers } from '@bannertv/core';

/** Home coming back into focus asks the account again at most this often. */
export const FOCUS_PULL_GAP_MS = 30_000;
/** While Home stays on screen with the app open, it asks the account this often. */
export const HOME_PULL_EVERY_MS = 2 * 60_000;

export interface HomePullsOptions {
  /** Asks the account what changed: refreshAccount, which waits while failures back off. */
  pull: () => void;
  now: () => number;
  timers: Timers;
  /**
   * When the account last pulled, for whatever reason, by the same clock: a focus just after
   * asks nothing.
   */
  lastPull?: () => number | undefined;
  /** Whether the app is in the foreground now. */
  active: boolean;
}

export interface HomePulls {
  /** Home came into focus: a pull, unless one was 30 seconds ago or less, then every 2 minutes. */
  focus(): void;
  /** Home lost focus: the pulls every 2 minutes stop. */
  blur(): void;
  /** The app came to the foreground (true) or went to the background (false). */
  setActive(active: boolean): void;
}

/**
 * When Home asks the account what other screens changed: as it comes into focus, and every
 * 2 minutes while it stays there with the app open. The account's own pulls go on as well:
 * every half hour, and when the app comes back after 15 seconds or more away, which this leaves
 * to them rather than pulling twice.
 */
export function createHomePulls(options: HomePullsOptions): HomePulls {
  const { pull, now, timers } = options;
  let focused = false;
  let active = options.active;
  let asked: number | undefined;
  let stopEvery: (() => void) | undefined;

  function ask(): void {
    asked = now();
    pull();
  }

  function recently(): boolean {
    const last = Math.max(asked ?? -Infinity, options.lastPull?.() ?? -Infinity);
    return now() - last < FOCUS_PULL_GAP_MS;
  }

  function follow(): void {
    const on = focused && active;
    if (on && !stopEvery) stopEvery = timers.every(HOME_PULL_EVERY_MS, ask);
    else if (!on && stopEvery) {
      stopEvery();
      stopEvery = undefined;
    }
  }

  return {
    focus() {
      if (focused) return;
      focused = true;
      if (active && !recently()) ask();
      follow();
    },
    blur() {
      focused = false;
      follow();
    },
    setActive(next) {
      active = next;
      follow();
    },
  };
}
