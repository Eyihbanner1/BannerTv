import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHlsEngine, LIVE_CATCH_UP_RATE, LIVE_MAX_SEGMENTS } from './hls';

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

type Handler = (event: unknown, data: unknown) => void;

class FakeHls {
  static Events = {
    MANIFEST_PARSED: 'manifestParsed',
    AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
    AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
    SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
    SUBTITLE_TRACK_SWITCH: 'subtitleTrackSwitch',
    CUES_PARSED: 'cuesParsed',
    ERROR: 'hlsError',
  };
  static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
  static isSupported = () => true;
  static created: FakeHls[] = [];

  handlers: Record<string, Handler> = {};
  attached: unknown = null;
  destroyed = false;
  latestLevelDetails: {
    live: boolean;
    targetduration?: number;
    fragments?: Array<{ start: number }>;
  } | null = null;
  liveSyncPosition: number | null = null;

  constructor(readonly config: Record<string, unknown> = {}) {
    FakeHls.created.push(this);
  }

  on(event: string, handler: Handler) {
    this.handlers[event] = handler;
  }

  attachMedia(video: unknown) {
    this.attached = video;
  }

  loadSource() {}

  destroy() {
    this.destroyed = true;
  }
}

const video = {
  currentTime: 0,
  firstChild: null,
  pause: () => undefined,
  play: () => Promise.resolve(),
  load: () => undefined,
  removeAttribute: () => undefined,
} as unknown as HTMLVideoElement;

const listener = { tracks: () => undefined, cues: () => undefined, fatal: vi.fn() };

beforeEach(() => {
  vi.stubGlobal('window', { Hls: FakeHls });
  FakeHls.created = [];
  script.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the hls.js engine', () => {
  it('attaches nothing when it was stopped while hls.js was still loading', async () => {
    const engine = createHlsEngine(video, listener);
    const loading = engine.load('https://media.example.com/master.m3u8', 0);
    // Back pressed while the script loads the first time.
    engine.destroy();
    script.finish();
    await loading;
    expect(FakeHls.created).toEqual([]);
  });

  it('leaves a failed worker to hls.js, which carries on without it', async () => {
    script.finish();
    const engine = createHlsEngine(video, listener);
    await engine.load('https://media.example.com/master.m3u8', 0);
    const [instance] = FakeHls.created;
    instance!.handlers[FakeHls.Events.ERROR]!(FakeHls.Events.ERROR, {
      type: 'otherError',
      details: 'internalException',
      fatal: false,
      event: 'demuxerWorker',
    });
    expect(FakeHls.created).toHaveLength(1);
    expect(instance!.destroyed).toBe(false);
    expect(listener.fatal).not.toHaveBeenCalled();
  });

  it('counts a playlist with no end as live, though hls.js gives the video a length', async () => {
    script.finish();
    const engine = createHlsEngine(video, listener);
    await engine.load('https://media.example.com/master.m3u8', 0);
    const [instance] = FakeHls.created;
    expect(engine.isLive()).toBe(false);
    instance!.latestLevelDetails = { live: true };
    expect(engine.isLive()).toBe(true);
    instance!.latestLevelDetails = { live: false };
    expect(engine.isLive()).toBe(false);
  });

  it('catches up a little faster on live, and jumps back when far behind', async () => {
    script.finish();
    const engine = createHlsEngine(video, listener);
    await engine.load('https://media.example.com/live.m3u8', 0);
    const [instance] = FakeHls.created;
    expect(instance!.config).toMatchObject({
      liveMaxLatencyDurationCount: LIVE_MAX_SEGMENTS,
      maxLiveSyncPlaybackRate: LIVE_CATCH_UP_RATE,
    });
    // hls.js sits three segments back by default: jumping back must leave room past that.
    expect(LIVE_MAX_SEGMENTS).toBeGreaterThan(3);
  });

  it('plays live where hls.js syncs to, back to the oldest segment listed, a segment of slack', async () => {
    script.finish();
    const engine = createHlsEngine(video, listener);
    await engine.load('https://media.example.com/master.m3u8', 0);
    const [instance] = FakeHls.created;
    instance!.latestLevelDetails = {
      live: true,
      targetduration: 6,
      fragments: [{ start: 120 }, { start: 126 }],
    };
    expect(engine.liveWindow()).toBeNull();
    instance!.liveSyncPosition = 300;
    expect(engine.liveWindow()).toEqual({ start: 120, live: 300, slack: 6 });
    instance!.latestLevelDetails = { live: false };
    expect(engine.liveWindow()).toBeNull();
  });
});
