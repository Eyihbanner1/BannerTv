import { describe, expect, it, vi } from 'vitest';
import { AHEAD_S, createFrameSource, FRAME_LIMIT, FRAME_STEP_S, frameSlot } from './scene-frames';

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A grabber whose answers the test hands out, one by one. */
function manualGrab() {
  const pending: { at: number; resolve: (frame: string) => void; reject: () => void }[] = [];
  const grab = vi.fn(
    (at: number) =>
      new Promise<string>((resolve, reject) =>
        pending.push({ at, resolve, reject: () => reject(new Error('no frame')) }),
      ),
  );
  return { grab, pending };
}

describe('frameSlot', () => {
  it('rounds to the grid, never below zero', () => {
    expect(frameSlot(12)).toBe(10);
    expect(frameSlot(13)).toBe(15);
    expect(frameSlot(-4)).toBe(0);
  });
});

describe('createFrameSource', () => {
  it('asks nothing before a stream plays', () => {
    const { grab } = manualGrab();
    const frames = createFrameSource(grab);
    frames.want(60);
    expect(grab).not.toHaveBeenCalled();
  });

  it('takes the frame for a place and gives it back', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.want(61);
    expect(grab).toHaveBeenCalledWith(60);
    pending[0]!.resolve('f60');
    await flush();
    expect(frames.near(61)).toEqual({ frame: 'f60', at: 60 });
    frames.want(59);
    expect(grab).toHaveBeenCalledTimes(1);
  });

  it('asks one at a time, the newest wish next, skipping places only passed', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.want(100);
    frames.want(120);
    frames.want(140);
    frames.want(160);
    expect(grab.mock.calls.map(([at]) => at)).toEqual([100]);
    pending[0]!.resolve('f100');
    await flush();
    expect(grab.mock.calls.map(([at]) => at)).toEqual([100, 160]);
  });

  it('shows the nearest frame taken while the right one comes', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.want(100);
    pending[0]!.resolve('f100');
    await flush();
    expect(frames.near(120)).toEqual({ frame: 'f100', at: 100 });
    expect(frames.near(200)).toBeUndefined();
  });

  it('stops asking after failures in a row', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('hls');
    frames.want(10);
    pending[0]!.reject();
    await flush();
    expect(frames.works()).toBe(true);
    frames.want(20);
    pending[1]!.reject();
    await flush();
    expect(frames.works()).toBe(false);
    frames.want(30);
    expect(grab).toHaveBeenCalledTimes(2);
  });

  it('starts over for another stream, dropping what the last one sent late', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.want(10);
    frames.reset('b');
    pending[0]!.resolve('old');
    await flush();
    expect(frames.near(10)).toBeUndefined();
    frames.want(10);
    expect(grab).toHaveBeenCalledTimes(2);
  });

  it('keeps a limited number of frames, dropping the least used', async () => {
    const grab = vi.fn((at: number) => Promise.resolve(`f${at}`));
    const frames = createFrameSource(grab);
    frames.reset('a');
    for (let i = 0; i <= FRAME_LIMIT; i++) {
      frames.want(i * FRAME_STEP_S);
      await flush();
    }
    expect(frames.near(0)?.at).not.toBe(0);
    expect(frames.near(FRAME_LIMIT * FRAME_STEP_S)?.frame).toBe(`f${FRAME_LIMIT * FRAME_STEP_S}`);
  });

  it('takes frames either side ahead of a swipe, nearest first, one at a time', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.ahead(1164, 3489);
    expect(grab.mock.calls.map(([at]) => at)).toEqual([1180]);
    for (let i = 0; i < AHEAD_S.length; i++) {
      pending[i]!.resolve(`f${pending[i]!.at}`);
      await flush();
    }
    expect(grab.mock.calls.map(([at]) => at)).toEqual([1180, 1150, 1210, 1120, 1240, 1090]);
    // No gap from 100 s back to 100 s on.
    for (let at = 1164 - 100; at <= 1164 + 100; at += 1) expect(frames.near(at)).toBeDefined();
  });

  it('puts a wish before the frames ahead', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.ahead(600, 3000);
    frames.want(900);
    pending[0]!.resolve('f615');
    await flush();
    expect(grab.mock.calls.map(([at]) => at)).toEqual([615, 900]);
    pending[1]!.resolve('f900');
    await flush();
    expect(grab.mock.calls.map(([at]) => at)).toEqual([615, 900, 585]);
  });

  it('keeps the frames ahead inside the file, and skips those already taken', async () => {
    const grab = vi.fn((at: number) => Promise.resolve(`f${at}`));
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.ahead(20, 100);
    await flush();
    // 20 - 45 and 20 - 75 are both the start; the last second is 99, so 95 is the end.
    expect(grab.mock.calls.map(([at]) => at)).toEqual([35, 5, 65, 0, 95]);
    frames.ahead(30, 100);
    await flush();
    expect(grab.mock.calls.map(([at]) => at)).toEqual([35, 5, 65, 0, 95, 45, 15, 75]);
  });

  it('lets another call replace what is left of the last, and a new stream drop it', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.reset('a');
    frames.ahead(600, 3000);
    frames.ahead(1200, 3000);
    pending[0]!.resolve('f615');
    await flush();
    expect(grab.mock.calls.map(([at]) => at)).toEqual([615, 1215]);
    frames.reset('b');
    pending[1]!.resolve('old');
    await flush();
    expect(grab).toHaveBeenCalledTimes(2);
  });

  it('takes nothing ahead before a stream plays or once it gives no frames', async () => {
    const { grab, pending } = manualGrab();
    const frames = createFrameSource(grab);
    frames.ahead(600, 3000);
    expect(grab).not.toHaveBeenCalled();
    frames.reset('hls');
    frames.want(10);
    pending[0]!.reject();
    await flush();
    frames.want(20);
    pending[1]!.reject();
    await flush();
    frames.ahead(600, 3000);
    expect(grab).toHaveBeenCalledTimes(2);
  });

  it('tells listeners when a frame comes', async () => {
    const grab = vi.fn(() => Promise.resolve('f'));
    const frames = createFrameSource(grab);
    const listener = vi.fn();
    frames.subscribe(listener);
    frames.reset('a');
    const before = frames.version();
    frames.want(5);
    await flush();
    expect(frames.version()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
  });
});
