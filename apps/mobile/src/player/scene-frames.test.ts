import { describe, expect, it, vi } from 'vitest';
import { createFrameSource, FRAME_LIMIT, FRAME_STEP_S, frameSlot } from './scene-frames';

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
