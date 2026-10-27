import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEmbeddedTracksTest } from './embedded';

const luna = vi.hoisted(() => ({ calls: [] as string[] }));

// A TV whose media pipeline answers every call at once.
vi.mock('../platform/webos', () => ({
  isWebOS: () => true,
  lunaCall: (uri: string) => {
    luna.calls.push(uri);
    return Promise.resolve({});
  },
  lunaSubscribe: (_uri: string, _params: unknown, listener: (message: unknown) => void) => {
    listener({ sourceInfo: { programInfo: [{ numSubtitleTracks: 2 }] } });
    return () => undefined;
  },
}));

const video = { mediaId: 'media-1', currentTime: 0, paused: false, error: null };

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  luna.calls = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runEmbeddedTracksTest', () => {
  it('makes no more calls and notes nothing once stopped', async () => {
    const notes: string[] = [];
    const stop = runEmbeddedTracksTest(video as unknown as HTMLVideoElement, (line) =>
      notes.push(line),
    );
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    const noted = notes.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(notes).toHaveLength(noted);
    expect(luna.calls).toEqual([]);
  });
});
