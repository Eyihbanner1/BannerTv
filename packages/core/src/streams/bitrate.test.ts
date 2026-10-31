import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_BITRATE,
  estimateBitrate,
  isLighter,
  isMuchShorter,
  isTooSmall,
  parseRuntime,
} from './bitrate';

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
    // A live stream's length is endless: 0 bit/s would make every file look tiny.
    for (const runtime of [undefined, 0, -60, NaN, Infinity]) {
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

  it('compares resolutions over an endless running time, never 0 against 0', () => {
    const current = { resolution: '1080p' as const, sizeBytes: 9 * GB };
    expect(isLighter({ resolution: '2160p', sizeBytes: 60 * GB }, current, Infinity)).toBe(false);
    expect(isLighter({ resolution: '720p', sizeBytes: 3 * GB }, current, Infinity)).toBe(true);
  });
});

describe('isTooSmall', () => {
  const MB = 1024 * 1024;
  /** A 45-minute episode. */
  const EPISODE = 2700;

  it('keeps the smallest real encodes', () => {
    // A 24-minute 720p x265 episode of 70 MB: about 400 kbit/s.
    expect(isTooSmall({ resolution: '720p', sizeBytes: 70 * MB }, 1440)).toBe(false);
    // A 45-minute 1080p x265 episode of 250 MB: about 780 kbit/s.
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 250 * MB }, EPISODE)).toBe(false);
    // A 2-hour 4K x265 film of 4 GB: about 4.8 Mbit/s.
    expect(isTooSmall({ resolution: '2160p', sizeBytes: 4096 * MB }, TWO_HOURS)).toBe(false);
    // A 22-minute 480p x265 episode of 50 MB: about 320 kbit/s.
    expect(isTooSmall({ resolution: '480p', sizeBytes: 50 * MB }, 1320)).toBe(false);
    // A 24-minute 1080p anime episode of 150 MB, and a 2-hour 4K encode of 2 GB.
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 150 * MB }, 1440)).toBe(false);
    expect(isTooSmall({ resolution: '2160p', sizeBytes: 2048 * MB }, TWO_HOURS)).toBe(false);
  });

  it('finds files far too small for the length playing', () => {
    // 30 seconds of 1080p at 8 Mbit/s, against a 45-minute episode: about 90 kbit/s.
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 30e6 }, EPISODE)).toBe(true);
    expect(isTooSmall({ sizeBytes: 30e6 }, EPISODE)).toBe(true);
    // A 4K trailer of 100 MB against a 2-hour film.
    expect(isTooSmall({ resolution: '2160p', sizeBytes: 100 * MB }, TWO_HOURS)).toBe(true);
    expect(isTooSmall({ resolution: '720p', sizeBytes: 100 * 1024 }, 40)).toBe(true);
  });

  it('judges by the floor of the resolution named', () => {
    // 50 MB over 45 minutes is about 155 kbit/s: too little for 1080p or 720p, enough for SD.
    const facts = { sizeBytes: 50 * MB };
    expect(isTooSmall({ ...facts, resolution: '1080p' }, EPISODE)).toBe(true);
    expect(isTooSmall({ ...facts, resolution: '720p' }, EPISODE)).toBe(true);
    expect(isTooSmall({ ...facts, resolution: '480p' }, EPISODE)).toBe(false);
    expect(isTooSmall(facts, EPISODE)).toBe(false);
  });

  it('keeps a file exactly at the floor and drops one just under it', () => {
    // 0.3 Mbit/s over 1000 s is 37.5 MB.
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 37.5e6 }, 1000)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 37.5e6 - 1 }, 1000)).toBe(true);
  });

  it('says nothing without a size or a length', () => {
    expect(isTooSmall({ resolution: '1080p' }, EPISODE)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 1e6 }, undefined)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 1e6 }, 0)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 0 }, EPISODE)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 1e6 }, -EPISODE)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 1e6 }, NaN)).toBe(false);
    expect(isTooSmall({ resolution: '1080p', sizeBytes: NaN }, EPISODE)).toBe(false);
  });

  it('says nothing over the endless length of a live stream', () => {
    expect(isTooSmall({ resolution: '1080p', sizeBytes: 2 * GB }, Infinity)).toBe(false);
    expect(isTooSmall({ sizeBytes: 30e6 }, Infinity)).toBe(false);
  });
});

describe('isMuchShorter', () => {
  it('finds a stream under five minutes of a video of 20 minutes or more', () => {
    expect(isMuchShorter(30, 2700)).toBe(true);
    expect(isMuchShorter(299, 1200)).toBe(true);
    expect(isMuchShorter(299, 3300)).toBe(true);
    expect(isMuchShorter(2400, 2700)).toBe(false);
    expect(isMuchShorter(1350, 2700)).toBe(false);
  });

  it('never takes five minutes or more for a clip, as a running time can be far off for one episode', () => {
    expect(isMuchShorter(300, 3300)).toBe(false);
    expect(isMuchShorter(1300, 2700)).toBe(false);
  });

  it('says nothing for a video under 20 minutes or a stream with no length yet', () => {
    expect(isMuchShorter(30, 900)).toBe(false);
    expect(isMuchShorter(149, 1199)).toBe(false);
    expect(isMuchShorter(30, 200)).toBe(false);
    expect(isMuchShorter(0, 2700)).toBe(false);
    expect(isMuchShorter(NaN, 2700)).toBe(false);
    expect(isMuchShorter(30, NaN)).toBe(false);
  });

  it('says nothing against a live stream, and finds no live stream short', () => {
    expect(isMuchShorter(30, Infinity)).toBe(false);
    expect(isMuchShorter(Infinity, 2700)).toBe(false);
  });
});
