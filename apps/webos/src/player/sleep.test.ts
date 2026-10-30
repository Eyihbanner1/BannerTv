import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastInput = 0;
vi.mock('../navigation/activity', () => ({ sinceActivity: () => Date.now() - lastInput }));

const { autoplaysSinceInput, countAutoplay, keepSleepTimer, SLEEP_OFF, sleepTimerFor } =
  await import('./sleep');

describe('episodes that started by themselves', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('count up while nothing is pressed, and start again from a key press', () => {
    lastInput = Date.now();
    vi.advanceTimersByTime(60_000);
    expect(autoplaysSinceInput()).toBe(0);
    countAutoplay();
    vi.advanceTimersByTime(60_000);
    countAutoplay();
    expect(autoplaysSinceInput()).toBe(2);
    // A key after the second one: none since.
    lastInput = Date.now();
    vi.advanceTimersByTime(60_000);
    expect(autoplaysSinceInput()).toBe(0);
    countAutoplay();
    expect(autoplaysSinceInput()).toBe(1);
  });
});

describe('the sleep timer kept between screens', () => {
  it('is kept for the title it was set on, and off for another', () => {
    const timer = { choice: 30, endsAt: 5_000_000 } as const;
    keepSleepTimer('tt1', timer);
    expect(sleepTimerFor('tt1')).toEqual(timer);
    expect(sleepTimerFor('tt2')).toEqual(SLEEP_OFF);
    keepSleepTimer('tt1', SLEEP_OFF);
    expect(sleepTimerFor('tt1')).toEqual(SLEEP_OFF);
  });
});
