import { describe, expect, it } from 'vitest';
import {
  fitTwoTaps,
  MAX_TAP_OFFSET_S,
  MIN_TAP_GAP_S,
  REACTION_S,
  type Tap,
  tapOffset,
  TAP_FIT_S,
} from './taps';

const AHEAD = 24000 / 1001 / 25;
const BEHIND = 25 / (24000 / 1001);
const RATES = [1, AHEAD, BEHIND] as const;

/**
 * A press on the line the file times at `start`: where the player shows it, at `rate` and
 * `offset`, plus the viewer's reaction at `speed` and some noise.
 */
function press(start: number, rate: number, offset: number, noise = 0, speed = 1): Tap {
  return { at: start / rate + offset + REACTION_S * speed + noise, speed, start };
}

describe('tapOffset', () => {
  it('one press: the line shows when it was heard, less the reaction time', () => {
    // The line starts at 100 s; the viewer pressed 2.3 s after it showed, 0.3 s of that reaction.
    expect(tapOffset({ at: 102.3, speed: 1, start: 100 })).toBeCloseTo(2, 9);
    // At 1.5 times the speed, the reaction takes more of the video's clock.
    expect(tapOffset({ at: 102.45, speed: 1.5, start: 100 })).toBeCloseTo(2, 9);
    expect(tapOffset({ at: 98, speed: 1, start: 100 }, 0)).toBe(-2);
    expect(MIN_TAP_GAP_S).toBe(120);
    expect(TAP_FIT_S).toBe(1);
    expect(MAX_TAP_OFFSET_S).toBe(600);
  });
});

describe('fitTwoTaps', () => {
  it('two presses find no drift, getting ahead or falling behind, with ±0.3 s of noise each', () => {
    for (const rate of RATES) {
      for (const [noiseA, noiseB] of [
        [0, 0],
        [0.3, -0.3],
        [-0.3, 0.3],
        [0.3, 0.3],
      ] as const) {
        // Lines heard near 30 s and near 450 s of the video.
        const a = press(30 * rate, rate, -2, noiseA);
        const b = press(450 * rate, rate, -2, noiseB);
        const fit = fitTwoTaps(a, b, RATES);
        expect(fit).not.toBeNull();
        expect(fit && 'rate' in fit ? fit.rate : null).toBe(rate);
        if (fit && 'offset' in fit) {
          expect(Math.abs(fit.offset + 2)).toBeLessThanOrEqual(0.31);
          // Tenths of a second.
          expect(Math.round(fit.offset * 10) / 10).toBe(fit.offset);
        }
      }
    }
  });

  it('two presses under two minutes apart are no fit', () => {
    const a = press(30, 1, -2);
    expect(fitTwoTaps(a, press(140, 1, -2), RATES)).toBeNull();
    // Either order.
    expect(fitTwoTaps(press(140, 1, -2), a, RATES)).toBeNull();
    expect(fitTwoTaps(a, press(160, 1, -2), RATES)).not.toBeNull();
  });

  it('two presses that keep no steady pace are unsteady', () => {
    // The second line was pressed ten seconds late: no rate puts both on one timing.
    const a = press(30, 1, -2);
    const b = press(450, 1, -2, 10);
    expect(fitTwoTaps(a, b, RATES)).toEqual({ unsteady: true });
  });

  it('an offset past ten minutes is no fit', () => {
    const a = press(1000, 1, -700);
    const b = press(1600, 1, -700);
    expect(fitTwoTaps(a, b, RATES)).toEqual({ unsteady: true });
    expect(fitTwoTaps(press(1000, 1, -590), press(1600, 1, -590), RATES)).toEqual({
      offset: -590,
      rate: 1,
    });
  });
});
