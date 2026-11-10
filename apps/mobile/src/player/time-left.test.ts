import { startSleep } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { endsAt, sleepMinutesLeft } from './time-left';

const now = Date.UTC(2026, 10, 9, 21, 0, 0);
const MINUTE = 60 * 1000;

describe('endsAt', () => {
  it('is now plus what is left of the video', () => {
    expect(endsAt(now, 600, 1500, 1, false)).toBe(now + 900 * 1000);
  });

  it('comes sooner at a faster speed, and later at a slower one', () => {
    expect(endsAt(now, 600, 1500, 1.5, false)).toBe(now + 600 * 1000);
    expect(endsAt(now, 600, 1500, 0.75, false)).toBe(now + 1200 * 1000);
  });

  it('is now at the end, and never before it', () => {
    expect(endsAt(now, 1500, 1500, 1, false)).toBe(now);
    expect(endsAt(now, 1600, 1500, 1, false)).toBe(now);
  });

  it('is unknown on a broadcast and until the length is known', () => {
    expect(endsAt(now, 600, 1500, 1, true)).toBeNull();
    expect(endsAt(now, 0, 0, 1, false)).toBeNull();
    expect(endsAt(now, 0, Infinity, 1, false)).toBeNull();
    expect(endsAt(now, 0, NaN, 1, false)).toBeNull();
  });

  it('reads a speed that is no speed as normal', () => {
    expect(endsAt(now, 600, 1500, 0, false)).toBe(now + 900 * 1000);
  });
});

describe('sleepMinutesLeft', () => {
  it('counts whole minutes left, rounded up', () => {
    const timer = startSleep(30, now);
    expect(sleepMinutesLeft(timer, now)).toBe(30);
    expect(sleepMinutesLeft(timer, now + 1)).toBe(30);
    expect(sleepMinutesLeft(timer, now + MINUTE)).toBe(29);
    expect(sleepMinutesLeft(timer, now + 29.5 * MINUTE)).toBe(1);
  });

  it('says 1 minute in the last seconds, and after the deadline', () => {
    const timer = startSleep(15, now);
    expect(sleepMinutesLeft(timer, now + 15 * MINUTE - 1000)).toBe(1);
    expect(sleepMinutesLeft(timer, now + 16 * MINUTE)).toBe(1);
  });

  it('has nothing to count when off or at the end of the video', () => {
    expect(sleepMinutesLeft(startSleep('off', now), now)).toBeNull();
    expect(sleepMinutesLeft(startSleep('end', now), now)).toBeNull();
  });
});
