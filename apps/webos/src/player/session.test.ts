import type { LiveWindow, Resolution, StreamEntry } from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labStream } from '../lab/player';
import { type Engine, type EngineListener, type EngineTrack, PlaybackError } from './engines/types';
import { entryKey, type StreamFinder } from './finder';
import {
  LIVE_TICK_MS,
  createPlaybackSession,
  REBUFFER_WINDOW_MS,
  SMOOTH_AFTER_S,
  START_TIMEOUT_MS,
  STALL_MS,
} from './session';

interface FakeEngine extends Engine {
  listener: EngineListener;
  audio: EngineTrack[];
  text: EngineTrack[];
  /** Where load() was asked to start, in seconds. */
  startAt?: number;
  /** Whether the engine says the stream is live. */
  live?: boolean;
  /** What the broadcast keeps, as the engine reads it. */
  window?: LiveWindow;
  /** How often the session told it the viewer moved the clock. */
  seeks: number;
}

// plays: whether load() starts the video, as the TV's player does at once.
// fallback: the engine that takes over, once, from one that refuses a stream.
const fake = vi.hoisted(() => ({
  engines: [] as FakeEngine[],
  plays: false,
  fallback: undefined as Engine['name'] | undefined,
}));

// What the session keeps: where playback was, which addons worked, and how much data plays smoothly.
const kept = vi.hoisted(() => ({
  progress: vi.fn(),
  cleared: vi.fn(),
  sourceMemory: vi.fn(),
  bandwidth: {
    maxBitrate: () => 40e6,
    struggled: vi.fn<(bitrate: number, ceiling?: number) => void>(),
    smooth: vi.fn<(bitrate: number) => void>(),
    subscribe: () => () => undefined,
  },
}));

vi.mock('../data/playback', () => ({
  progress: { record: kept.progress, clear: kept.cleared },
  sourceMemory: { record: kept.sourceMemory },
  bandwidth: kept.bandwidth,
}));

// Engines that load at once and hold whatever tracks the test gives them.
vi.mock('./engines/choose', () => ({
  chooseEngine: () => Promise.resolve('hls.js'),
  fallbackEngine: (_name: Engine['name'], _url: string, tried: ReadonlySet<Engine['name']>) =>
    fake.fallback && !tried.has(fake.fallback) ? fake.fallback : undefined,
  createEngine: (name: Engine['name'], video: HTMLVideoElement, listener: EngineListener) => {
    const engine: FakeEngine = {
      name,
      listener,
      audio: [],
      text: [],
      seeks: 0,
      seeked: () => {
        engine.seeks++;
      },
      load: (_url, startAt) => {
        engine.startAt = startAt;
        if (fake.plays) void video.play();
        return Promise.resolve();
      },
      isLive: () => engine.live === true,
      liveWindow: () => (engine.live ? (engine.window ?? null) : null),
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
  playbackRate = 1;
  // A two-hour film, so the bitrates below follow from the sizes.
  duration = 7200;

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

/** A stream with the size and resolution an addon would give, so its bitrate is known. */
function sized(file: string, rank: number, gigabytes: number, resolution: Resolution): StreamEntry {
  const entry = labStream({ label: file, url: `https://media.example.com/${file}.mkv` }, rank)!;
  return { ...entry, facts: { ...entry.facts, sizeBytes: gigabytes * 1e9, resolution } };
}

// Over two hours: 80, 50, 30 and about 17 Mbit/s.
const remux = sized('remux', 2, 72, '2160p');
const web4k = sized('web4k', 3, 45, '2160p');
const bluray = sized('bluray', 4, 27, '1080p');
const web = sized('web', 5, 15, '1080p');

interface SetupOptions {
  /** What finder.lighter() offers, best first. Nothing lighter by default. */
  lighter?: StreamEntry[];
  autoFailover?: boolean;
  remember?: boolean;
  continueRow?: boolean;
  /** The running time the title's page gives, in seconds. None by default. */
  runtime?: number;
  /** A film, tt1, by default. */
  type?: string;
  videoId?: string;
}

function setup(options: SetupOptions = {}) {
  const video = new FakeVideo();
  const markFailed = vi.fn<(entry: StreamEntry) => void>();
  const offered = options.lighter ?? [];
  const lighter = vi.fn((_current: StreamEntry, tried: ReadonlySet<string>) =>
    offered.find((entry) => !tried.has(entryKey(entry))),
  );
  const finder = {
    next: (tried: ReadonlySet<string>) =>
      [first, second].find((entry) => !tried.has(entryKey(entry))),
    markFailed,
    lighter,
    runtimeSeconds: () => options.runtime ?? 7200,
    knownRuntimeSeconds: () => options.runtime,
  } as unknown as StreamFinder;
  const session = createPlaybackSession({
    video: video as unknown as HTMLVideoElement,
    type: options.type ?? 'movie',
    metaId: 'tt1',
    videoId: options.videoId ?? 'tt1',
    finder,
    autoFailover: options.autoFailover ?? true,
    remember: options.remember,
    continueRow: options.continueRow,
  });
  return { video, session, markFailed, lighter };
}

/** Lets the engine choice and load, which are promises, run. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function lastEngine(): FakeEngine {
  return fake.engines[fake.engines.length - 1]!;
}

const track = (id: string, active = false): EngineTrack => ({ id, lang: id, label: id, active });

type Session = ReturnType<typeof createPlaybackSession>;

/** Opens `entry` at `at` seconds and gets it to its first picture. */
async function start(
  session: Session,
  video: FakeVideo,
  entry: StreamEntry,
  at = 0,
  options?: { chosen?: boolean; handPicked?: boolean },
) {
  session.play(entry, at, options);
  await settle();
  void video.play();
  video.fire('playing');
  if (at > 0) {
    video.currentTime = at;
    video.fire('timeupdate');
  }
}

/** Plays on for `seconds` without buffering, the clock and the picture moving together. */
function playFor(video: FakeVideo, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    vi.advanceTimersByTime(1000);
    video.currentTime += 1;
    video.fire('timeupdate');
  }
}

/** Stops to buffer and is still waiting `ms` later. */
function wait(video: FakeVideo, ms: number) {
  video.fire('waiting');
  vi.advanceTimersByTime(ms);
}

/** Stops to buffer for `ms`, then plays on. */
function rebuffer(video: FakeVideo, ms: number) {
  wait(video, ms);
  video.fire('playing');
}

/**
 * Three waits of a second and a half within half a minute: more than the
 * connection gives. The third is still going on, as the session judges it a
 * second in.
 */
function struggle(video: FakeVideo) {
  for (let i = 0; i < 3; i++) {
    playFor(video, 10);
    if (i < 2) rebuffer(video, 1500);
    else wait(video, 1500);
  }
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  fake.engines.length = 0;
  fake.plays = false;
  fake.fallback = undefined;
  kept.progress.mockClear();
  kept.cleared.mockClear();
  kept.sourceMemory.mockClear();
  kept.bandwidth.struggled.mockClear();
  kept.bandwidth.smooth.mockClear();
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

  it('opens paused when it replaces one the viewer had paused, and starts its clock on Play', async () => {
    fake.plays = true;
    const { video, session, markFailed } = setup();
    session.play(first, 0);
    await settle();
    void video.play();
    video.fire('playing');
    session.pause();

    // Quality on the paused film: the other stream opens paused, with no start clock.
    session.play(second, 12, { chosen: true, paused: true });
    await settle();
    expect(video.paused).toBe(true);
    expect(session.get()).toMatchObject({ status: 'paused', entry: second });
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS * 2);
    expect(markFailed).not.toHaveBeenCalled();

    session.resume();
    expect(session.get().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(markFailed).toHaveBeenCalledWith(second);
  });

  it('stays paused on the stream that takes over when the one opened paused fails', async () => {
    fake.plays = true;
    const { video, session } = setup();
    session.play(first, 12, { chosen: true, paused: true });
    await settle();
    expect(session.get().status).toBe('paused');

    lastEngine().listener.fatal(new PlaybackError('network', 'The link has expired'));
    await settle();
    expect(session.get()).toMatchObject({ status: 'paused', entry: second, failedOver: true });
    expect(video.paused).toBe(true);
    expect(lastEngine().startAt).toBe(12);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('carries a place picked on a stream opened paused to the next one, and tells the engine', async () => {
    fake.plays = true;
    const { session } = setup();
    session.play(first, 2400, { chosen: true, paused: true });
    await settle();

    // Start over before the first picture, with the film's length known.
    session.seek(0);
    expect(lastEngine().seeks).toBe(1);
    expect(session.carryOn()).toBe(0);
  });

  it('opens a fallback engine where the viewer moved a stream opened paused', async () => {
    fake.plays = true;
    fake.fallback = 'native';
    const { video, session } = setup();
    session.play(first, 2400, { chosen: true, paused: true });
    await settle();
    session.seek(2430);

    lastEngine().listener.fatal(new PlaybackError('format', 'hls.js cannot play this'));
    await settle();
    expect(lastEngine()).toMatchObject({ name: 'native', startAt: 2430 });
    expect(session.get()).toMatchObject({ status: 'paused', entry: first });

    // The element the first engine let go of reads 0 for a moment: that is not a place.
    video.currentTime = 0;
    video.fire('timeupdate');
    expect(session.carryOn()).toBe(2430);
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

describe("cues of the stream's own subtitles", () => {
  const cue = (start: number, end: number, text: string) => ({
    start,
    end,
    lines: [[{ text }]],
  });

  it('are added to as hls.js and Shaka hand them over, each once', async () => {
    const { session } = setup();
    session.play(first, 0);
    await settle();
    const { listener } = lastEngine();
    listener.cues('eng', [cue(1, 2, 'One'), cue(3, 4, 'Two')]);
    // Sent again after an audio switch, with one more.
    listener.cues('eng', [cue(3, 4, 'Two'), cue(5, 6, 'Three')]);
    expect(session.get().streamCues.eng).toEqual([
      cue(1, 2, 'One'),
      cue(3, 4, 'Two'),
      cue(5, 6, 'Three'),
    ]);
  });

  it("are replaced whole when the engine says so, as Android's are when a line closes", async () => {
    const { session } = setup();
    session.play(first, 0);
    await settle();
    const { listener } = lastEngine();
    listener.cues('2:0', [cue(1, Infinity, 'Hello')], true);
    expect(session.get().streamCues['2:0']).toEqual([cue(1, Infinity, 'Hello')]);
    listener.cues('2:0', [cue(1, 3, 'Hello')], true);
    expect(session.get().streamCues['2:0']).toEqual([cue(1, 3, 'Hello')]);
    // Another track's are left as they are, and an empty list clears the track.
    listener.cues('2:1', [cue(2, Infinity, 'Bonjour')], true);
    listener.cues('2:0', [], true);
    expect(session.get().streamCues).toEqual({ '2:0': [], '2:1': [cue(2, Infinity, 'Bonjour')] });
  });

  it('from a stream played before are dropped', async () => {
    const { session } = setup();
    session.play(first, 0);
    await settle();
    const before = lastEngine();
    before.listener.cues('2:0', [cue(1, Infinity, 'Old')], true);
    session.play(second, 0);
    await settle();
    before.listener.cues('2:0', [cue(1, Infinity, 'Old, late')], true);
    expect(session.get().streamCues).toEqual({});
  });
});

describe('a stream that keeps buffering', () => {
  it('steps down to a lighter stream at the same place after three long waits', async () => {
    const { video, session, lighter } = setup({ lighter: [bluray, web] });
    await start(session, video, remux);
    playFor(video, 300);
    rebuffer(video, 1500);
    playFor(video, 20);
    rebuffer(video, 1500);
    playFor(video, 20);
    expect(session.get().entry).toBe(remux);

    // The third is judged a second in, without waiting for it to end.
    wait(video, 999);
    expect(session.get().entry).toBe(remux);
    vi.advanceTimersByTime(1);
    // With what plays, so the step down keeps to its language and length.
    expect(lighter).toHaveBeenCalledWith(
      remux,
      expect.anything(),
      expect.objectContaining({ entry: remux }),
    );
    expect(session.get()).toMatchObject({ entry: bluray, position: 340, steppedDown: true });
    expect(kept.bandwidth.struggled).toHaveBeenCalledWith(80e6, undefined);
    await settle();
    expect(lastEngine().startAt).toBe(340);

    video.fire('playing');
    expect(session.get()).toMatchObject({ status: 'playing', entry: bluray, steppedDown: false });
  });

  it('steps down after fifteen seconds of waiting in all, in fewer stops', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    rebuffer(video, 7000);
    playFor(video, 30);
    expect(session.get().entry).toBe(remux);

    wait(video, 7999);
    expect(session.get().entry).toBe(remux);
    vi.advanceTimersByTime(1);
    expect(session.get()).toMatchObject({ entry: bluray, position: 90, steppedDown: true });
  });

  it('steps down during one wait of fifteen seconds, before it counts as a dead link', async () => {
    const { video, session, markFailed } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    wait(video, 14999);
    expect(session.get()).toMatchObject({ entry: remux, status: 'buffering' });
    vi.advanceTimersByTime(1);
    expect(session.get()).toMatchObject({ entry: bluray, position: 60, steppedDown: true });
    expect(kept.bandwidth.struggled).toHaveBeenCalledWith(80e6, undefined);
    // The remux played, so it is not marked as broken.
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('does not count the buffering a jump causes in a wait already going on', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    rebuffer(video, 1500);
    playFor(video, 10);
    wait(video, 500);
    session.seek(1800);
    // The jump's own loading, however long, is the jump's.
    vi.advanceTimersByTime(14000);
    video.fire('playing');
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false });
  });

  it('does not count waits shorter than a second', async () => {
    const { video, session, lighter } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    for (let i = 0; i < 5; i++) {
      playFor(video, 10);
      rebuffer(video, 900);
    }
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false, struggling: false });
    expect(lighter).not.toHaveBeenCalled();
    expect(kept.bandwidth.struggled).not.toHaveBeenCalled();
  });

  it.each([
    ['the viewer jumps', (session: Session) => session.seek(1800)],
    ['the video seeks', (_session: Session, video: FakeVideo) => video.fire('seeking')],
  ])('does not count waits just after %s', async (_name, jump) => {
    const { video, session } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    jump(session, video);
    // All three begin within ten seconds of the jump.
    rebuffer(video, 3000);
    playFor(video, 2);
    rebuffer(video, 2000);
    playFor(video, 1);
    rebuffer(video, 1500);
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false });

    // Once the jump is well behind, waiting counts again.
    struggle(video);
    expect(session.get()).toMatchObject({ entry: bluray, steppedDown: true });
  });

  it('forgets waits more than two minutes old', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    rebuffer(video, 1500);
    playFor(video, 10);
    rebuffer(video, 1500);
    playFor(video, REBUFFER_WINDOW_MS / 1000);
    rebuffer(video, 1500);
    playFor(video, 10);
    rebuffer(video, 1500);
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false });

    // Three within two minutes again.
    playFor(video, 10);
    wait(video, 1500);
    expect(session.get()).toMatchObject({ entry: bluray, steppedDown: true });
  });

  it('keeps a stream the viewer chose, and says it is struggling', async () => {
    const { video, session, lighter } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60, { chosen: true });
    struggle(video);
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false, struggling: true });
    expect(lighter).not.toHaveBeenCalled();
    // The limit is still lowered, so auto-play picks a lighter stream next time.
    expect(kept.bandwidth.struggled).toHaveBeenCalledWith(80e6, undefined);
  });

  it('keeps a stream when it may not move on by itself', async () => {
    const { video, session, lighter } = setup({ lighter: [bluray], autoFailover: false });
    await start(session, video, remux, 60);
    struggle(video);
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false, struggling: true });
    expect(lighter).not.toHaveBeenCalled();
  });

  it('says it is struggling when nothing lighter is left, until another stream plays', async () => {
    const { video, session, lighter } = setup();
    await start(session, video, remux, 60);
    struggle(video);
    expect(lighter).toHaveBeenCalled();
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false, struggling: true });

    session.play(web, 120);
    expect(session.get().struggling).toBe(false);
  });

  it('steps down at most twice', async () => {
    const { video, session, lighter } = setup({ lighter: [web4k, bluray, web] });
    await start(session, video, remux, 60);
    struggle(video);
    expect(session.get().entry).toBe(web4k);
    await settle();
    video.fire('playing');

    struggle(video);
    expect(session.get().entry).toBe(bluray);
    await settle();
    video.fire('playing');

    struggle(video);
    expect(session.get()).toMatchObject({ entry: bluray, steppedDown: false, struggling: true });
    expect(lighter).toHaveBeenCalledTimes(2);
    expect(kept.bandwidth.struggled.mock.calls).toEqual([
      [80e6, undefined],
      [50e6, undefined],
      [30e6, undefined],
    ]);
  });

  it('works the bitrate out from the title running time while the video length is unknown', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    video.duration = NaN;
    await start(session, video, remux, 60);
    struggle(video);
    expect(kept.bandwidth.struggled).toHaveBeenCalledWith(80e6, undefined);
  });

  it('is not judged when the viewer pauses while it waits', async () => {
    const { video, session, lighter } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    rebuffer(video, 1500);
    playFor(video, 10);
    rebuffer(video, 1500);
    playFor(video, 10);
    // Paused before the third wait has gone on long enough to count.
    wait(video, 500);
    session.pause();
    expect(session.get()).toMatchObject({ status: 'paused', entry: remux, steppedDown: false });

    vi.advanceTimersByTime(60000);
    session.resume();
    video.fire('playing');
    expect(session.get()).toMatchObject({ status: 'playing', entry: remux, steppedDown: false });
    expect(lighter).not.toHaveBeenCalled();
  });

  it('does not count the time paused while it waits', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    video.fire('waiting');
    vi.advanceTimersByTime(5000);
    session.pause();
    vi.advanceTimersByTime(60000);
    session.resume();
    video.fire('playing');
    playFor(video, 10);

    // Fourteen seconds of waiting in two stops: not yet too much.
    rebuffer(video, 9000);
    expect(session.get()).toMatchObject({ entry: remux, steppedDown: false });
  });
});

describe('a stream that plays smoothly', () => {
  it('tells the bandwidth memory after ten minutes without waiting', async () => {
    const { video, session } = setup();
    await start(session, video, bluray, 60);
    playFor(video, SMOOTH_AFTER_S - 1);
    expect(kept.bandwidth.smooth).not.toHaveBeenCalled();

    playFor(video, 1);
    expect(kept.bandwidth.smooth).toHaveBeenCalledWith(30e6);
    playFor(video, SMOOTH_AFTER_S);
    expect(kept.bandwidth.smooth).toHaveBeenCalledTimes(1);
  });

  it('counts the ten minutes again after a wait', async () => {
    const { video, session } = setup();
    await start(session, video, bluray, 60);
    playFor(video, 400);
    rebuffer(video, 500);
    playFor(video, 400);
    expect(kept.bandwidth.smooth).not.toHaveBeenCalled();

    playFor(video, 200);
    expect(kept.bandwidth.smooth).toHaveBeenCalledWith(30e6);
  });

  it('says nothing good about a stream that already struggled', async () => {
    const { video, session } = setup();
    await start(session, video, remux, 60, { chosen: true });
    struggle(video);
    video.fire('playing');
    playFor(video, SMOOTH_AFTER_S + 60);
    expect(kept.bandwidth.smooth).not.toHaveBeenCalled();
  });

  it('undoes its raise when it later keeps buffering', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    await start(session, video, remux, 60);
    playFor(video, SMOOTH_AFTER_S);
    expect(kept.bandwidth.smooth).toHaveBeenCalledWith(80e6);
    struggle(video);
    // The limit before the raise, from the memory.
    expect(kept.bandwidth.struggled).toHaveBeenCalledWith(80e6, 40e6);
  });

  it('takes the lower bitrate when the video is longer than the title says', async () => {
    const { video, session } = setup();
    // Four hours of video, where the title says two (extras, or a wrong running time).
    video.duration = 14400;
    await start(session, video, remux, 60);
    playFor(video, SMOOTH_AFTER_S);
    expect(kept.bandwidth.smooth).toHaveBeenCalledWith(40e6);
  });
});

describe('a stream far shorter than the title', () => {
  /** Opens `entry` at `at` seconds as a file `seconds` long, which the engine has just read. */
  async function open(
    session: Session,
    video: FakeVideo,
    entry: StreamEntry,
    seconds: number,
    at = 0,
    options?: { chosen?: boolean; handPicked?: boolean },
  ) {
    session.play(entry, at, options);
    await settle();
    video.duration = seconds;
    video.fire('durationchange');
  }

  it('is moved on from at the same place, as a stream that failed, and keeps nothing', async () => {
    const { video, session, markFailed } = setup({ runtime: 2700 });
    await open(session, video, first, 30, 600);
    expect(markFailed).toHaveBeenCalledWith(first);
    expect(session.get().entry).toBe(second);
    expect(session.get().failedOver).toBe(true);
    await settle();
    expect(lastEngine().startAt).toBe(600);
    expect(kept.progress).not.toHaveBeenCalled();
    expect(kept.sourceMemory).toHaveBeenCalledWith(first.addonId, false);

    // The next one, the episode's length, plays and keeps its place.
    video.duration = 2640;
    video.fire('durationchange');
    void video.play();
    video.fire('playing');
    video.currentTime = 600;
    video.fire('timeupdate');
    playFor(video, 30);
    session.saveProgress();
    expect(session.get().entry).toBe(second);
    expect(kept.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 630, duration: 2640 }),
    );
  });

  it('is found at its first picture when its length came before the engine could tell', async () => {
    const { video, session, markFailed } = setup({ runtime: 2700 });
    session.play(first, 600);
    await settle();
    video.duration = 30;
    void video.play();
    video.fire('playing');
    expect(markFailed).toHaveBeenCalledWith(first);
    expect(session.get().entry).toBe(second);
    await settle();
    expect(lastEngine().startAt).toBe(600);
    expect(session.get().status).toBe('loading');
  });

  it('says so once no other stream is left', async () => {
    const { video, session } = setup({ runtime: 2700 });
    await open(session, video, first, 30);
    await settle();
    expect(session.get().entry).toBe(second);
    video.duration = 45;
    video.fire('durationchange');
    expect(session.get().status).toBe('failed');
    expect(session.get().error?.kind).toBe('clip');
    void video.play();
    video.fire('playing');
    expect(session.get().status).toBe('failed');
    expect(kept.progress).not.toHaveBeenCalled();
  });

  it('plays when the viewer picked it, never keeps its place, and says it was only a clip at its end', async () => {
    for (const options of [{ handPicked: true }, undefined]) {
      kept.progress.mockClear();
      const { video, session, markFailed } = setup({
        runtime: 2700,
        autoFailover: options !== undefined,
      });
      await open(session, video, first, 30, 0, options);
      void video.play();
      video.fire('playing');
      playFor(video, 20);
      session.saveProgress();
      expect(session.get().status).toBe('playing');
      expect(session.get().clip).toBe(true);
      expect(markFailed).not.toHaveBeenCalled();
      // Its end is not the video's: no end, no next stream, nothing kept.
      video.fire('ended');
      expect(session.get().entry).toBe(first);
      expect(session.get().status).toBe('failed');
      expect(session.get().error?.kind).toBe('clip');
      expect(markFailed).toHaveBeenCalledWith(first);
      await settle();
      expect(session.get().entry).toBe(first);
      session.destroy();
      expect(kept.progress).not.toHaveBeenCalled();
    }
  });

  it("leaves the next stream at the place the clip was opened at, not at the clip's clock", async () => {
    const { video, session } = setup({ runtime: 2700 });
    await open(session, video, first, 30, 600, { handPicked: true });
    void video.play();
    video.fire('playing');
    session.seek(0);
    video.fire('seeked');
    playFor(video, 5);
    expect(session.get().clip).toBe(true);
    expect(session.carryOn()).toBe(600);
    session.destroy();
  });

  it('takes nothing from the clip it let go of, when its engine tells all in one go', async () => {
    // Android's bridge sends the length, the end and the picture in one state message.
    const { video, session } = setup({ runtime: 2700 });
    session.play(first, 600);
    await settle();
    video.duration = 30;
    video.fire('durationchange');
    video.fire('ended');
    video.fire('playing');
    expect(session.get().entry).toBe(second);
    expect(session.get().status).toBe('loading');
    expect(session.get().failedOver).toBe(true);
    expect(session.get().clip).toBe(false);
    expect(kept.progress).not.toHaveBeenCalled();
    // The next stream's start clock still runs: it fails if nothing plays.
    await settle();
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(session.get().status).toBe('failed');
    expect(session.get().error?.kind).toBe('network');
  });

  it("is never judged for a special, which the series' running time says nothing about", async () => {
    const { video, session, markFailed } = setup({
      runtime: 1320,
      type: 'series',
      videoId: 'tt1:0:3',
    });
    await open(session, video, first, 180);
    void video.play();
    video.fire('playing');
    playFor(video, 10);
    session.saveProgress();
    expect(markFailed).not.toHaveBeenCalled();
    expect(session.get().entry).toBe(first);
    expect(kept.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 10, duration: 180 }),
    );
    // An episode of season 1 that short is a clip.
    const regular = setup({ runtime: 1320, type: 'series', videoId: 'tt1:1:3' });
    await open(regular.session, regular.video, first, 180);
    expect(regular.markFailed).toHaveBeenCalledWith(first);
  });

  it('is not judged without the running time from the title page, under 20 minutes, nor for five minutes or more', async () => {
    for (const [runtime, seconds] of [
      [undefined, 30],
      [2700, 360],
      [900, 30],
      [240, 30],
    ] as const) {
      kept.progress.mockClear();
      const { video, session, markFailed } = setup({ runtime });
      await open(session, video, first, seconds);
      void video.play();
      video.fire('playing');
      playFor(video, 10);
      session.saveProgress();
      expect(markFailed).not.toHaveBeenCalled();
      expect(session.get().entry).toBe(first);
      expect(kept.progress).toHaveBeenLastCalledWith(
        expect.objectContaining({ position: 10, duration: seconds }),
      );
    }
  });

  it('is judged again for each stream: a clip passed over leaves the next one kept', async () => {
    const { video, session } = setup({ runtime: 2700 });
    await open(session, video, first, 30);
    await settle();
    expect(session.get().entry).toBe(second);
    video.duration = 2640;
    video.fire('durationchange');
    void video.play();
    video.fire('playing');
    playFor(video, 5);
    video.fire('ended');
    expect(kept.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 2640, duration: 2640 }),
    );
  });
});

describe('a stream that is not remembered', () => {
  it('keeps no record of how it played, buffering or smooth', async () => {
    const { video, session } = setup({ lighter: [bluray], remember: false });
    await start(session, video, remux, 60);
    struggle(video);
    expect(session.get().entry).toBe(bluray);
    await settle();
    video.fire('playing');
    playFor(video, SMOOTH_AFTER_S + 30);

    expect(kept.bandwidth.struggled).not.toHaveBeenCalled();
    expect(kept.bandwidth.smooth).not.toHaveBeenCalled();
    expect(kept.progress).not.toHaveBeenCalled();
    expect(kept.sourceMemory).not.toHaveBeenCalled();
  });
});

describe('a sports replay', () => {
  it('keeps its place, marked to stay off Continue Watching, as it plays and when it ends', async () => {
    const { video, session } = setup({ continueRow: false });
    await start(session, video, first, 600);
    playFor(video, 30);
    session.saveProgress();
    expect(kept.progress).toHaveBeenLastCalledWith({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 630,
      duration: 7200,
      continueRow: false,
    });
    video.fire('ended');
    expect(kept.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 7200, continueRow: false }),
    );
  });

  it('is the only video kept off the row', async () => {
    const { video, session } = setup();
    await start(session, video, first, 600);
    playFor(video, 30);
    session.destroy();
    expect(kept.progress).toHaveBeenCalled();
    for (const [update] of kept.progress.mock.calls)
      expect(update).not.toHaveProperty('continueRow');
  });
});

describe('a live stream', () => {
  /** A broadcast already two hours in, as the TV's player reports one: no length. */
  async function live(session: Session, video: FakeVideo, entry = first) {
    video.duration = NaN;
    session.play(entry, 0);
    await settle();
    lastEngine().live = true;
    video.currentTime = 7200;
    video.duration = Infinity;
    video.fire('durationchange');
    void video.play();
    video.fire('playing');
    video.fire('timeupdate');
  }

  it('says how far behind live it is, keeps jumps within what it keeps, and goes back to live', async () => {
    const { video, session } = setup();
    await live(session, video);
    lastEngine().window = { start: 7000, live: 7200, slack: 6 };
    video.fire('timeupdate');
    expect(session.get()).toMatchObject({ behind: 0, liveWindow: { start: 7000, live: 7200 } });
    session.seek(7100);
    expect(session.get().behind).toBe(100);
    // Never past live, nor before what it keeps.
    session.seek(7400);
    expect(video.currentTime).toBe(7200);
    expect(session.get().behind).toBe(0);
    session.seek(6000);
    expect(video.currentTime).toBe(7000);
    expect(session.get().behind).toBe(200);
    session.goToLive();
    expect(video.currentTime).toBe(7200);
    expect(session.get().behind).toBe(0);
    session.destroy();
  });

  it('falls behind live while paused, with no clock moving to say so', async () => {
    const { video, session } = setup();
    await live(session, video);
    lastEngine().window = { start: 7000, live: 7200, slack: 6 };
    video.fire('timeupdate');
    session.pause();
    video.fire('pause');
    // Live moves on; the paused clock does not.
    lastEngine().window = { start: 7030, live: 7230, slack: 6 };
    vi.advanceTimersByTime(LIVE_TICK_MS);
    expect(session.get()).toMatchObject({ status: 'paused', behind: 30 });
    session.goToLive();
    expect(session.get().behind).toBe(0);
    session.destroy();
  });

  it('never jumps back on a skip forward, and takes no judgement from a reading of 0', async () => {
    const { video, session } = setup();
    await live(session, video);
    lastEngine().window = { start: 7000, live: 7200, slack: 6 };
    session.seek(7100);
    expect(session.get().behind).toBe(100);
    // The clock ran on past where live was last read: forward stays put.
    video.currentTime = 7203;
    session.seek(7213);
    expect(video.currentTime).toBe(7203);
    // So does Go to live: live is here, not back where it was read.
    session.goToLive();
    expect(video.currentTime).toBe(7203);
    // An engine recovering the media reads 0 for a moment: not judged, and not a place.
    session.seek(7100);
    video.currentTime = 0;
    video.fire('timeupdate');
    expect(session.get()).toMatchObject({ behind: 100, position: 7100 });
    session.destroy();
  });

  it('goes back from past a live point read a moment late', async () => {
    const { video, session } = setup();
    await live(session, video);
    lastEngine().window = { start: 7000, live: 7200, slack: 6 };
    video.currentTime = 7210;
    video.fire('timeupdate');
    // Back 10 s lands on live, where it was read.
    session.seek(7200);
    expect(video.currentTime).toBe(7200);
    session.seek(7190);
    expect(video.currentTime).toBe(7190);
    session.destroy();
  });

  it('judges the start of a broadcast that keeps everything from 0', async () => {
    const { video, session } = setup();
    await live(session, video);
    lastEngine().window = { start: 0, live: 2400, slack: 6 };
    video.currentTime = 2400;
    video.fire('timeupdate');
    expect(session.get().behind).toBe(0);
    session.seek(0);
    expect(session.get().behind).toBe(2400);
    vi.advanceTimersByTime(LIVE_TICK_MS);
    expect(session.get().behind).toBe(2400);
    session.destroy();
  });

  it('reads as live, and leaves jumps alone, when the engine cannot tell where live is', async () => {
    const { video, session } = setup();
    await live(session, video);
    session.seek(7100);
    expect(session.get()).toMatchObject({ behind: 0, liveWindow: null });
    session.goToLive();
    expect(video.currentTime).toBe(7100);
    session.destroy();
  });

  it('saves nothing to resume, whenever it stops or ends', async () => {
    const { video, session } = setup();
    await live(session, video);
    expect(session.get()).toMatchObject({ live: true, duration: 0 });
    playFor(video, 60);
    video.pause();
    void video.play();
    video.fire('ended');
    session.saveProgress();
    session.destroy();
    expect(kept.progress).not.toHaveBeenCalled();
  });

  it('is told apart by the engine when it gives the broadcast a length that grows', async () => {
    const { video, session } = setup();
    session.play(first, 0);
    await settle();
    lastEngine().live = true;
    video.currentTime = 600;
    video.duration = 630;
    video.fire('durationchange');
    void video.play();
    video.fire('playing');
    playFor(video, 30);
    expect(session.get()).toMatchObject({ live: true, duration: 0 });
    session.destroy();
    expect(kept.progress).not.toHaveBeenCalled();
  });

  it('starts another stream at the live edge, not at its own clock', async () => {
    const { video, session } = setup();
    await live(session, video);
    playFor(video, 60);
    expect(session.carryOn()).toBe(0);

    lastEngine().listener.fatal(new PlaybackError('network', 'The stream stopped loading'));
    expect(session.get()).toMatchObject({ entry: second, failedOver: true, live: false });
    await settle();
    expect(lastEngine().startAt).toBe(0);
  });

  it('steps down at the live edge', async () => {
    const { video, session } = setup({ lighter: [bluray] });
    await live(session, video, remux);
    struggle(video);
    expect(session.get().entry).toBe(bluray);
    await settle();
    expect(lastEngine().startAt).toBe(0);
  });

  it('counts its addon as having worked after half a minute of watching, wherever its clock starts', async () => {
    const { video, session } = setup();
    await live(session, video);
    playFor(video, 20);
    expect(kept.sourceMemory).not.toHaveBeenCalled();
    playFor(video, 15);
    expect(kept.sourceMemory).toHaveBeenCalledWith(first.addonId, true);
  });
  it('is opened once, at the live edge, when it was opened where an older build saved it', async () => {
    const { video, session } = setup();
    video.duration = NaN;
    session.play(first, 1200);
    await settle();
    lastEngine().live = true;
    video.duration = Infinity;
    video.fire('durationchange');
    expect(kept.cleared).toHaveBeenCalledWith('tt1');
    vi.advanceTimersByTime(0);
    await settle();
    expect(fake.engines).toHaveLength(2);
    expect(lastEngine().startAt).toBe(0);
    expect(session.get().entry).toBe(first);

    // Live again on the new engine: no third start.
    lastEngine().live = true;
    video.fire('durationchange');
    vi.advanceTimersByTime(0);
    await settle();
    expect(fake.engines).toHaveLength(2);
  });

  it('is not opened again when it was opened at the live edge', async () => {
    const { video, session } = setup();
    await live(session, video);
    vi.advanceTimersByTime(0);
    await settle();
    expect(fake.engines).toHaveLength(1);
  });

  it('saves nothing when a jump comes before it is known to be live, and fails over at the live edge', async () => {
    const { video, session } = setup();
    video.duration = NaN;
    session.play(first, 0);
    await settle();
    // Fast forward on the loading screen.
    session.seek(30);
    expect(kept.progress).not.toHaveBeenCalled();
    expect(session.carryOn()).toBe(0);
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(session.get().entry).toBe(second);
    await settle();
    expect(lastEngine().startAt).toBe(0);
  });
});

describe('a stream picked from the list', () => {
  it('stops at the problem box when it fails, rather than move to another', async () => {
    const { video, session, markFailed } = setup();
    await start(session, video, second, 600, { chosen: true, handPicked: true });
    lastEngine().listener.fatal(new PlaybackError('network', 'The link has expired'));
    await settle();
    expect(session.get()).toMatchObject({ status: 'failed', entry: second, failedOver: false });
    expect(markFailed).toHaveBeenCalledWith(second);
  });

  it('lets a stream opened afterwards by the session fail over again', async () => {
    const { video, session } = setup();
    await start(session, video, second, 600, { chosen: true, handPicked: true });
    session.play(second, 600);
    await settle();
    lastEngine().listener.fatal(new PlaybackError('network', 'The link has expired'));
    await settle();
    expect(session.get()).toMatchObject({ entry: first, failedOver: true });
  });
});

describe('a stream with an end', () => {
  it('is paused, not ended, once the viewer goes back from the end, and plays on from there', async () => {
    const { video, session } = setup();
    await start(session, video, first, 7190);
    video.currentTime = 7200;
    video.fire('ended');
    expect(session.get().status).toBe('ended');
    session.seek(7100);
    expect(session.get()).toMatchObject({ status: 'paused', position: 7100 });
    session.resume();
    expect(video.currentTime).toBe(7100);
  });

  it('stays ended when a seek lands on the end itself', async () => {
    const { video, session } = setup();
    await start(session, video, first, 7190);
    video.fire('ended');
    session.seek(7300);
    expect(session.get().status).toBe('ended');
  });

  it('starts at normal speed', async () => {
    const { video, session } = setup();
    expect(session.get().rate).toBe(1);
    await start(session, video, first, 600);
    expect(session.get().rate).toBe(1);
  });

  it('plays at the speed chosen, says so when the TV puts it back, and opens another stream at normal speed', async () => {
    const { video, session } = setup();
    await start(session, video, first, 600);
    session.setRate(1.25);
    expect(video.playbackRate).toBe(1.25);
    expect(session.get().rate).toBe(1.25);
    // Not a speed: Shaka's 0 while it buffers.
    video.playbackRate = 0;
    video.fire('ratechange');
    expect(session.get().rate).toBe(1.25);
    video.playbackRate = 1;
    video.fire('ratechange');
    expect(session.get().rate).toBe(1);
    session.setRate(1.5);
    session.play(second, 0);
    expect(video.playbackRate).toBe(1);
    expect(session.get().rate).toBe(1);
    session.destroy();
  });

  it('carries on from where it is', async () => {
    const { video, session } = setup();
    await start(session, video, first, 600);
    playFor(video, 30);
    expect(session.get().live).toBe(false);
    expect(session.carryOn()).toBe(630);
  });

  it('keeps the place it was resumed at when the viewer jumps before the first picture and leaves', async () => {
    const { video, session } = setup();
    video.duration = NaN;
    session.play(first, 1800);
    await settle();
    session.seek(1830);
    session.destroy();
    expect(kept.progress).not.toHaveBeenCalled();
  });

  it('is a film, not a broadcast, when its file leaves the length out', async () => {
    const { video, session } = setup();
    video.duration = Infinity;
    await start(session, video, first, 600);
    playFor(video, 30);
    expect(session.get().live).toBe(false);
    expect(session.carryOn()).toBe(630);
    session.destroy();
    // Saved against the title's running time, so it can resume.
    expect(kept.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 630, duration: 7200 }),
    );
  });

  it('keeps its place when it fails with nothing left to try, for Try again and for Back', async () => {
    const { video, session } = setup({ autoFailover: false });
    await start(session, video, first, 600);
    playFor(video, 30);
    lastEngine().listener.fatal(new PlaybackError('network', 'The stream stopped loading'));
    expect(session.get().status).toBe('failed');
    expect(kept.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 630, duration: 7200 }),
    );
    kept.progress.mockClear();
    // Letting the stream go resets the element, as Chromium does.
    video.currentTime = 0;
    video.duration = NaN;
    video.fire('timeupdate');
    expect(session.carryOn()).toBe(630);
    session.destroy();
    expect(kept.progress).not.toHaveBeenCalled();
  });
});
