/**
 * Playback speed is offered only where Settings > Lab measured the TV
 * keeping it, for each kind of stream. These are the pure parts: which kind
 * a stream is, how fast the video's clock really ran, the verdict for one
 * speed, and what this TV passed.
 */
import type { KeyValueStore } from '../storage';
import { createStore, type Listener } from '../store';
import type { Container } from '../streams/types';

/**
 * Which player, on which kind of stream, a measured speed holds for: the
 * TV's own player on a file or on HLS, hls.js, or Shaka.
 */
export type SpeedKind = 'native-file' | 'native-hls' | 'hls.js' | 'shaka';

/** Every kind, in the order the Lab tests them and Diagnostics lists them. */
export const SPEED_KINDS: readonly SpeedKind[] = ['native-file', 'native-hls', 'hls.js', 'shaka'];

/**
 * The speeds the Lab measures, slowest first. Only these are ever offered.
 * 2× is left out: it is the speed TVs most often mute or stutter at.
 */
export const SPEED_TEST_RATES: readonly number[] = [0.75, 1.25, 1.5];

/** How far, as a share, a measured clock may be from the speed asked and still keep it. */
export const SPEED_TOLERANCE = 0.08;

/** A window needs this many clock readings to give a rate. */
export const CLOCK_MIN_SAMPLES = 10;
/** The video's clock must move at least this far in a window, in seconds. */
const CLOCK_MIN_SECONDS = 1;
/** The video's clock standing still this long, in milliseconds, is a stall or a pause. */
const STALL_MS = 1000;
/** Readings this close, in seconds, are the same reading. */
const CLOCK_JITTER = 0.05;
/**
 * A step further than this many times the wall clock, plus a second for a
 * coarse clock, is a seek or a late catch-up, not playback.
 */
const LEAP_RATE = 3;
const LEAP_SECONDS = 1;
/** A reported speed this close to the one asked is the same speed. */
const RATE_EPSILON = 0.01;
/** Room for rounding, so a reading right on a limit counts as within it, above as below. */
const ROUNDING = 1e-9;

const STORAGE_KEY = 'playback-speed';
const STORED_VERSION = 1;
const MAX_FIRMWARE_LENGTH = 40;
/** A version such as "04.60.91". Anything else, a link above all, is not kept. */
const FIRMWARE = /^[A-Za-z0-9 ._()+-]+$/;

const HLS_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];
const DASH_TYPE = 'application/dash+xml';

/**
 * The kind of a stream playing on `engine` ('native', 'hls.js' or 'shaka').
 * On the TV's own player it is HLS when the container or the type guessed
 * from the link says so, and a file otherwise, unknown container included.
 * Undefined for DASH on the TV's own player, which is never tested, and for
 * no engine or one this does not know.
 */
export function speedKindOf(
  engine: string | null | undefined,
  container?: Container,
  mime?: string,
): SpeedKind | undefined {
  if (engine === 'hls.js' || engine === 'shaka') return engine;
  if (engine !== 'native') return undefined;
  const type = typeof mime === 'string' ? (mime.split(';')[0] ?? '').trim().toLowerCase() : '';
  if (container === 'mpd' || type === DASH_TYPE) return undefined;
  if (container === 'm3u8' || HLS_TYPES.indexOf(type) >= 0) return 'native-hls';
  return 'native-file';
}

/** One reading of the video's clock against the wall clock. */
export interface ClockSample {
  /** video.currentTime, in seconds. */
  media: number;
  /** performance.now(), in milliseconds. */
  wall: number;
}

/**
 * Whether the readings show the video playing on without a break: the wall
 * clock moving forward, and the video's clock never going back, leaping
 * ahead, or standing still for a second.
 */
function unbroken(samples: readonly ClockSample[]): boolean {
  // The reading where the video's clock last moved.
  let moved = samples[0]!;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    if (!isFinite(sample.media) || !isFinite(sample.wall)) return false;
    if (i === 0) continue;
    const previous = samples[i - 1]!;
    const wallMs = sample.wall - previous.wall;
    const step = sample.media - previous.media;
    if (wallMs <= 0 || step < -CLOCK_JITTER) return false;
    if (step > (wallMs / 1000) * LEAP_RATE + LEAP_SECONDS) return false;
    if (sample.media - moved.media > CLOCK_JITTER) moved = sample;
    else if (sample.wall - moved.wall >= STALL_MS) return false;
  }
  return true;
}

/**
 * How fast the video's clock ran against the wall clock over a window of
 * readings, 1 being normal speed. It is the least-squares slope, which irons
 * out a TV clock that moves in coarse steps. Null when the window cannot
 * tell: fewer than CLOCK_MIN_SAMPLES readings, less than a second of video,
 * or a break such as a stall, a pause or a seek.
 */
export function clockRate(samples: readonly ClockSample[]): number | null {
  if (samples.length < CLOCK_MIN_SAMPLES || !unbroken(samples)) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (last.media - first.media < CLOCK_MIN_SECONDS) return null;
  // Measured from the first reading, so hours of wall clock lose no precision.
  let wallSum = 0;
  let mediaSum = 0;
  for (const sample of samples) {
    wallSum += sample.wall - first.wall;
    mediaSum += sample.media - first.media;
  }
  const wallMean = wallSum / samples.length;
  const mediaMean = mediaSum / samples.length;
  let cross = 0;
  let spread = 0;
  for (const sample of samples) {
    const wall = sample.wall - first.wall - wallMean;
    cross += wall * (sample.media - first.media - mediaMean);
    spread += wall * wall;
  }
  return spread > 0 ? (cross / spread) * 1000 : null;
}

/**
 * Why a speed was not kept: the clock ran at another speed, the TV put the
 * speed back, or the tester heard no sound.
 */
export type SpeedFailure = 'clock' | 'reset' | 'sound';

/** The verdict for one speed. 'unsteady' settles nothing: the window could not tell. */
export type SpeedVerdict =
  | { rate: number; ok: true; measured: number }
  | { rate: number; ok: false; why: SpeedFailure; measured?: number }
  | { rate: number; ok: false; why: 'unsteady' };

/** What the Lab saw while one speed played. */
export interface SpeedMeasurement {
  /** One of SPEED_TEST_RATES, or 1 for the check back at normal speed. */
  asked: number;
  /** The clock rate at normal speed on the same stream, just before, from clockRate. */
  baseline: number | null;
  /** The clock rate while `asked` was held, from clockRate. */
  measured: number | null;
  /** video.playbackRate at the end of the window. */
  reported: number;
  /** video.playbackRate at each 'ratechange' during the window. */
  changes: readonly number[];
  /** The video waited, stalled or paused during the window. */
  interrupted: boolean;
}

/** Whether a clock rate measured at normal speed is steady enough to measure others against. */
export function steadyBaseline(rate: number | null): rate is number {
  return rate !== null && isFinite(rate) && keptTime(rate, 1);
}

/** Whether a measured clock rate is within SPEED_TOLERANCE of the one expected. */
function keptTime(measured: number, expected: number): boolean {
  return Math.abs(measured - expected) <= expected * SPEED_TOLERANCE + ROUNDING;
}

/** A speed other than `asked`. 0 is not one: Shaka sets 0 while it buffers. */
function otherRate(rate: number, asked: number): boolean {
  return isFinite(rate) && rate !== 0 && Math.abs(rate - asked) > RATE_EPSILON + ROUNDING;
}

/**
 * Whether the video kept time at the speed asked, before anyone listens: the
 * TV left the speed as set, and the clock ran within SPEED_TOLERANCE of
 * `asked` times the baseline. The Lab plays the speeds that pass for the
 * sound check. A window with a wait or a pause, an unsteady baseline or no
 * clock rate is 'unsteady'.
 */
export function judgeClock(measurement: SpeedMeasurement): SpeedVerdict {
  const { asked: rate, baseline, reported, changes } = measurement;
  if (!(rate > 0) || !isFinite(rate) || measurement.interrupted || !steadyBaseline(baseline)) {
    return { rate, ok: false, why: 'unsteady' };
  }
  const measured =
    measurement.measured !== null && isFinite(measurement.measured)
      ? measurement.measured
      : undefined;
  if (otherRate(reported, rate) || changes.some((change) => otherRate(change, rate))) {
    return { rate, ok: false, why: 'reset', measured };
  }
  if (measured === undefined) return { rate, ok: false, why: 'unsteady' };
  if (!keptTime(measured, rate * baseline)) return { rate, ok: false, why: 'clock', measured };
  return { rate, ok: true, measured };
}

/**
 * The verdict for one speed: it kept time, and the tester heard sound at the
 * speeds that did. A pass needs `heard`, as nothing in the page can tell a
 * TV that mutes other speeds.
 */
export function judgeSpeed(measurement: SpeedMeasurement, heard: boolean): SpeedVerdict {
  const clock = judgeClock(measurement);
  if (!clock.ok || heard === true) return clock;
  return { rate: clock.rate, ok: false, why: 'sound', measured: clock.measured };
}

/** What the Lab settled for one kind on this TV. */
export interface SpeedResult {
  /** The speeds that passed, slowest first. Never 1: normal speed is always there. */
  rates: readonly number[];
  /** Why a speed was not kept, when one was not. */
  why?: SpeedFailure;
  /** When the Lab settled it, in milliseconds since 1970. */
  testedAt: number;
  /** The TV's firmware version then: an update can change the media pipeline. */
  firmware?: string;
}

export type SpeedResults = Readonly<Partial<Record<SpeedKind, SpeedResult>>>;

/**
 * Remembers which speeds the Lab measured this TV keeping, for each kind of
 * stream. It is kept for the whole TV, not per profile, and holds only
 * kinds, numbers, a time and the firmware version, never a link.
 */
export interface SpeedMemory {
  /** Reads what was remembered. Safe to call more than once. */
  load(): Promise<void>;
  /**
   * The speeds to offer for this kind, slowest first, Normal left out.
   * Empty when the kind is untested, failed or unknown.
   */
  rates(kind: SpeedKind | undefined): readonly number[];
  /** What the Lab last settled for each kind it tested. The same object until something changes. */
  results(): SpeedResults;
  /**
   * Keeps a Lab run for one kind in place of the last one. `verdicts` are
   * those of every speed tried, more than one per speed when the kind was
   * tried on more than one stream: a speed passes when a stream passed it
   * and none failed it. A failed check back at normal speed (rate 1) fails
   * every speed. A run that settled no speed keeps the earlier result.
   * Returns whether the run was kept.
   */
  record(kind: SpeedKind, verdicts: readonly SpeedVerdict[], firmware?: string): boolean;
  /** Called whenever what is remembered changes. */
  subscribe(listener: Listener): () => void;
}

type SettledVerdict = Exclude<SpeedVerdict, { why: 'unsteady' }>;

const NONE: readonly number[] = Object.freeze([]);

function cleanFirmware(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= MAX_FIRMWARE_LENGTH && FIRMWARE.test(text)
    ? text
    : undefined;
}

function settle(
  verdicts: readonly SpeedVerdict[],
  testedAt: number,
  firmware: unknown,
): SpeedResult | undefined {
  const tested: SettledVerdict[] = [];
  let normalFailed: SettledVerdict | undefined;
  for (const verdict of verdicts) {
    if (!verdict.ok && verdict.why === 'unsteady') continue;
    if (SPEED_TEST_RATES.indexOf(verdict.rate) >= 0) tested.push(verdict);
    else if (verdict.rate === 1 && !verdict.ok && !normalFailed) normalFailed = verdict;
  }
  if (tested.length === 0 && !normalFailed) return undefined;
  const rates = normalFailed
    ? []
    : SPEED_TEST_RATES.filter((rate) => {
        const forRate = tested.filter((verdict) => verdict.rate === rate);
        return forRate.length > 0 && forRate.every((verdict) => verdict.ok);
      });
  const result: SpeedResult = { rates, testedAt };
  const failed = normalFailed ?? tested.filter((verdict) => !verdict.ok)[0];
  if (failed && !failed.ok) result.why = failed.why;
  const version = cleanFirmware(firmware);
  if (version) result.firmware = version;
  return result;
}

function readResult(value: unknown): SpeedResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { rates, why, testedAt, firmware } = value as Record<string, unknown>;
  if (!Array.isArray(rates) || typeof testedAt !== 'number' || !isFinite(testedAt)) {
    return undefined;
  }
  const result: SpeedResult = {
    rates: SPEED_TEST_RATES.filter((rate) => rates.indexOf(rate) >= 0),
    testedAt,
  };
  if (why === 'clock' || why === 'reset' || why === 'sound') result.why = why;
  const version = cleanFirmware(firmware);
  if (version) result.firmware = version;
  return result;
}

function readStored(stored: unknown): SpeedResults | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const { version, results } = stored as Record<string, unknown>;
  if (version !== STORED_VERSION || typeof results !== 'object' || results === null) {
    return undefined;
  }
  const read: Partial<Record<SpeedKind, SpeedResult>> = {};
  let found = false;
  for (const kind of SPEED_KINDS) {
    const result = readResult((results as Record<string, unknown>)[kind]);
    if (!result) continue;
    read[kind] = result;
    found = true;
  }
  return found ? read : undefined;
}

function toStored(results: SpeedResults) {
  const stored: Partial<Record<SpeedKind, SpeedResult>> = {};
  for (const kind of SPEED_KINDS) {
    const result = results[kind];
    if (result) stored[kind] = { ...result, rates: result.rates.slice() };
  }
  return { version: STORED_VERSION, results: stored };
}

export function createSpeedMemory(options: {
  storage: KeyValueStore;
  now?: () => number;
}): SpeedMemory {
  const { storage, now = Date.now } = options;
  const state = createStore<SpeedResults>({});
  let loading: Promise<void> | undefined;
  let writing = false;
  let dirty = false;

  function load(): Promise<void> {
    if (!loading) {
      loading = Promise.resolve()
        .then(() => storage.get(STORAGE_KEY))
        .then((stored) => {
          const saved = readStored(stored);
          // A run recorded while loading is newer than the stored one.
          if (saved) state.set({ ...saved, ...state.get() });
        })
        .catch(() => undefined);
    }
    return loading;
  }

  // Writes wait for the stored copy to be merged in, or a run recorded early
  // would replace every other kind remembered from earlier launches.
  function write() {
    if (writing) {
      dirty = true;
      return;
    }
    writing = true;
    dirty = false;
    void load()
      .then(() => storage.set(STORAGE_KEY, toStored(state.get())))
      .catch(() => undefined)
      .then(() => {
        writing = false;
        if (dirty) write();
      });
  }

  return {
    load,
    rates(kind) {
      const rates = kind ? state.get()[kind]?.rates : undefined;
      return rates && rates.length > 0 ? rates : NONE;
    },
    results: state.get,
    record(kind, verdicts, firmware) {
      if (SPEED_KINDS.indexOf(kind) < 0) return false;
      const result = settle(verdicts, now(), firmware);
      if (!result) return false;
      const next: Partial<Record<SpeedKind, SpeedResult>> = { ...state.get() };
      next[kind] = result;
      state.set(next);
      write();
      return true;
    },
    subscribe: state.subscribe,
  };
}
