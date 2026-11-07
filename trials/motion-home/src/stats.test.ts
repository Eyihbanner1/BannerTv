import { describe, expect, it } from 'vitest';
import { percentile, summarize } from './stats';

describe('summarize', () => {
  it('reports a smooth run as smooth', () => {
    const summary = summarize(new Array(120).fill(16.7));
    expect(summary).toMatchObject({ frames: 120, p50: 16.7, p95: 16.7, missed: 0, stutters: 0 });
    expect(summary.jankShare).toBe(0);
  });

  it('counts missed frames and stutters', () => {
    const gaps = [...new Array(96).fill(16.7), 40, 50, 120, 300];
    const summary = summarize(gaps);
    expect(summary.missed).toBe(4);
    expect(summary.stutters).toBe(2);
    expect(summary.max).toBe(300);
    expect(summary.jankShare).toBeGreaterThan(0.2);
  });

  it('handles no frames', () => {
    expect(summarize([])).toMatchObject({ frames: 0, p95: 0, max: 0, jankShare: 0 });
  });
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.95)).toBe(10);
    expect(percentile(sorted, 0.1)).toBe(1);
  });
});
