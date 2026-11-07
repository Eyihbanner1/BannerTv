import { describe, expect, it } from 'vitest';
import { addSkip, DOUBLE_TAP_MS, type PendingSkip, readTap, skipTotal, tapSide } from './tap-skip';

const episode = 45 * 60;

/** Taps or presses one after another from `position`, as a viewer makes them. */
function taps(directions: (-1 | 1)[], position: number, duration = episode): PendingSkip | null {
  return directions.reduce<PendingSkip | null>(
    (pending, direction) => addSkip(pending, direction, position, duration),
    null,
  );
}

describe('tapSide', () => {
  it('splits the picture down the middle', () => {
    expect(tapSide(10, 800)).toBe('left');
    expect(tapSide(399, 800)).toBe('left');
    expect(tapSide(400, 800)).toBe('right');
    expect(tapSide(790, 800)).toBe('right');
  });
});

describe('readTap', () => {
  it('takes a lone tap as a single tap', () => {
    expect(readTap(null, false, 1000, 'right')).toBe('single');
  });

  it('takes a second tap on the same half, soon after, as a double tap', () => {
    const first = { at: 1000, side: 'right' as const };
    expect(readTap(first, false, 1000 + DOUBLE_TAP_MS - 1, 'right')).toBe('double');
    expect(readTap(first, false, 1000 + DOUBLE_TAP_MS, 'right')).toBe('single');
    expect(readTap(first, false, 1100, 'left')).toBe('single');
  });

  it('counts every tap, on either half, while a skip adds up', () => {
    expect(readTap(null, true, 1000, 'right')).toBe('count');
    expect(readTap({ at: 1000, side: 'right' }, true, 5000, 'left')).toBe('count');
  });
});

describe('addSkip', () => {
  it('starts 10 s either way from where the video is', () => {
    expect(addSkip(null, 1, 600, episode)).toEqual({ origin: 600, target: 610, side: 'right' });
    expect(addSkip(null, -1, 600, episode)).toEqual({ origin: 600, target: 590, side: 'left' });
  });

  it('adds 10 s a tap to one total, counted from where it began', () => {
    const skip = taps([1, 1, 1], 600);
    expect(skip).toEqual({ origin: 600, target: 630, side: 'right' });
    expect(skipTotal(skip!)).toBe(30);
    expect(skipTotal(taps([-1, -1], 600)!)).toBe(-20);
  });

  it('keeps counting from where it began, wherever the video has got to meanwhile', () => {
    const first = addSkip(null, 1, 600, episode);
    expect(addSkip(first, 1, 601.5, episode)).toEqual({ origin: 600, target: 620, side: 'right' });
  });

  it('counts back from the total so far for a tap the other way', () => {
    expect(taps([1, 1, 1, 1, -1], 600)).toEqual({ origin: 600, target: 630, side: 'right' });
  });

  it('puts the ripple on the side the total goes, turning round as it does', () => {
    expect(taps([1, -1], 600)).toEqual({ origin: 600, target: 600, side: 'left' });
    expect(taps([1, -1, -1], 600)).toEqual({ origin: 600, target: 590, side: 'left' });
    expect(taps([-1, 1], 600)?.side).toBe('right');
  });

  it('never goes before the start', () => {
    expect(taps([-1, -1], 14)).toEqual({ origin: 14, target: 0, side: 'left' });
    expect(addSkip(null, -1, 0, episode)).toEqual({ origin: 0, target: 0, side: 'left' });
  });

  it('never goes past the last second of a file with a length', () => {
    expect(taps([1, 1], episode - 15)?.target).toBe(episode - 1);
    // Within the last second already, forward stays put.
    expect(addSkip(null, 1, episode - 0.5, episode).target).toBe(episode - 0.5);
  });

  it('keeps a file with no length yet only from going before its start', () => {
    expect(taps([1, 1, 1], 30, 0)?.target).toBe(60);
    expect(taps([-1, -1, -1, -1], 30, NaN)?.target).toBe(0);
  });

  it('can add up to a big jump', () => {
    const twelve = taps(Array<1>(12).fill(1), 600);
    expect(skipTotal(twelve!)).toBe(120);
  });
});
