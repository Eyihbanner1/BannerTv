import { describe, expect, it } from 'vitest';
import { createProgressTracker } from './tracker';

describe('createProgressTracker', () => {
  it('ignores the 0 a webOS mediaOption start reads before the real position', () => {
    const tracker = createProgressTracker({ startAt: 30 });
    expect(tracker.update(0, 1000)).toBe(false);
    expect(tracker.position()).toBeUndefined();

    expect(tracker.update(29.35, 1055)).toBe(true);
    expect(tracker.position()).toBe(29.35);
  });

  it('asks for a save on the first trusted reading, then every saveEveryMs', () => {
    const tracker = createProgressTracker({ startAt: 30, saveEveryMs: 10000 });
    expect(tracker.update(30.1, 0)).toBe(true);
    expect(tracker.update(31, 1000)).toBe(false);
    expect(tracker.update(39.9, 9999)).toBe(false);
    expect(tracker.position()).toBe(39.9);
    expect(tracker.update(40.1, 10000)).toBe(true);
    expect(tracker.update(45, 15000)).toBe(false);
    expect(tracker.update(50.1, 20000)).toBe(true);
  });

  it('settles at the first moving reading when playback starts from the beginning', () => {
    const tracker = createProgressTracker({ startAt: 0 });
    expect(tracker.update(0, 0)).toBe(false);
    expect(tracker.update(0, 250)).toBe(false);
    expect(tracker.position()).toBeUndefined();
    expect(tracker.update(0.25, 500)).toBe(true);
    expect(tracker.position()).toBe(0.25);
  });

  it('trusts the clock once it is within the tolerance before the start point', () => {
    const tracker = createProgressTracker({ startAt: 600, tolerance: 15 });
    expect(tracker.update(12, 0)).toBe(false);
    expect(tracker.update(584.9, 100)).toBe(false);
    expect(tracker.update(585, 200)).toBe(true);
  });

  it('trusts any reading once settled, even one behind the start point', () => {
    const tracker = createProgressTracker({ startAt: 600 });
    tracker.update(600, 0);
    tracker.update(2, 500);
    expect(tracker.position()).toBe(2);
  });

  it('still ignores the 0 when the start point is within the tolerance of the beginning', () => {
    const tracker = createProgressTracker({ startAt: 10, tolerance: 15 });
    expect(tracker.update(0, 0)).toBe(false);
    expect(tracker.position()).toBeUndefined();
    expect(tracker.update(9.8, 60)).toBe(true);
  });

  it('ignores readings that are not a time', () => {
    const tracker = createProgressTracker({ startAt: 0 });
    for (const reading of [NaN, Infinity, -1]) {
      expect(tracker.update(reading, 0)).toBe(false);
    }
    expect(tracker.position()).toBeUndefined();

    tracker.update(5, 0);
    expect(tracker.update(NaN, 20000)).toBe(false);
    expect(tracker.position()).toBe(5);
  });

  it('trusts a seek straight away, back to the beginning too, and saves on the next reading', () => {
    const tracker = createProgressTracker({ startAt: 1800 });
    expect(tracker.update(0, 0)).toBe(false);

    tracker.seeked(0);
    expect(tracker.position()).toBe(0);
    expect(tracker.update(0, 100)).toBe(true);
    expect(tracker.update(0.5, 600)).toBe(false);

    tracker.seeked(300);
    expect(tracker.position()).toBe(300);
    expect(tracker.update(300.2, 800)).toBe(true);
    expect(tracker.update(305, 5000)).toBe(false);
    expect(tracker.update(310, 10800)).toBe(true);
  });

  it('ignores a seek to a position that is not a time', () => {
    const tracker = createProgressTracker({ startAt: 30 });
    tracker.seeked(NaN);
    expect(tracker.position()).toBeUndefined();
    expect(tracker.update(0, 0)).toBe(false);
  });

  it('saves when the wall clock jumps back instead of waiting for it to catch up', () => {
    const tracker = createProgressTracker({ startAt: 0 });
    expect(tracker.update(1, 1_000_000)).toBe(true);
    expect(tracker.update(2, 5000)).toBe(true);
    expect(tracker.update(3, 6000)).toBe(false);
  });
});
