import { describe, expect, it } from 'vitest';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import {
  type ClockSample,
  clockRate,
  createSpeedMemory,
  judgeClock,
  judgeSpeed,
  SPEED_KINDS,
  SPEED_TEST_RATES,
  type SpeedFailure,
  type SpeedMeasurement,
  speedKindOf,
  type SpeedVerdict,
  steadyBaseline,
} from './speed';

const HLS = 'application/vnd.apple.mpegurl';
const DASH = 'application/dash+xml';

// Lets the chained storage writes finish. Core has no timers.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * Readings every `every` ms for `seconds`, of a clock running at `rate` from
 * `start` ms. A coarse clock moves only every `step` ms of wall time, its
 * steps falling `phase` ms before the first reading.
 */
function readings(
  rate: number,
  options: { seconds?: number; every?: number; start?: number; step?: number; phase?: number } = {},
): ClockSample[] {
  const { seconds = 4, every = 200, start = 5000, step = 0, phase = 0 } = options;
  const samples: ClockSample[] = [];
  for (let at = 0; at <= seconds * 1000; at += every) {
    const played = step > 0 ? Math.floor((at + phase) / step) * step : at;
    samples.push({ media: 10 + (played / 1000) * rate, wall: start + at });
  }
  return samples;
}

function measurement(overrides: Partial<SpeedMeasurement> = {}): SpeedMeasurement {
  return {
    asked: 1.5,
    baseline: 1,
    measured: 1.5,
    reported: 1.5,
    changes: [],
    interrupted: false,
    ...overrides,
  };
}

const pass = (rate: number): SpeedVerdict => ({ rate, ok: true, measured: rate });
const fail = (rate: number, why: SpeedFailure): SpeedVerdict => ({
  rate,
  ok: false,
  why,
  measured: 1,
});
const unsteady = (rate: number): SpeedVerdict => ({ rate, ok: false, why: 'unsteady' });
const allPass = (): SpeedVerdict[] => SPEED_TEST_RATES.map(pass);

/** Memory storage that counts its writes. */
function countingStorage(): KeyValueStore & { writes: number } {
  const inner = memoryKeyValueStore();
  const storage = {
    writes: 0,
    get: inner.get,
    set(key: string, value: unknown) {
      storage.writes++;
      return inner.set(key, value);
    },
  };
  return storage;
}

async function loaded(storage: KeyValueStore = memoryKeyValueStore()) {
  const memory = createSpeedMemory({ storage, now: () => 1000 });
  await memory.load();
  return memory;
}

describe('speedKindOf', () => {
  it('tells files from HLS on the TV’s own player', () => {
    for (const container of ['mkv', 'mp4', 'webm', 'ts', 'avi', 'mov', undefined] as const) {
      expect(speedKindOf('native', container)).toBe('native-file');
    }
    expect(speedKindOf('native', 'm3u8')).toBe('native-hls');
  });

  it('falls back to the type guessed from the link', () => {
    expect(speedKindOf('native', undefined, HLS)).toBe('native-hls');
    expect(speedKindOf('native', undefined, 'application/x-mpegURL')).toBe('native-hls');
    expect(speedKindOf('native', undefined, ' audio/mpegurl; charset=utf-8')).toBe('native-hls');
    expect(speedKindOf('native', undefined, 'video/mp4')).toBe('native-file');
    expect(speedKindOf('native', undefined, 'video/x-matroska')).toBe('native-file');
    expect(speedKindOf('native', undefined, '')).toBe('native-file');
  });

  it('counts a stream as HLS when either the container or the type says so', () => {
    expect(speedKindOf('native', 'mkv', HLS)).toBe('native-hls');
    expect(speedKindOf('native', 'm3u8', 'video/mp4')).toBe('native-hls');
  });

  it('has no kind for DASH on the TV’s own player, which is never tested', () => {
    expect(speedKindOf('native', 'mpd')).toBeUndefined();
    expect(speedKindOf('native', undefined, DASH)).toBeUndefined();
    expect(speedKindOf('native', 'm3u8', DASH)).toBeUndefined();
    expect(speedKindOf('native', 'mkv', 'Application/DASH+XML; profiles=x')).toBeUndefined();
  });

  it('maps hls.js and Shaka to themselves, whatever the stream', () => {
    expect(speedKindOf('hls.js')).toBe('hls.js');
    expect(speedKindOf('hls.js', 'm3u8', HLS)).toBe('hls.js');
    expect(speedKindOf('shaka', 'mpd', DASH)).toBe('shaka');
    expect(speedKindOf('shaka', 'mkv')).toBe('shaka');
  });

  it('has no kind without an engine it knows', () => {
    expect(speedKindOf(null)).toBeUndefined();
    expect(speedKindOf(undefined, 'mkv')).toBeUndefined();
    expect(speedKindOf('', 'mkv')).toBeUndefined();
    expect(speedKindOf('dash.js', 'mpd', DASH)).toBeUndefined();
    expect(speedKindOf('Native', 'mkv')).toBeUndefined();
  });
});

describe('clockRate', () => {
  it('gives the speed of a clean clock', () => {
    expect(clockRate(readings(1.5))).toBeCloseTo(1.5, 10);
    expect(clockRate(readings(0.75))).toBeCloseTo(0.75, 10);
    expect(clockRate(readings(1))).toBeCloseTo(1, 10);
  });

  it('keeps its precision after hours of wall clock', () => {
    const start = 9 * 60 * 60 * 1000 + 0.123;
    expect(clockRate(readings(1.25, { start }))).toBeCloseTo(1.25, 9);
  });

  it('stays within 3% for a clock that moves in 250 ms steps, read every 200 ms', () => {
    for (const rate of [0.75, 1, 1.25, 1.5]) {
      const measured = clockRate(readings(rate, { step: 250 }));
      expect(measured).not.toBeNull();
      expect(Math.abs(measured! / rate - 1)).toBeLessThan(0.03);
    }
  });

  it('stays within 3% wherever the clock’s steps fall against the readings', () => {
    for (const phase of [0, 25, 50, 100, 150, 200, 249]) {
      for (const rate of [0.75, 1.5]) {
        const measured = clockRate(readings(rate, { step: 250, phase }));
        expect(Math.abs(measured! / rate - 1)).toBeLessThan(0.03);
      }
    }
  });

  it('needs ten readings', () => {
    const ten = readings(1, { seconds: 1.8 });
    expect(ten).toHaveLength(10);
    expect(clockRate(ten)).toBeCloseTo(1, 10);
    expect(clockRate(ten.slice(1))).toBeNull();
    expect(clockRate([])).toBeNull();
  });

  it('needs the video to move at least a second', () => {
    expect(clockRate(readings(0.5, { seconds: 1.8 }))).toBeNull();
    expect(clockRate(readings(0.5, { seconds: 2 }))).toBeCloseTo(0.5, 10);
  });

  it('has no rate when the clock stands still for a second', () => {
    const samples = readings(1);
    // Stuck from 1.6 s to 2.6 s into the window, then on again.
    const stalled = samples.map((sample, i) => ({
      wall: sample.wall,
      media: i <= 8 ? sample.media : i <= 13 ? samples[8]!.media : sample.media - 1,
    }));
    expect(clockRate(stalled)).toBeNull();
    // Stuck for 0.8 s only: a coarse clock, not a stall.
    const held = samples.map((sample, i) => ({
      wall: sample.wall,
      media: i <= 8 ? sample.media : i <= 12 ? samples[8]!.media : sample.media - 0.8,
    }));
    expect(clockRate(held)).not.toBeNull();
  });

  it('has no rate when the clock never moves', () => {
    const still = readings(0);
    expect(clockRate(still)).toBeNull();
  });

  it('has no rate when the clock goes back, as after a seek', () => {
    const samples = readings(1);
    samples[10] = { ...samples[10]!, media: samples[9]!.media - 1 };
    expect(clockRate(samples)).toBeNull();
  });

  it('takes a reading a hair back as the same reading', () => {
    const samples = readings(1);
    samples[10] = { ...samples[10]!, media: samples[9]!.media - 0.01 };
    expect(Math.abs(clockRate(samples)! - 1)).toBeLessThan(0.05);
  });

  it('has no rate when the clock leaps ahead, as when the TV catches up late', () => {
    // webOS reads 0 at the first 'playing' after a mediaOption start, then 29.3 s.
    const samples = readings(1).map((sample, i) => (i === 0 ? { ...sample, media: 0 } : sample));
    expect(clockRate(samples)).toBeNull();
  });

  it('counts a leap as more than three times the wall clock plus a second', () => {
    // 200 ms of wall clock: a step up to 1.6 s is playback, more is a leap.
    const skip = (extra: number) =>
      readings(1).map((sample, i) =>
        i >= 10 ? { ...sample, media: sample.media + extra } : sample,
      );
    expect(clockRate(skip(1.35))).not.toBeNull();
    expect(clockRate(skip(1.45))).toBeNull();
  });

  it('gives a rate when one reading came late', () => {
    // A busy TV fires the 200 ms timer a second late; the clock moved on meanwhile.
    const samples = readings(1, { seconds: 5 }).filter((_, i) => i < 8 || i > 12);
    expect(clockRate(samples)).toBeCloseTo(1, 10);
  });

  it('has no rate for readings that are not numbers or not in order', () => {
    const notANumber = readings(1);
    notANumber[4] = { ...notANumber[4]!, media: NaN };
    expect(clockRate(notANumber)).toBeNull();
    const infinite = readings(1);
    infinite[4] = { ...infinite[4]!, wall: Infinity };
    expect(clockRate(infinite)).toBeNull();
    const repeated = readings(1);
    repeated[5] = { ...repeated[4]! };
    expect(clockRate(repeated)).toBeNull();
    expect(clockRate(readings(1).reverse())).toBeNull();
  });
});

describe('steadyBaseline', () => {
  it('takes a normal-speed clock within 8% of 1', () => {
    expect(steadyBaseline(1)).toBe(true);
    expect(steadyBaseline(0.93)).toBe(true);
    expect(steadyBaseline(1.07)).toBe(true);
    expect(steadyBaseline(0.91)).toBe(false);
    expect(steadyBaseline(1.09)).toBe(false);
    expect(steadyBaseline(null)).toBe(false);
    expect(steadyBaseline(NaN)).toBe(false);
  });

  it('takes a clock exactly 8% off, above as below', () => {
    expect(steadyBaseline(0.92)).toBe(true);
    expect(steadyBaseline(1.08)).toBe(true);
    expect(steadyBaseline(0.9199)).toBe(false);
    expect(steadyBaseline(1.0801)).toBe(false);
  });
});

describe('judgeClock', () => {
  it('passes a clock within 8% of the speed asked times the baseline', () => {
    // 1.5 × 0.98 = 1.47, so 1.3524 to 1.5876.
    expect(judgeClock(measurement({ baseline: 0.98, measured: 1.58 }))).toEqual({
      rate: 1.5,
      ok: true,
      measured: 1.58,
    });
    expect(judgeClock(measurement({ baseline: 0.98, measured: 1.36 })).ok).toBe(true);
    expect(judgeClock(measurement({ baseline: 0.98, measured: 1.6 }))).toEqual({
      rate: 1.5,
      ok: false,
      why: 'clock',
      measured: 1.6,
    });
    expect(judgeClock(measurement({ baseline: 0.98, measured: 1.35 })).ok).toBe(false);
  });

  it('passes a clock exactly 8% off, above as below, at every speed', () => {
    for (const rate of SPEED_TEST_RATES) {
      const asked = { asked: rate, reported: rate };
      expect(judgeClock(measurement({ ...asked, measured: rate * 1.08 })).ok).toBe(true);
      expect(judgeClock(measurement({ ...asked, measured: rate * 0.92 })).ok).toBe(true);
      expect(judgeClock(measurement({ ...asked, measured: rate * 1.081 })).ok).toBe(false);
      expect(judgeClock(measurement({ ...asked, measured: rate * 0.919 })).ok).toBe(false);
    }
    expect(judgeClock(measurement({ measured: 1.62 })).ok).toBe(true);
    expect(judgeClock(measurement({ measured: 1.38 })).ok).toBe(true);
  });

  it('says the clock ran at normal speed when the TV ignores the speed', () => {
    expect(judgeClock(measurement({ measured: 1 }))).toEqual({
      rate: 1.5,
      ok: false,
      why: 'clock',
      measured: 1,
    });
    expect(judgeClock(measurement({ asked: 0.75, reported: 0.75, measured: 1 })).ok).toBe(false);
  });

  it('fails a clock stuck fast back at normal speed', () => {
    const back = measurement({ asked: 1, reported: 1, measured: 1.5 });
    expect(judgeClock(back)).toEqual({ rate: 1, ok: false, why: 'clock', measured: 1.5 });
    expect(judgeClock({ ...back, measured: 1.01 }).ok).toBe(true);
  });

  it('says the TV put the speed back when the video reports another speed at the end', () => {
    expect(judgeClock(measurement({ reported: 1, measured: 1 }))).toEqual({
      rate: 1.5,
      ok: false,
      why: 'reset',
      measured: 1,
    });
  });

  it('says the TV put the speed back when it changed during the window, even if set again', () => {
    expect(judgeClock(measurement({ changes: [1, 1.5] }))).toMatchObject({
      ok: false,
      why: 'reset',
    });
  });

  it('says the TV put the speed back even without a clock rate', () => {
    expect(judgeClock(measurement({ reported: 1, measured: null }))).toMatchObject({
      ok: false,
      why: 'reset',
    });
  });

  it('ignores a speed of 0, which Shaka sets while it buffers', () => {
    expect(judgeClock(measurement({ changes: [0, 1.5, 0] })).ok).toBe(true);
    expect(judgeClock(measurement({ reported: 0 })).ok).toBe(true);
  });

  it('takes a reported speed a hair off as the speed asked', () => {
    expect(judgeClock(measurement({ reported: 1.5000001, changes: [1.4999] })).ok).toBe(true);
    // Within 0.01, above as below.
    expect(judgeClock(measurement({ reported: 1.51, changes: [1.49] })).ok).toBe(true);
    expect(judgeClock(measurement({ reported: 1.52 }))).toMatchObject({ why: 'reset' });
    expect(judgeClock(measurement({ changes: [1.48] }))).toMatchObject({ why: 'reset' });
  });

  it('settles nothing when the video waited, stalled or paused', () => {
    expect(judgeClock(measurement({ interrupted: true }))).toEqual({
      rate: 1.5,
      ok: false,
      why: 'unsteady',
    });
    // Even with a reset seen: the window is not to be trusted.
    expect(judgeClock(measurement({ interrupted: true, reported: 1 })).ok).toBe(false);
    expect(judgeClock(measurement({ interrupted: true, reported: 1 }))).toMatchObject({
      why: 'unsteady',
    });
  });

  it('settles nothing without a clock rate or a steady baseline', () => {
    const cases: Array<Partial<SpeedMeasurement>> = [
      { measured: null },
      { measured: NaN },
      { baseline: null },
      { baseline: 1.1 },
      { baseline: 0.5, measured: 0.75 },
      { asked: 0 },
      { asked: NaN },
      { asked: -1.5 },
    ];
    for (const overrides of cases) {
      expect(judgeClock(measurement(overrides))).toMatchObject({ ok: false, why: 'unsteady' });
    }
  });

  it('settles nothing for too few readings or too little video', () => {
    const few = clockRate(readings(1.5, { seconds: 1.4 }));
    expect(judgeClock(measurement({ measured: few }))).toMatchObject({ why: 'unsteady' });
    // Thirteen readings, but only 0.9 s of video.
    const short = clockRate(readings(0.75, { seconds: 1.2, every: 100 }));
    expect(judgeClock(measurement({ asked: 0.75, reported: 0.75, measured: short }))).toMatchObject(
      { why: 'unsteady' },
    );
  });

  it('judges what clockRate measured on a coarse TV clock', () => {
    const baseline = clockRate(readings(1, { step: 250 }));
    const kept = clockRate(readings(1.5, { step: 250 }));
    const ignored = clockRate(readings(1, { step: 250, phase: 100 }));
    expect(judgeClock(measurement({ baseline, measured: kept })).ok).toBe(true);
    expect(judgeClock(measurement({ baseline, measured: ignored }))).toMatchObject({
      why: 'clock',
    });
  });
});

describe('judgeSpeed', () => {
  it('passes a speed that kept time and was heard', () => {
    expect(judgeSpeed(measurement(), true)).toEqual({ rate: 1.5, ok: true, measured: 1.5 });
  });

  it('fails a speed that kept time but had no sound', () => {
    expect(judgeSpeed(measurement(), false)).toEqual({
      rate: 1.5,
      ok: false,
      why: 'sound',
      measured: 1.5,
    });
  });

  it('gives the clock’s own verdict when the speed did not keep time', () => {
    expect(judgeSpeed(measurement({ measured: 1 }), false)).toMatchObject({ why: 'clock' });
    expect(judgeSpeed(measurement({ reported: 1 }), true)).toMatchObject({ why: 'reset' });
    expect(judgeSpeed(measurement({ interrupted: true }), true)).toMatchObject({
      why: 'unsteady',
    });
  });

  it('needs the answer to be yes, not just given', () => {
    expect(judgeSpeed(measurement(), undefined as unknown as boolean)).toMatchObject({
      ok: false,
      why: 'sound',
    });
  });
});

describe('createSpeedMemory', () => {
  it('offers nothing on a TV where nothing was tested', async () => {
    const memory = await loaded();
    for (const kind of SPEED_KINDS) expect(memory.rates(kind)).toEqual([]);
    expect(memory.rates(undefined)).toEqual([]);
    expect(memory.results()).toEqual({});
  });

  it('offers the speeds that passed, slowest first and never Normal', async () => {
    const memory = await loaded();
    const kept = memory.record('hls.js', [pass(1.5), pass(1), pass(0.75), pass(1.25)]);
    expect(kept).toBe(true);
    expect(memory.rates('hls.js')).toEqual([0.75, 1.25, 1.5]);
    expect(memory.rates('native-file')).toEqual([]);
    expect(memory.results()).toEqual({ 'hls.js': { rates: [0.75, 1.25, 1.5], testedAt: 1000 } });
  });

  it('stores only kinds, numbers, a time and the firmware version', async () => {
    const storage = memoryKeyValueStore();
    const memory = await loaded(storage);
    memory.record('native-file', [pass(0.75), fail(1.25, 'clock'), pass(1.5)], '04.60.91');
    await settle();
    const stored = await storage.get('playback-speed');
    expect(stored).toEqual({
      version: 1,
      results: {
        'native-file': { rates: [0.75, 1.5], why: 'clock', testedAt: 1000, firmware: '04.60.91' },
      },
    });
    expect(JSON.stringify(stored)).not.toMatch(/http|measured/);
  });

  it('keeps a version string as the firmware, never a link or anything long', async () => {
    const memory = await loaded();
    memory.record('shaka', allPass(), '  03.34.95  ');
    expect(memory.results().shaka?.firmware).toBe('03.34.95');
    memory.record('shaka', allPass(), 'a'.repeat(40));
    expect(memory.results().shaka?.firmware).toBe('a'.repeat(40));
    for (const firmware of ['https://tv.example/fw?key=abc', 'a'.repeat(41), '', '   ']) {
      memory.record('shaka', allPass(), firmware);
      expect(memory.results().shaka).not.toHaveProperty('firmware');
    }
    memory.record('shaka', allPass(), 42 as unknown as string);
    expect(memory.results().shaka).not.toHaveProperty('firmware');
  });

  it('leaves out a speed that was not settled', async () => {
    const memory = await loaded();
    memory.record('hls.js', [pass(0.75), unsteady(1.25), pass(1.5)]);
    expect(memory.rates('hls.js')).toEqual([0.75, 1.5]);
    expect(memory.results()['hls.js']).not.toHaveProperty('why');
    memory.record('shaka', [pass(0.75), pass(1.5)]);
    expect(memory.rates('shaka')).toEqual([0.75, 1.5]);
  });

  it('keeps a run where every speed failed, with the first reason', async () => {
    const memory = await loaded();
    expect(memory.record('native-hls', [fail(0.75, 'reset'), fail(1.25, 'clock')])).toBe(true);
    expect(memory.results()['native-hls']).toEqual({ rates: [], why: 'reset', testedAt: 1000 });
    memory.record(
      'shaka',
      SPEED_TEST_RATES.map((rate) => fail(rate, 'sound')),
    );
    expect(memory.rates('shaka')).toEqual([]);
    expect(memory.results().shaka?.why).toBe('sound');
  });

  it('fails every speed when the check back at normal speed failed', async () => {
    const memory = await loaded();
    memory.record('hls.js', [...allPass(), fail(1, 'clock')]);
    expect(memory.results()['hls.js']).toEqual({ rates: [], why: 'clock', testedAt: 1000 });
    // A passed check back at normal speed changes nothing.
    memory.record('hls.js', [...allPass(), pass(1)]);
    expect(memory.rates('hls.js')).toEqual([0.75, 1.25, 1.5]);
  });

  it('passes a speed only where no stream failed it', async () => {
    const memory = await loaded();
    // MKV passed everything; MP4 stayed at normal speed at 1.5×.
    const mkv = allPass();
    const mp4 = [pass(0.75), pass(1.25), fail(1.5, 'clock')];
    memory.record('native-file', [...mkv, ...mp4]);
    expect(memory.rates('native-file')).toEqual([0.75, 1.25]);
    expect(memory.results()['native-file']?.why).toBe('clock');
    // MP4 settled nothing: MKV decides.
    memory.record('native-file', [...mkv, ...SPEED_TEST_RATES.map(unsteady)]);
    expect(memory.rates('native-file')).toEqual([0.75, 1.25, 1.5]);
  });

  it('keeps the earlier result when a run settled nothing', async () => {
    const storage = countingStorage();
    const memory = await loaded(storage);
    memory.record('hls.js', allPass());
    await settle();
    expect(storage.writes).toBe(1);
    const before = memory.results();

    expect(memory.record('hls.js', [])).toBe(false);
    expect(memory.record('hls.js', SPEED_TEST_RATES.map(unsteady))).toBe(false);
    // Only normal speed was settled: nothing about the other speeds.
    expect(memory.record('hls.js', [pass(1), unsteady(1.5)])).toBe(false);
    // Speeds the Lab does not test say nothing either.
    expect(memory.record('hls.js', [pass(2), fail(2, 'clock'), pass(1.1)])).toBe(false);

    expect(memory.results()).toBe(before);
    expect(memory.rates('hls.js')).toEqual([0.75, 1.25, 1.5]);
    await settle();
    expect(storage.writes).toBe(1);
  });

  it('ignores a kind it does not know', async () => {
    const memory = await loaded();
    expect(memory.record('dash.js' as never, allPass())).toBe(false);
    expect(memory.rates('dash.js' as never)).toEqual([]);
    expect(memory.rates('toString' as never)).toEqual([]);
    expect(memory.results()).toEqual({});
  });

  it('replaces the last run for a kind and keeps the others', async () => {
    const memory = createSpeedMemory({ storage: memoryKeyValueStore(), now: () => 2000 });
    await memory.load();
    memory.record('hls.js', allPass());
    memory.record('shaka', [pass(0.75)]);
    memory.record('hls.js', [fail(0.75, 'sound')]);
    expect(memory.results()).toEqual({
      'hls.js': { rates: [], why: 'sound', testedAt: 2000 },
      shaka: { rates: [0.75], testedAt: 2000 },
    });
  });

  it('survives a restart', async () => {
    const storage = memoryKeyValueStore();
    const first = await loaded(storage);
    first.record('native-file', allPass(), '04.60.91');
    first.record('native-hls', [fail(0.75, 'clock')]);
    await settle();

    const second = await loaded(storage);
    expect(second.rates('native-file')).toEqual([0.75, 1.25, 1.5]);
    expect(second.results()).toEqual(first.results());
  });

  it('reads a stored record, keeping only what it understands', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-speed', {
      version: 1,
      results: {
        'native-file': { rates: [1.5, 2, 1, '1.25', NaN, 0.75, 0.75], testedAt: 5 },
        'native-hls': { rates: [], why: 'reset', testedAt: 6, firmware: '04.60.91' },
        'hls.js': { rates: [1.5], why: 'tired', testedAt: 7, firmware: 'http://x/y' },
        shaka: { rates: [1.5] },
        'dash.js': { rates: [1.5], testedAt: 8 },
      },
    });
    const memory = await loaded(storage);
    expect(memory.results()).toEqual({
      'native-file': { rates: [0.75, 1.5], testedAt: 5 },
      'native-hls': { rates: [], why: 'reset', testedAt: 6, firmware: '04.60.91' },
      'hls.js': { rates: [1.5], testedAt: 7 },
    });
    expect(memory.results()['hls.js']).not.toHaveProperty('why');
    expect(memory.results()['hls.js']).not.toHaveProperty('firmware');

    // 'unsteady' settles nothing, so it is never a stored reason.
    await storage.set('playback-speed', {
      version: 1,
      results: { shaka: { rates: [], why: 'unsteady', testedAt: 9 } },
    });
    expect((await loaded(storage)).results()).toEqual({ shaka: { rates: [], testedAt: 9 } });
    expect(memory.rates('shaka')).toEqual([]);
  });

  it('ignores stored data that is not a record it knows', async () => {
    const storage = memoryKeyValueStore();
    const malformed: unknown[] = [
      null,
      'fast',
      42,
      [],
      {},
      { version: 2, results: { 'hls.js': { rates: [1.5], testedAt: 1 } } },
      { version: '1', results: { 'hls.js': { rates: [1.5], testedAt: 1 } } },
      { version: 1 },
      { version: 1, results: null },
      { version: 1, results: { 'hls.js': null } },
      { version: 1, results: { 'hls.js': { rates: 1.5, testedAt: 1 } } },
      { version: 1, results: { 'hls.js': { rates: [1.5], testedAt: '1' } } },
      { version: 1, results: { 'hls.js': { rates: [1.5], testedAt: Infinity } } },
    ];
    for (const stored of malformed) {
      await storage.set('playback-speed', stored);
      const memory = await loaded(storage);
      expect(memory.results()).toEqual({});
      expect(memory.rates('hls.js')).toEqual([]);
    }
  });

  it('adds a run recorded before loading finished to what was stored', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-speed', {
      version: 1,
      results: {
        'hls.js': { rates: [0.75], testedAt: 1 },
        shaka: { rates: [0.75], testedAt: 1 },
      },
    });
    const memory = createSpeedMemory({ storage, now: () => 1000 });
    memory.record('shaka', allPass());
    await memory.load();
    // The new run wins for its own kind; the other kind stays.
    expect(memory.rates('shaka')).toEqual([0.75, 1.25, 1.5]);
    expect(memory.rates('hls.js')).toEqual([0.75]);
    await settle();
    expect(await storage.get('playback-speed')).toEqual({
      version: 1,
      results: {
        'hls.js': { rates: [0.75], testedAt: 1 },
        shaka: { rates: [0.75, 1.25, 1.5], testedAt: 1000 },
      },
    });
  });

  it('keeps every run recorded in a row', async () => {
    const storage = memoryKeyValueStore();
    const memory = createSpeedMemory({ storage, now: () => 1000 });
    for (const kind of SPEED_KINDS) memory.record(kind, allPass());
    await settle();
    const again = await loaded(storage);
    for (const kind of SPEED_KINDS) expect(again.rates(kind)).toEqual([0.75, 1.25, 1.5]);
  });

  it('carries on in memory when storage fails', async () => {
    const rejecting: KeyValueStore = {
      get: () => Promise.reject(new Error('disk full')),
      set: () => Promise.reject(new Error('disk full')),
    };
    const throwing: KeyValueStore = {
      get: () => {
        throw new Error('no IndexedDB');
      },
      set: () => {
        throw new Error('no IndexedDB');
      },
    };
    for (const storage of [rejecting, throwing]) {
      const memory = createSpeedMemory({ storage });
      expect(memory.record('hls.js', allPass())).toBe(true);
      await memory.load();
      expect(memory.rates('hls.js')).toEqual([0.75, 1.25, 1.5]);
      expect(() => memory.record('shaka', [pass(0.75)])).not.toThrow();
      await settle();
      expect(memory.rates('shaka')).toEqual([0.75]);
    }
  });

  it('writes again after a write that failed', async () => {
    const inner = memoryKeyValueStore();
    let failures = 1;
    const storage: KeyValueStore = {
      get: inner.get,
      set(key, value) {
        if (failures-- > 0) return Promise.reject(new Error('disk full'));
        return inner.set(key, value);
      },
    };
    const memory = await loaded(storage);
    memory.record('hls.js', allPass());
    await settle();
    expect(await inner.get('playback-speed')).toBeUndefined();
    memory.record('shaka', [pass(0.75)]);
    await settle();
    expect(await inner.get('playback-speed')).toEqual({
      version: 1,
      results: {
        'hls.js': { rates: [0.75, 1.25, 1.5], testedAt: 1000 },
        shaka: { rates: [0.75], testedAt: 1000 },
      },
    });
  });

  it('is safe to load more than once', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-speed', {
      version: 1,
      results: { 'hls.js': { rates: [0.75], testedAt: 1 } },
    });
    const memory = createSpeedMemory({ storage, now: () => 1000 });
    await memory.load();
    memory.record('hls.js', allPass());
    await memory.load();
    expect(memory.rates('hls.js')).toEqual([0.75, 1.25, 1.5]);
  });

  it('gives the same results and rates until something changes', async () => {
    const memory = await loaded();
    memory.record('hls.js', allPass());
    const results = memory.results();
    const rates = memory.rates('hls.js');
    expect(memory.results()).toBe(results);
    expect(memory.rates('hls.js')).toBe(rates);
    expect(memory.rates('shaka')).toBe(memory.rates(undefined));
    memory.record('shaka', [pass(1.5)]);
    expect(memory.results()).not.toBe(results);
  });

  it('gives one frozen empty list for a kind that failed, as for one never tested', async () => {
    const storage = memoryKeyValueStore();
    const memory = await loaded(storage);
    memory.record('native-hls', [fail(0.75, 'reset')]);
    memory.record('hls.js', [...allPass(), fail(1, 'clock')]);
    const none = memory.rates(undefined);
    expect(Object.isFrozen(none)).toBe(true);
    expect(memory.rates('native-hls')).toBe(none);
    expect(memory.rates('hls.js')).toBe(none);
    await settle();
    // The same once read back from storage.
    expect((await loaded(storage)).rates('native-hls')).toBe(none);
  });

  it('tells subscribers when what is remembered changes, and only then', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-speed', {
      version: 1,
      results: { 'hls.js': { rates: [0.75], testedAt: 1 } },
    });
    const memory = createSpeedMemory({ storage, now: () => 1000 });
    let calls = 0;
    const unsubscribe = memory.subscribe(() => calls++);
    await memory.load();
    expect(calls).toBe(1);

    memory.record('shaka', allPass());
    expect(calls).toBe(2);
    memory.record('shaka', SPEED_TEST_RATES.map(unsteady));
    memory.record('dash.js' as never, allPass());
    expect(calls).toBe(2);

    unsubscribe();
    memory.record('hls.js', allPass());
    expect(calls).toBe(2);
  });

  it('does not tell subscribers when nothing was stored', async () => {
    const memory = createSpeedMemory({ storage: memoryKeyValueStore() });
    let calls = 0;
    memory.subscribe(() => calls++);
    await memory.load();
    expect(calls).toBe(0);
  });
});
