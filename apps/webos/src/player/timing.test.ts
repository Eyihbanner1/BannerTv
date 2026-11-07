import { describe, expect, it } from 'vitest';
import {
  COARSE_TIMING_STEPS,
  formatOffset,
  offsetWay,
  stepAmount,
  stepLabel,
  stepOffset,
  TIMING_STEPS,
} from './timing';

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

  it('has big steps of 5 s beside the fine ones, still landing on tenths', () => {
    expect(COARSE_TIMING_STEPS).toEqual([-5, 5]);
    expect(stepOffset(0.3, 5)).toBe(5.3);
    expect(stepOffset(stepOffset(0.3, 5), -5)).toBe(0.3);
    expect(stepOffset(-0.1, -5)).toBe(-5.1);
  });

  it('names a step in whole seconds where it is one, with a true minus', () => {
    expect(stepLabel(-0.5)).toBe('−0.5 s');
    expect(stepLabel(0.1)).toBe('+0.1 s');
    expect(stepLabel(5)).toBe('+5 s');
    expect(stepLabel(-5)).toBe('−5 s');
    expect(stepAmount(-0.1)).toBe('0.1');
    expect(stepAmount(5)).toBe('5');
  });
});
