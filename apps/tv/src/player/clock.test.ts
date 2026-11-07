import { describe, expect, it } from 'vitest';
import { endsAt, fraction, seekTarget } from './clock';

describe('endsAt', () => {
  const now = Date.UTC(2026, 10, 1, 20, 0, 0);

  it('adds what is left to the clock', () => {
    expect(endsAt(600, 3600, 1, now)).toBe(now + 3000 * 1000);
  });

  it('allows for the playback speed', () => {
    expect(endsAt(0, 3000, 1.5, now)).toBe(now + 2000 * 1000);
  });

  it('says nothing for live or unknown lengths', () => {
    expect(endsAt(10, 0, 1, now)).toBeNull();
    expect(endsAt(3600, 3600, 1, now)).toBeNull();
  });
});

describe('seekTarget', () => {
  it('moves by the step and stays inside the video', () => {
    expect(seekTarget(100, 10, 3600)).toBe(110);
    expect(seekTarget(5, -10, 3600)).toBe(0);
    expect(seekTarget(3595, 10, 3600)).toBe(3599);
  });

  it('only stops at the start when the length is unknown', () => {
    expect(seekTarget(100, 10, 0)).toBe(110);
  });
});

describe('fraction', () => {
  it('is clamped between 0 and 1', () => {
    expect(fraction(30, 60)).toBe(0.5);
    expect(fraction(90, 60)).toBe(1);
    expect(fraction(10, 0)).toBe(0);
  });
});
