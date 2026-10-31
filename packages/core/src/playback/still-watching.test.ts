import { describe, expect, it } from 'vitest';
import {
  askStillWatching,
  STILL_WATCHING_EPISODES,
  STILL_WATCHING_QUIET_MS,
} from './still-watching';

const MIN = 60_000;
const ask = (autoplaysSinceInput: number, sinceInputMs = 10 * MIN) =>
  askStillWatching({ autoplaysSinceInput, sinceInputMs });

describe('askStillWatching', () => {
  it('does not ask before the first or second episode that starts by itself', () => {
    expect(ask(0)).toBe(false);
    expect(ask(1)).toBe(false);
  });

  it('asks before the third episode in a row would start by itself', () => {
    expect(STILL_WATCHING_EPISODES).toBe(3);
    expect(ask(2)).toBe(true);
    expect(ask(5)).toBe(true);
  });

  it('counts three whole episodes from the one the viewer started', () => {
    // E1 started with a press; E2 and E3 started by themselves.
    let autoplays = 0;
    const asked: boolean[] = [];
    for (let end = 1; end <= 3; end++) {
      const asks = ask(autoplays);
      asked.push(asks);
      if (!asks) autoplays++;
    }
    expect(asked).toEqual([false, false, true]);
  });

  it('asks after 90 minutes with nothing pressed, whatever the count', () => {
    expect(STILL_WATCHING_QUIET_MS).toBe(90 * MIN);
    expect(ask(0, 90 * MIN)).toBe(true);
    expect(ask(1, 90 * MIN)).toBe(true);
    expect(ask(1, 89 * MIN)).toBe(false);
    expect(ask(0, 90 * MIN - 1)).toBe(false);
  });

  it('does not ask for the time alone when the clock went back', () => {
    expect(ask(0, -5 * MIN)).toBe(false);
    expect(ask(2, -5 * MIN)).toBe(true);
  });
});
