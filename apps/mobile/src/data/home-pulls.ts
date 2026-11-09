import { DEFAULT_PULL_MINUTES, type Timers } from '@bannertv/core';

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
  /**
   * How often the service asks screens to pull, in minutes (30 unless it says otherwise). Asked
   * for pulls further apart than that, Home's own come further apart in the same proportion.
   */
  pullMinutes?: () => number;
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
 * to them rather than pulling twice. When the service asks for pulls further apart than every
 * 30 minutes, as it can to cut its load without a release (ADR 0006, decision 10), the 30 seconds
 * and the 2 minutes grow in the same proportion; asked for them closer, they stay as they are.
 */
export function createHomePulls(options: HomePullsOptions): HomePulls {
  const { pull, now, timers } = options;
  let focused = false;
  let active = options.active;
  let asked: number | undefined;
  let stopNext: (() => void) | undefined;

  const slowed = () =>
    Math.max(1, (options.pullMinutes?.() ?? DEFAULT_PULL_MINUTES) / DEFAULT_PULL_MINUTES);

  function ask(): void {
    asked = now();
    pull();
  }

  function recently(): boolean {
    const last = Math.max(asked ?? -Infinity, options.lastPull?.() ?? -Infinity);
    return now() - last < FOCUS_PULL_GAP_MS * slowed();
  }

  // One at a time rather than a timer that repeats, so what the service says applies from the next.
  function askLater(): void {
    stopNext = timers.after(HOME_PULL_EVERY_MS * slowed(), () => {
      ask();
      askLater();
    });
  }

  function follow(): void {
    const on = focused && active;
    if (on && !stopNext) askLater();
    else if (!on && stopNext) {
      stopNext();
      stopNext = undefined;
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
