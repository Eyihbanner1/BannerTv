import type { StreamEntry } from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labStream } from '../lab/player';
import type { Engine, EngineListener, EngineTrack } from './engines/types';
import { entryKey, type StreamFinder } from './finder';
import { createPlaybackSession, START_TIMEOUT_MS, STALL_MS } from './session';

interface FakeEngine extends Engine {
  listener: EngineListener;
  audio: EngineTrack[];
  text: EngineTrack[];
}

// plays: whether load() starts the video, as the TV's player does at once.
const fake = vi.hoisted(() => ({ engines: [] as FakeEngine[], plays: false }));

vi.mock('../data/playback', () => ({
  progress: { record: () => undefined },
  sourceMemory: { record: () => undefined },
}));

// Engines that load at once and hold whatever tracks the test gives them.
vi.mock('./engines/choose', () => ({
  chooseEngine: () => Promise.resolve('hls.js'),
  fallbackEngine: () => undefined,
  createEngine: (name: Engine['name'], video: HTMLVideoElement, listener: EngineListener) => {
    const engine: FakeEngine = {
      name,
      listener,
      audio: [],
      text: [],
      load: () => {
        if (fake.plays) void video.play();
        return Promise.resolve();
      },
      audioTracks: () => engine.audio,
      selectAudio: (id) => {
        engine.audio = engine.audio.map((track) => ({ ...track, active: track.id === id }));
      },
      textTracks: () => engine.text,
      selectText: (id) => {
        engine.text = engine.text.map((track) => ({ ...track, active: track.id === id }));
      },
      destroy: () => undefined,
    };
    fake.engines.push(engine);
    return engine;
  },
}));

/** The parts of a media element the session listens to. */
class FakeVideo extends EventTarget {
  paused = true;
  currentTime = 0;
  duration = 600;

  play() {
    if (this.paused) {
      this.paused = false;
      this.fire('play');
    }
    return Promise.resolve();
  }

  pause() {
    if (!this.paused) {
      this.paused = true;
      this.fire('pause');
    }
  }

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

const first = labStream({ label: 'First', url: 'https://media.example.com/first.mkv' }, 0)!;
const second = labStream({ label: 'Second', url: 'https://media.example.com/second.mkv' }, 1)!;

function setup() {
  const video = new FakeVideo();
  const markFailed = vi.fn<(entry: StreamEntry) => void>();
  const finder = {
    next: (tried: ReadonlySet<string>) =>
      [first, second].find((entry) => !tried.has(entryKey(entry))),
    markFailed,
  } as unknown as StreamFinder;
  const session = createPlaybackSession({
    video: video as unknown as HTMLVideoElement,
    type: 'movie',
    metaId: 'tt1',
    videoId: 'tt1',
    finder,
    autoFailover: true,
  });
  return { video, session, markFailed };
}

/** Lets the engine choice and load, which are promises, run. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function lastEngine(): FakeEngine {
  return fake.engines[fake.engines.length - 1]!;
}

const track = (id: string, active = false): EngineTrack => ({ id, lang: id, label: id, active });

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  fake.engines.length = 0;
  fake.plays = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a paused stream', () => {
  it('is not failed over when the viewer paused it while it buffered', async () => {
    const { video, session, markFailed } = setup();
    session.play(first, 0);
    await settle();
    void video.play();
    video.fire('playing');
    video.fire('waiting');
    expect(session.get().status).toBe('buffering');

    session.pause();
    await vi.advanceTimersByTimeAsync(STALL_MS * 2);
    expect(markFailed).not.toHaveBeenCalled();
    expect(session.get()).toMatchObject({ status: 'paused', entry: first });

    // Played again and still starved, it moves on as before.
    session.resume();
    video.fire('waiting');
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(markFailed).toHaveBeenCalledWith(first);
    expect(session.get().entry).toBe(second);
  });

  it('is not failed over by a starved stream reporting it is waiting just after the pause', async () => {
    const { video, session, markFailed } = setup();
    session.play(first, 0);
    await settle();
    void video.play();
    video.fire('playing');

    session.pause();
    video.fire('waiting');
    await vi.advanceTimersByTimeAsync(STALL_MS * 2);
    expect(markFailed).not.toHaveBeenCalled();
    expect(session.get()).toMatchObject({ status: 'paused', entry: first });
  });

  it('does not run out its start time while the viewer has it paused', async () => {
    const { session, markFailed } = setup();
    session.play(first, 0);
    await settle();

    session.pause();
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS * 2);
    expect(markFailed).not.toHaveBeenCalled();

    session.resume();
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(markFailed).toHaveBeenCalledWith(first);
    expect(session.get().entry).toBe(second);
  });

  it('shows as paused when OK pauses it before the first picture, and starts its clock again on Play', async () => {
    fake.plays = true;
    const { video, session, markFailed } = setup();
    session.play(first, 0);
    await settle();
    expect(video.paused).toBe(false);
    expect(session.get().status).toBe('loading');

    session.togglePlay();
    expect(session.get().status).toBe('paused');
    expect(vi.getTimerCount()).toBe(0);

    session.resume();
    expect(session.get().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(markFailed).toHaveBeenCalledWith(first);
  });

  it('stays paused when the engine starts the video after the viewer paused', async () => {
    fake.plays = true;
    const { video, session } = setup();
    session.play(first, 0);
    // Hidden or paused while the engine was still being chosen.
    session.pause();
    await settle();
    expect(video.paused).toBe(true);
    expect(session.get().status).toBe('paused');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('tracks the viewer chose', () => {
  it('are chosen again when Try again opens the same stream in a new engine', async () => {
    const { session } = setup();
    session.play(first, 0);
    await settle();
    const before = lastEngine();
    before.text = [track('eng|English')];
    before.audio = [track('eng|English', true), track('fre|French')];
    before.listener.tracks();
    session.selectText('eng|English');
    session.selectAudio('fre|French');

    session.play(first, 42);
    await settle();
    const after = lastEngine();
    expect(after).not.toBe(before);
    after.text = [track('eng|English')];
    after.audio = [track('eng|English', true), track('fre|French')];
    after.listener.tracks();
    expect(session.get().text).toEqual([track('eng|English', true)]);
    expect(session.get().audio).toEqual([track('eng|English'), track('fre|French', true)]);
  });

  it('are not carried over to another stream', async () => {
    const { session } = setup();
    session.play(first, 0);
    await settle();
    lastEngine().text = [track('eng|English')];
    session.selectText('eng|English');

    session.play(second, 0);
    await settle();
    lastEngine().text = [track('eng|English')];
    lastEngine().listener.tracks();
    expect(session.get().text).toEqual([track('eng|English')]);
  });
});
