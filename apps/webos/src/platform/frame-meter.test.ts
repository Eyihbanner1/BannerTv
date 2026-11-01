import { describe, expect, it } from 'vitest';
import { summarise } from './frame-meter';

describe('summarise', () => {
  it('is all zeros with no frames', () => {
    expect(summarise([])).toEqual({
      frames: 0,
      p50: 0,
      p95: 0,
      worst: 0,
      missed: 0,
      stutters: 0,
      jankyPercent: 0,
    });
  });

  it('counts smooth frames as smooth, timer noise included', () => {
    const value = summarise([16.7, 16.6, 17.2, 16.7]);
    expect(value).toMatchObject({ frames: 4, missed: 0, stutters: 0, jankyPercent: 0 });
    expect(value.worst).toBe(17.2);
  });

  it('counts the frames a long gap missed, and stutters', () => {
    // 33.3 misses one frame, 100 misses five and is a stutter.
    const value = summarise([16.7, 33.3, 100, 16.7]);
    expect(value.missed).toBe(6);
    expect(value.stutters).toBe(1);
    expect(value.jankyPercent).toBe(50);
    expect(value.worst).toBe(100);
  });

  it('takes p50 and p95 from the sorted gaps', () => {
    const gaps = Array.from({ length: 100 }, (_, index) => (index < 90 ? 16.7 : 50));
    const value = summarise(gaps);
    expect(value.p50).toBe(16.7);
    expect(value.p95).toBe(50);
  });
});
