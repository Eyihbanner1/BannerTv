import {
  clockRate,
  type ClockSample,
  judgeClock,
  judgeSpeed,
  SPEED_TEST_RATES,
  type SpeedMeasurement,
  type SpeedVerdict,
  steadyBaseline,
} from '@bannertv/core';

/** How often the video's clock is read. */
export const SPEED_SAMPLE_MS = 200;
/** How long each speed is read for: a dozen readings and more than a second of video. */
export const SPEED_WINDOW_MS = 2400;
/** How long a new speed is left to take hold before its readings start. */
export const SPEED_SETTLE_MS = 600;
/** How long a video a new speed stopped is waited for to play on. */
export const SPEED_HOLD_MS = 4000;

/** What the test is doing, for the screen. */
export type SpeedTestStep =
  | { phase: 'baseline' }
  | { phase: 'measuring'; rate: number }
  | { phase: 'listening'; rate: number }
  | { phase: 'normal' };

/** Events that break a window: the clock stopped, went back or jumped. */
const BREAKS = ['waiting', 'stalled', 'pause', 'seeking', 'emptied', 'ended'] as const;

class Stopped extends Error {}

export interface SpeedTest {
  /**
   * Every verdict, the check back at normal speed (rate 1) last. Empty when
   * normal speed itself was too unsteady to measure against, or when stopped.
   */
  done: Promise<SpeedVerdict[]>;
  /** Stops it and puts normal speed back. */
  stop(): void;
}

/**
 * The Lab's speed test on the video playing now: normal speed first, as the
 * yardstick; then each test speed, read against it, and the tester asked
 * whether there is sound at each one that kept time; then normal speed again,
 * which must come back. Normal speed is put back however it ends.
 */
export function runSpeedTest(
  video: HTMLVideoElement,
  options: {
    onStep: (step: SpeedTestStep) => void;
    /** Whether the tester hears sound at `rate`, which plays while they answer. */
    heard: (rate: number) => Promise<boolean>;
  },
): SpeedTest {
  let stopped = false;
  const wakers = new Set<() => void>();

  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (stopped) return reject(new Stopped());
      const wake = () => {
        window.clearTimeout(timer);
        wakers.delete(wake);
        reject(new Stopped());
      };
      const timer = window.setTimeout(() => {
        wakers.delete(wake);
        resolve();
      }, ms);
      wakers.add(wake);
    });

  /** Reads the clock for a window at the speed set now. */
  async function measure(): Promise<Omit<SpeedMeasurement, 'asked' | 'baseline' | 'interrupted'>> {
    const samples: ClockSample[] = [];
    const changes: number[] = [];
    const onRate = () => changes.push(video.playbackRate);
    video.addEventListener('ratechange', onRate);
    try {
      const readings = Math.round(SPEED_WINDOW_MS / SPEED_SAMPLE_MS) + 1;
      for (let i = 0; i < readings; i++) {
        if (i > 0) await wait(SPEED_SAMPLE_MS);
        samples.push({ media: video.currentTime, wall: performance.now() });
      }
    } finally {
      video.removeEventListener('ratechange', onRate);
    }
    return { measured: clockRate(samples), reported: video.playbackRate, changes };
  }

  /**
   * Sets `rate`, gives it a moment to take hold, then reads a window. A wait
   * while it takes hold breaks the window as much as one during it, unless
   * the video plays on within a few seconds: a TV that hitches at each new
   * speed gets the moment again from there, once.
   */
  async function at(rate: number): Promise<Omit<SpeedMeasurement, 'asked' | 'baseline'>> {
    let interrupted = false;
    let held = false;
    const onBreak = () => {
      interrupted = true;
      held = true;
    };
    const onPlaying = () => {
      held = false;
    };
    BREAKS.forEach((type) => video.addEventListener(type, onBreak));
    video.addEventListener('playing', onPlaying);
    try {
      video.playbackRate = rate;
      await wait(SPEED_SETTLE_MS);
      for (let waited = 0; held && waited < SPEED_HOLD_MS; waited += SPEED_SAMPLE_MS) {
        await wait(SPEED_SAMPLE_MS);
      }
      if (interrupted && !held && !video.paused) {
        interrupted = false;
        await wait(SPEED_SETTLE_MS);
      }
      const window = await measure();
      return { ...window, interrupted: interrupted || video.paused };
    } finally {
      BREAKS.forEach((type) => video.removeEventListener(type, onBreak));
      video.removeEventListener('playing', onPlaying);
    }
  }

  async function run(): Promise<SpeedVerdict[]> {
    options.onStep({ phase: 'baseline' });
    const normal = await at(1);
    // A wait or a pause leaves nothing to measure the others against.
    const baseline = normal.interrupted ? null : normal.measured;
    if (!steadyBaseline(baseline)) return [];
    const verdicts: SpeedVerdict[] = [];
    for (const rate of SPEED_TEST_RATES) {
      options.onStep({ phase: 'measuring', rate });
      const measurement: SpeedMeasurement = { asked: rate, baseline, ...(await at(rate)) };
      const clock = judgeClock(measurement);
      if (!clock.ok) {
        verdicts.push(clock);
        continue;
      }
      options.onStep({ phase: 'listening', rate });
      verdicts.push(judgeSpeed(measurement, await answer(rate)));
    }
    options.onStep({ phase: 'normal' });
    verdicts.push(judgeClock({ asked: 1, baseline, ...(await at(1)) }));
    return verdicts;
  }

  // The tester's answer, unless the test is stopped first: a question nobody answers does not hold it.
  function answer(rate: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (stopped) return reject(new Stopped());
      const wake = () => reject(new Stopped());
      wakers.add(wake);
      options
        .heard(rate)
        .then(resolve, reject)
        .then(() => wakers.delete(wake));
    });
  }

  const done = run()
    .catch((error: unknown) => {
      if (error instanceof Stopped) return [];
      throw error;
    })
    .finally(() => {
      video.playbackRate = 1;
    });

  return {
    done,
    stop() {
      stopped = true;
      wakers.forEach((wake) => wake());
      wakers.clear();
    },
  };
}
