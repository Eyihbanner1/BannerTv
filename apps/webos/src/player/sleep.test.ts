import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastInput = 0;
vi.mock('../navigation/activity', () => ({ sinceInput: () => Date.now() - lastInput }));

const {
  autoplaysSinceInput,
  countAutoplay,
  keepSleepTimer,
  leaveSleepTimer,
  SLEEP_OFF,
  sleepTimerFor,
} = await import('./sleep');

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
    expect(sleepTimerFor('tt1', 0)).toEqual(timer);
    expect(sleepTimerFor('tt2', 0)).toEqual(SLEEP_OFF);
    keepSleepTimer('tt1', SLEEP_OFF);
    expect(sleepTimerFor('tt1', 0)).toEqual(SLEEP_OFF);
  });

  it('reads as off once its time has passed while nothing played', () => {
    keepSleepTimer('tt1', { choice: 30, endsAt: 5_000_000 });
    expect(sleepTimerFor('tt1', 4_999_999).choice).toBe(30);
    expect(sleepTimerFor('tt1', 5_000_000)).toEqual(SLEEP_OFF);
    // The end of the episode has no time to pass.
    keepSleepTimer('tt1', { choice: 'end', endsAt: null });
    expect(sleepTimerFor('tt1', 9_000_000).choice).toBe('end');
  });

  it("carries on only into this title's player or All streams", () => {
    const timer = { choice: 30, endsAt: 5_000_000 } as const;
    keepSleepTimer('tt1', timer);
    leaveSleepTimer('tt1', { name: 'streams', type: 'movie', metaId: 'tt1' } as never);
    expect(sleepTimerFor('tt1', 0)).toEqual(timer);
    leaveSleepTimer('tt1', { name: 'player', metaId: 'tt1' } as never);
    expect(sleepTimerFor('tt1', 0)).toEqual(timer);
    leaveSleepTimer('tt2', { name: 'home' } as never);
    expect(sleepTimerFor('tt1', 0)).toEqual(timer);
    leaveSleepTimer('tt1', { name: 'details', type: 'movie', id: 'tt1' } as never);
    expect(sleepTimerFor('tt1', 0)).toEqual(SLEEP_OFF);
  });
});
