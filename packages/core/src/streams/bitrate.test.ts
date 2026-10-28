import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_BITRATE, estimateBitrate, isLighter, parseRuntime } from './bitrate';

const GB = 1e9;
const TWO_HOURS = 7200;

describe('parseRuntime', () => {
  it('reads minutes, hours, and hours with minutes', () => {
    expect(parseRuntime('155 min')).toBe(9300);
    expect(parseRuntime('45min')).toBe(2700);
    expect(parseRuntime('90 minutes')).toBe(5400);
    expect(parseRuntime('2h 35min')).toBe(9300);
    expect(parseRuntime('1h30m')).toBe(5400);
    expect(parseRuntime('2 h')).toBe(7200);
    expect(parseRuntime('1 hr 55 mins')).toBe(6900);
    expect(parseRuntime('1.5h')).toBe(5400);
  });

  it('reads a bare number as minutes', () => {
    expect(parseRuntime('95')).toBe(5700);
    expect(parseRuntime('  95  ')).toBe(5700);
  });

  it('ignores case and spacing', () => {
    expect(parseRuntime(' 2H 35MIN ')).toBe(9300);
    expect(parseRuntime('2 h 35 min')).toBe(9300);
  });

  it('gives nothing for text that says nothing usable', () => {
    for (const text of [undefined, '', '   ', 'N/A', 'unknown', 'min', '0', '0 min', '95.5', '-']) {
      expect(parseRuntime(text)).toBeUndefined();
    }
  });
});

describe('estimateBitrate', () => {
  it('divides the size in bits by the running time', () => {
    // The 84 GB 4K remux from the TV run, over 2 h 35 min: about 72 Mbit/s.
    expect(estimateBitrate({ sizeBytes: 84 * GB }, 9300)).toBeCloseTo(72.26e6, -4);
    expect(estimateBitrate({ sizeBytes: 9 * GB }, TWO_HOURS)).toBe(10e6);
  });

  it('gives nothing when the size is unknown or not a size', () => {
    for (const sizeBytes of [undefined, 0, -1, NaN]) {
      expect(estimateBitrate({ sizeBytes }, TWO_HOURS)).toBeUndefined();
    }
  });

  it('gives nothing when the running time is unknown or not a time', () => {
    for (const runtime of [undefined, 0, -60, NaN]) {
      expect(estimateBitrate({ sizeBytes: 9 * GB }, runtime)).toBeUndefined();
    }
  });

  it('puts a 4K disc remux over the default limit and a 4K web release under it', () => {
    expect(estimateBitrate({ sizeBytes: 84 * GB }, 9300)!).toBeGreaterThan(DEFAULT_MAX_BITRATE);
    expect(estimateBitrate({ sizeBytes: 20 * GB }, 9300)!).toBeLessThan(DEFAULT_MAX_BITRATE);
  });
});

describe('isLighter', () => {
  it('compares bitrates when both sizes and the running time are known', () => {
    // 100 Mbit/s over two hours.
    const current = { resolution: '2160p' as const, sizeBytes: 90 * GB };
    expect(isLighter({ resolution: '2160p', sizeBytes: 20 * GB }, current, TWO_HOURS)).toBe(true);
    // 70 Mbit/s, exactly 70% of the data, still counts.
    expect(isLighter({ resolution: '2160p', sizeBytes: 63 * GB }, current, TWO_HOURS)).toBe(true);
    // A little more would buffer the same way, even at a lower resolution.
    expect(isLighter({ resolution: '1080p', sizeBytes: 64 * GB }, current, TWO_HOURS)).toBe(false);
  });

  it('goes by bitrate over resolution, so a big 1080p remux is no lighter than a small 4K file', () => {
    const current = { resolution: '2160p' as const, sizeBytes: 15 * GB };
    expect(isLighter({ resolution: '1080p', sizeBytes: 35 * GB }, current, TWO_HOURS)).toBe(false);
    expect(isLighter({ resolution: '2160p', sizeBytes: 5 * GB }, current, TWO_HOURS)).toBe(true);
  });

  it('compares resolutions when a bitrate is unknown', () => {
    const current = { resolution: '2160p' as const, sizeBytes: 60 * GB };
    // No running time.
    expect(isLighter({ resolution: '1080p', sizeBytes: 50 * GB }, current, undefined)).toBe(true);
    // No size for the candidate.
    expect(isLighter({ resolution: '1080p' }, current, TWO_HOURS)).toBe(true);
    // No size for the stream that kept buffering.
    expect(
      isLighter({ resolution: '720p', sizeBytes: GB }, { resolution: '1080p' }, TWO_HOURS),
    ).toBe(true);
  });

  it('does not count the same or a higher resolution as lighter without bitrates', () => {
    const current = { resolution: '1080p' as const };
    expect(isLighter({ resolution: '1080p' }, current, undefined)).toBe(false);
    expect(isLighter({ resolution: '2160p' }, current, undefined)).toBe(false);
    expect(isLighter({ resolution: '720p' }, current, undefined)).toBe(true);
    expect(isLighter({ resolution: '360p' }, { resolution: '480p' }, undefined)).toBe(true);
  });

  it('does not guess when a resolution is unknown', () => {
    expect(isLighter({}, { resolution: '2160p' }, undefined)).toBe(false);
    expect(isLighter({ resolution: '720p' }, {}, undefined)).toBe(false);
    expect(isLighter({}, {}, TWO_HOURS)).toBe(false);
  });
});
