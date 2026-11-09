import type { Timers } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { createHomePulls, FOCUS_PULL_GAP_MS, HOME_PULL_EVERY_MS } from './home-pulls';

/** A clock and timers moved by hand, and the pulls asked for. */
function setUp(options: { active?: boolean; lastPull?: () => number | undefined } = {}) {
  let clock = 0;
  let timers: Array<{ due: number; every: number; run: () => void }> = [];
  const fake: Timers = {
    after(ms, run) {
      const timer = { due: clock + ms, every: 0, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    every(ms, run) {
      const timer = { due: clock + ms, every: ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
  };
  const pulls: number[] = [];
  const home = createHomePulls({
    pull: () => pulls.push(clock),
    now: () => clock,
    timers: fake,
    active: options.active ?? true,
    ...(options.lastPull ? { lastPull: options.lastPull } : {}),
  });
  function advance(ms: number) {
    const until = clock + ms;
    for (;;) {
      const next = timers.filter((timer) => timer.due <= until).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      clock = next.due;
      if (next.every) next.due += next.every;
      else timers = timers.filter((other) => other !== next);
      next.run();
    }
    clock = until;
  }
  return { home, pulls, advance, timers: () => timers.length };
}

describe("Home's pulls", () => {
  it('pulls as Home comes into focus, at most once in 30 seconds', () => {
    const { home, pulls, advance } = setUp();
    home.focus();
    expect(pulls).toEqual([0]);
    home.blur();
    advance(FOCUS_PULL_GAP_MS - 1);
    home.focus();
    expect(pulls).toEqual([0]);
    home.blur();
    advance(1);
    home.focus();
    expect(pulls).toEqual([0, FOCUS_PULL_GAP_MS]);
  });

  it('pulls every 2 minutes while Home stays in focus, and stops when it loses it', () => {
    const { home, pulls, advance, timers } = setUp();
    home.focus();
    advance(2 * HOME_PULL_EVERY_MS);
    expect(pulls).toEqual([0, HOME_PULL_EVERY_MS, 2 * HOME_PULL_EVERY_MS]);
    home.blur();
    expect(timers()).toBe(0);
    advance(10 * HOME_PULL_EVERY_MS);
    expect(pulls).toHaveLength(3);
  });

  it('stops while the app is in the background, and leaves the pull on return to the account', () => {
    const { home, pulls, advance, timers } = setUp();
    home.focus();
    advance(60_000);
    home.setActive(false);
    expect(timers()).toBe(0);
    advance(10 * HOME_PULL_EVERY_MS);
    expect(pulls).toEqual([0]);
    // The account pulls by itself on coming back; Home's own count starts again from here.
    home.setActive(true);
    expect(pulls).toEqual([0]);
    advance(HOME_PULL_EVERY_MS);
    expect(pulls).toEqual([0, 60_000 + 10 * HOME_PULL_EVERY_MS + HOME_PULL_EVERY_MS]);
  });

  it('asks nothing while the app is in the background, nor away from Home', () => {
    const { home, pulls, advance, timers } = setUp({ active: false });
    home.focus();
    expect(pulls).toEqual([]);
    expect(timers()).toBe(0);
    home.blur();
    home.setActive(true);
    advance(10 * HOME_PULL_EVERY_MS);
    expect(pulls).toEqual([]);
  });

  it('counts a pull the account made for itself, such as on coming back to the app', () => {
    let lastPull: number | undefined = 5_000;
    const { home, pulls, advance } = setUp({ lastPull: () => lastPull });
    advance(10_000);
    home.focus();
    expect(pulls).toEqual([]);
    home.blur();
    advance(FOCUS_PULL_GAP_MS);
    home.focus();
    expect(pulls).toEqual([10_000 + FOCUS_PULL_GAP_MS]);
    lastPull = undefined;
    home.blur();
    advance(FOCUS_PULL_GAP_MS);
    home.focus();
    expect(pulls).toHaveLength(2);
  });
});
