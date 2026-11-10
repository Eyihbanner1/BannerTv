import { SPEED_TEST_RATES } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { chosenSpeed, PHONE_SPEEDS } from './speed-choices';

describe('the phone speeds', () => {
  it('are Normal, then the speeds the TV offers, in the TV’s order', () => {
    expect(PHONE_SPEEDS).toEqual([1, ...SPEED_TEST_RATES]);
    expect(PHONE_SPEEDS).toEqual([1, 0.75, 1.25, 1.5]);
  });

  it('mark the speed playing, or Normal for any other', () => {
    expect(chosenSpeed(1.25)).toBe(1.25);
    expect(chosenSpeed(1)).toBe(1);
    expect(chosenSpeed(2)).toBe(1);
  });
});
