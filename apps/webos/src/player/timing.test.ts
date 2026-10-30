import { describe, expect, it } from 'vitest';
import { formatOffset, offsetWay, stepOffset, TIMING_STEPS } from './timing';

describe('subtitle timing', () => {
  it('reads an offset with its sign, a true minus for earlier', () => {
    expect(formatOffset(0.5)).toBe('+0.5 s');
    expect(formatOffset(-1.25)).toBe('−1.2 s');
    expect(formatOffset(0.04)).toBe('0.0 s');
    expect(formatOffset(-0.04)).toBe('0.0 s');
  });

  it('steps in tenths without drifting', () => {
    let offset = 0;
    for (let i = 0; i < 7; i++) offset = stepOffset(offset, 0.1);
    expect(offset).toBe(0.7);
    expect(stepOffset(0.7, -0.5)).toBe(0.2);
    expect(TIMING_STEPS).toEqual([-0.5, -0.1, 0.1, 0.5]);
  });

  it('says which way the subtitles move', () => {
    expect(offsetWay(0.5)).toEqual({ way: 'later', amount: '0.5' });
    expect(offsetWay(-2)).toEqual({ way: 'earlier', amount: '2.0' });
    expect(offsetWay(0)).toEqual({ way: 'none', amount: '0.0' });
  });
});
