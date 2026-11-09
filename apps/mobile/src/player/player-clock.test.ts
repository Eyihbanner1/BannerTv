import { describe, expect, it } from 'vitest';
import { type ClockReading, readClock, STOPPED_CLOCK } from './player-clock';

const reading = (over: Partial<ClockReading> = {}): ClockReading => ({
  position: 100,
  at: 10_000,
  rate: 1,
  running: true,
  duration: 1500,
  ...over,
});

describe('readClock', () => {
  it('moves on with the wall clock while the video plays', () => {
    expect(readClock(reading(), 10_000)).toBe(100);
    expect(readClock(reading(), 10_400)).toBeCloseTo(100.4);
  });

  it('moves on at the speed playing, so lines keep pace between reports', () => {
    expect(readClock(reading({ rate: 1.5 }), 10_500)).toBeCloseTo(100.75);
    expect(readClock(reading({ rate: 0.75 }), 10_400)).toBeCloseTo(100.3);
  });

  it('stands still while paused, buffering or ended', () => {
    expect(readClock(reading({ running: false }), 60_000)).toBe(100);
    expect(readClock(STOPPED_CLOCK, 60_000)).toBe(0);
  });

  it('never runs past the end, and runs on when the length is unknown', () => {
    expect(readClock(reading({ position: 1499 }), 15_000)).toBe(1500);
    expect(readClock(reading({ duration: 0 }), 12_000)).toBeCloseTo(102);
  });

  it('never goes back for a reading taken a moment after the time asked', () => {
    expect(readClock(reading(), 9_000)).toBe(100);
  });

  it('treats a speed that is no speed as normal', () => {
    expect(readClock(reading({ rate: 0 }), 11_000)).toBeCloseTo(101);
    expect(readClock(reading({ rate: NaN }), 11_000)).toBeCloseTo(101);
  });
});
