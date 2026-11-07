import { describe, expect, it } from 'vitest';
import { sameAsLast } from './same-as-last';

describe('sameAsLast', () => {
  it('is true only for the same values as the call before', () => {
    const same = sameAsLast();
    const tracks: unknown[] = [];
    expect(same([tracks, 'playing', 'hls.js', null])).toBe(false);
    expect(same([tracks, 'playing', 'hls.js', null])).toBe(true);
    // A new list with the same contents is another list.
    expect(same([[], 'playing', 'hls.js', null])).toBe(false);
    expect(same([[], 'paused', 'hls.js', null])).toBe(false);
  });

  it('compares as React does, NaN with NaN, and minds the count', () => {
    const same = sameAsLast();
    expect(same([NaN])).toBe(false);
    expect(same([NaN])).toBe(true);
    expect(same([NaN, 1])).toBe(false);
    expect(same([NaN])).toBe(false);
  });
});
