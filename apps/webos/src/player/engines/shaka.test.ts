import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShakaEngine } from './shaka';

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

  constructor() {
    FakePlayer.created.push(this);
  }

  attach = () => Promise.resolve();
  configure() {}
  addEventListener() {}
  getTextTracks = () => [];
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
  video.play.mockClear();
  script.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
});
