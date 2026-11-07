import { describe, expect, it } from 'vitest';
import { BACK_TO_MIN_JUMP_S, offersBackTo, skipStep } from './seeking';

describe('skipStep', () => {
  it('goes 10 s a press, then 30 s and 60 s the longer a key is held', () => {
    expect([0, 4, 5, 12, 13, 40].map(skipStep)).toEqual([10, 10, 30, 30, 60, 60]);
  });
});

describe('offersBackTo', () => {
  it('offers to go back after a jump of two minutes or more, either way', () => {
    expect(offersBackTo(600, 600 + BACK_TO_MIN_JUMP_S - 1)).toBe(false);
    expect(offersBackTo(600, 600 + BACK_TO_MIN_JUMP_S)).toBe(true);
    expect(offersBackTo(2530, 30)).toBe(true);
  });

  it('never while a time is unknown', () => {
    expect(offersBackTo(NaN, 600)).toBe(false);
    expect(offersBackTo(0, Infinity)).toBe(false);
    expect(offersBackTo(-1, 600)).toBe(false);
  });
});
