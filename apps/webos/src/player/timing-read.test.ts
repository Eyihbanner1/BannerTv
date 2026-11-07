import { describe, expect, it } from 'vitest';
import { MAX_READ_DELAY_MS, MIN_READ_DELAY_MS, nextReadDelay } from './timing';

describe('nextReadDelay', () => {
  it('wakes just after the next line is due, at the speed playing', () => {
    expect(nextReadDelay(10, 10.1, 1, false)).toBeCloseTo(104, 6);
    expect(nextReadDelay(10, 10.1, 2, false)).toBeCloseTo(54, 6);
    expect(nextReadDelay(10, 10.1, 0.5, false)).toBeCloseTo(204, 6);
  });

  it('never sleeps past the slow read, nor spins on a change already due', () => {
    expect(nextReadDelay(10, 30, 1, false)).toBe(MAX_READ_DELAY_MS);
    expect(nextReadDelay(10, 10, 1, false)).toBe(MIN_READ_DELAY_MS);
    expect(nextReadDelay(10, 9, 1, false)).toBe(MIN_READ_DELAY_MS);
  });

  it('only reads slowly while paused, stopped, or with nothing more to show', () => {
    expect(nextReadDelay(10, 10.05, 1, true)).toBe(MAX_READ_DELAY_MS);
    expect(nextReadDelay(10, 10.05, 0, false)).toBe(MAX_READ_DELAY_MS);
    expect(nextReadDelay(10, Infinity, 1, false)).toBe(MAX_READ_DELAY_MS);
    expect(nextReadDelay(NaN, 10, 1, false)).toBe(MAX_READ_DELAY_MS);
  });
});
