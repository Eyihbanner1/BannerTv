import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShakaEngine, shakaTextTrack } from './shaka';

const script = vi.hoisted(() => {
  let resolve = () => undefined as void;
  return {
    reset() {
      script.loaded = new Promise<void>((done) => (resolve = done));
    },
    finish: () => resolve(),
    loaded: Promise.resolve(),
  };
});

// The vendor script, which the test finishes loading when it chooses.
vi.mock('./vendor', () => ({ loadVendorScript: () => script.loaded }));

class FakePlayer {
  static isBrowserSupported = () => true;
  static created: FakePlayer[] = [];
  static dynamic = false;

  constructor() {
    FakePlayer.created.push(this);
  }

  attach = () => Promise.resolve();
  configure() {}
  addEventListener() {}
  getTextTracks = () => [];
  isDynamic = () => FakePlayer.dynamic;
  seekRange = () => ({ start: 50, end: 290 });
  load = () => Promise.resolve();
  destroy = () => Promise.resolve();
}

const video = {
  firstChild: null,
  pause: () => undefined,
  play: vi.fn(() => Promise.resolve()),
  load: () => undefined,
  removeAttribute: () => undefined,
} as unknown as HTMLVideoElement & { play: ReturnType<typeof vi.fn> };

const listener = { tracks: () => undefined, cues: () => undefined, fatal: () => undefined };

beforeEach(() => {
  vi.stubGlobal('window', {
    shaka: { Player: FakePlayer, polyfill: { installAll: () => undefined } },
  });
  FakePlayer.created = [];
  FakePlayer.dynamic = false;
  video.play.mockClear();
  script.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shakaTextTrack', () => {
  it('marks a track of forced lines only, by Shaka’s flag or its name', () => {
    const track = (label: string | null, forced: boolean) =>
      ({ id: 3, language: 'en', label, forced, active: false }) as unknown as Parameters<
        typeof shakaTextTrack
      >[0];
    expect(shakaTextTrack(track(null, false))).toEqual({
      id: '3',
      lang: 'en',
      label: '',
      active: false,
    });
    expect(shakaTextTrack(track('English', true)).forced).toBe(true);
    expect(shakaTextTrack(track('Signs & Songs', false)).forced).toBe(true);
  });
});

describe('the Shaka engine', () => {
  it('starts no player when it was stopped while Shaka was still loading', async () => {
    const engine = createShakaEngine(video, listener);
    const loading = engine.load('https://media.example.com/manifest.mpd', 0);
    // Back pressed while the script loads the first time.
    await engine.destroy();
    script.finish();
    await loading;
    expect(FakePlayer.created).toEqual([]);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('plays once loaded', async () => {
    script.finish();
    const engine = createShakaEngine(video, listener);
    await engine.load('https://media.example.com/manifest.mpd', 0);
    expect(FakePlayer.created).toHaveLength(1);
    expect(video.play).toHaveBeenCalled();
  });

  it('counts a dynamic manifest as live, whatever length Shaka gives the video', async () => {
    script.finish();
    const engine = createShakaEngine(video, listener);
    expect(engine.isLive()).toBe(false);
    await engine.load('https://media.example.com/manifest.mpd', 0);
    expect(engine.isLive()).toBe(false);
    FakePlayer.dynamic = true;
    expect(engine.isLive()).toBe(true);
  });

  it('plays live at the end of the seek range, which has its delay taken off already', async () => {
    script.finish();
    FakePlayer.dynamic = false;
    const engine = createShakaEngine(video, listener);
    await engine.load('https://media.example.com/manifest.mpd', 0);
    expect(engine.liveWindow()).toBeNull();
    FakePlayer.dynamic = true;
    expect(engine.liveWindow()).toEqual({ start: 50, live: 290, slack: 6 });
  });
});
