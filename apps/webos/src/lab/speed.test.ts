import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runSpeedTest,
  SPEED_HOLD_MS,
  SPEED_SETTLE_MS,
  SPEED_WINDOW_MS,
  type SpeedTestStep,
} from './speed';

/**
 * A video whose clock runs with the wall clock: at the speed set, or at what
 * `runsAt` makes of it, as a TV that ignores a speed would.
 */
class FakeVideo extends EventTarget {
  paused = false;
  runsAt = (rate: number) => rate;
  private base = 0;
  private since = performance.now();
  private rate = 1;
  get currentTime() {
    return this.base + ((performance.now() - this.since) / 1000) * this.runsAt(this.rate);
  }
  get playbackRate() {
    return this.rate;
  }
  set playbackRate(rate: number) {
    this.base = this.currentTime;
    this.since = performance.now();
    this.rate = rate;
    this.dispatchEvent(new Event('ratechange'));
  }
}

function setup(heard: (rate: number) => boolean = () => true) {
  const video = new FakeVideo();
  const steps: SpeedTestStep[] = [];
  const asked: number[] = [];
  const test = runSpeedTest(video as unknown as HTMLVideoElement, {
    onStep: (step) => steps.push(step),
    heard: (rate) => {
      asked.push(rate);
      return Promise.resolve(heard(rate));
    },
  });
  return { video, steps, asked, test };
}

/** Long enough for every window, and a wait for one to play on. */
async function finish() {
  await vi.advanceTimersByTimeAsync((SPEED_SETTLE_MS + SPEED_WINDOW_MS) * 6 + SPEED_HOLD_MS);
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Lab speed test', () => {
  it('passes every speed a TV keeps with sound, then checks normal speed comes back', async () => {
    const { video, steps, asked, test } = setup();
    await finish();
    const verdicts = await test.done;
    expect(verdicts.map((verdict) => [verdict.rate, verdict.ok])).toEqual([
      [0.75, true],
      [1.25, true],
      [1.5, true],
      [1, true],
    ]);
    expect(asked).toEqual([0.75, 1.25, 1.5]);
    expect(steps[0]).toEqual({ phase: 'baseline' });
    expect(steps).toContainEqual({ phase: 'listening', rate: 1.25 });
    expect(steps[steps.length - 1]).toEqual({ phase: 'normal' });
    expect(video.playbackRate).toBe(1);
  });

  it('asks about sound only at the speeds that kept time', async () => {
    const { video, asked, test } = setup((rate) => rate !== 0.75);
    // This TV plays 1.5× at normal speed.
    video.runsAt = (rate) => (rate === 1.5 ? 1 : rate);
    await finish();
    const verdicts = await test.done;
    expect(asked).toEqual([0.75, 1.25]);
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, why: 'sound' }));
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 1.25, ok: true }));
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 1.5, why: 'clock' }));
  });

  it('settles nothing when the video stops during normal speed', async () => {
    const { video, asked, test } = setup();
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + 500);
    video.dispatchEvent(new Event('waiting'));
    await finish();
    expect(await test.done).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('counts a wait while a speed takes hold, so a stall is not saved as the TV ignoring it', async () => {
    const { video, asked, test } = setup();
    // Normal speed read, then 0.75× set and taking hold.
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + SPEED_WINDOW_MS + SPEED_SETTLE_MS / 2);
    video.dispatchEvent(new Event('waiting'));
    await finish();
    const verdicts = await test.done;
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, why: 'unsteady' }));
    expect(asked).toEqual([1.25, 1.5]);
  });

  it('measures a speed again after a hitch as it took hold, once the video plays on', async () => {
    const { video, asked, test } = setup();
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + SPEED_WINDOW_MS + 100);
    video.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(150);
    video.dispatchEvent(new Event('playing'));
    await finish();
    const verdicts = await test.done;
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, ok: true }));
    expect(asked).toEqual([0.75, 1.25, 1.5]);
  });

  it('measures a speed again after a hitch just after it took hold, in the window, once the video plays on', async () => {
    const { video, asked, test } = setup();
    // Normal speed read, then 0.75× set, taken hold, and a window begun.
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + SPEED_WINDOW_MS + SPEED_SETTLE_MS + 300);
    video.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(5);
    video.dispatchEvent(new Event('playing'));
    await finish();
    const verdicts = await test.done;
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, ok: true }));
    expect(asked).toEqual([0.75, 1.25, 1.5]);
  });

  it('measures a speed again once only: a second hitch leaves it unmeasured', async () => {
    const { video, asked, test } = setup();
    const hitch = async () => {
      video.dispatchEvent(new Event('waiting'));
      await vi.advanceTimersByTimeAsync(5);
      video.dispatchEvent(new Event('playing'));
    };
    // In 0.75×'s window, then in the one it gets again.
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + SPEED_WINDOW_MS + SPEED_SETTLE_MS + 300);
    await hitch();
    await vi.advanceTimersByTimeAsync(SPEED_WINDOW_MS + SPEED_SETTLE_MS);
    await hitch();
    await finish();
    const verdicts = await test.done;
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, why: 'unsteady' }));
    expect(asked).toEqual([1.25, 1.5]);
  });

  it('measures a speed again once in all: a hitch as it took hold, then one in its window, leaves it unmeasured', async () => {
    const { video, asked, test } = setup();
    const hitch = async () => {
      video.dispatchEvent(new Event('waiting'));
      await vi.advanceTimersByTimeAsync(5);
      video.dispatchEvent(new Event('playing'));
    };
    // As 0.75× takes hold, then in the window it gets again from there.
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + SPEED_WINDOW_MS + 100);
    await hitch();
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS * 2);
    await hitch();
    await finish();
    const verdicts = await test.done;
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, why: 'unsteady' }));
    expect(asked).toEqual([1.25, 1.5]);
  });

  it('waits for a video a new speed stopped to play on, for longer than its moment to take hold', async () => {
    const { video, asked, test } = setup();
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS + SPEED_WINDOW_MS + 100);
    video.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(SPEED_SETTLE_MS * 3);
    video.dispatchEvent(new Event('playing'));
    await finish();
    const verdicts = await test.done;
    expect(verdicts).toContainEqual(expect.objectContaining({ rate: 0.75, ok: true }));
    expect(asked).toEqual([0.75, 1.25, 1.5]);
  });

  it('stops while waiting for an answer, and puts normal speed back', async () => {
    const video = new FakeVideo();
    const test = runSpeedTest(video as unknown as HTMLVideoElement, {
      onStep: () => undefined,
      heard: () => new Promise<boolean>(() => undefined),
    });
    await finish();
    expect(video.playbackRate).toBe(0.75);
    test.stop();
    expect(await test.done).toEqual([]);
    expect(video.playbackRate).toBe(1);
  });
});
