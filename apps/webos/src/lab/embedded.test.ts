import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEmbeddedTracksTest } from './embedded';

const luna = vi.hoisted(() => ({
  calls: [] as string[],
  /** The mediaId each call was made with, in order. */
  mediaIds: [] as unknown[],
  /** The mediaId of each subscription, in order, and those cancelled. */
  subscribed: [] as string[],
  cancelled: [] as string[],
  /** Whether the pipeline describes the file to a subscription on this mediaId. */
  describes: (() => true) as (mediaId: string) => boolean,
  /** What the media service answers every call with. */
  answer: {} as Record<string, unknown>,
}));

// A TV whose media pipeline answers every call at once.
vi.mock('../platform/webos', async (importOriginal) => {
  const { lunaFailed } = await importOriginal<typeof import('../platform/webos')>();
  return {
    isWebOS: () => true,
    // Fails only where the real lunaCall does.
    lunaCall: (uri: string, params: Record<string, unknown>) => {
      luna.calls.push(uri);
      luna.mediaIds.push(params.mediaId);
      return lunaFailed(luna.answer)
        ? Promise.reject(new Error(`${uri}: ${String(luna.answer.errorText)}`))
        : Promise.resolve(luna.answer);
    },
    lunaSubscribe: (
      _uri: string,
      params: { mediaId: string },
      listener: (message: Record<string, unknown>) => void,
    ) => {
      luna.subscribed.push(params.mediaId);
      listener(
        luna.describes(params.mediaId)
          ? { sourceInfo: { programInfo: [{ numSubtitleTracks: 2 }] } }
          : { returnValue: true, subscribed: true },
      );
      return () => {
        luna.cancelled.push(params.mediaId);
      };
    },
  };
});

const video = { mediaId: 'media-1', currentTime: 0, paused: false, error: null };

/** A video that, opened again, gets a new mediaId from the pipeline 400 ms later. */
function reopenableVideo() {
  const listeners: Record<string, () => void> = {};
  const element = {
    mediaId: 'media-1',
    currentTime: 42,
    paused: false,
    error: null,
    addEventListener: (type: string, listener: () => void) => {
      listeners[type] = listener;
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (listeners[type] === listener) delete listeners[type];
    },
    load: vi.fn(() => {
      element.mediaId = '<invalid mediaId>';
      element.currentTime = 0;
      window.setTimeout(() => {
        element.mediaId = 'media-2';
        listeners.loadedmetadata?.();
      }, 400);
    }),
    play: vi.fn(() => Promise.resolve()),
  };
  return element;
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  luna.calls = [];
  luna.mediaIds = [];
  luna.subscribed = [];
  luna.cancelled = [];
  luna.describes = () => true;
  luna.answer = {};
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

  it('leaves the pipeline alone when stopped during its last step', async () => {
    const stop = runEmbeddedTracksTest(video as unknown as HTMLVideoElement, () => undefined);
    // 21.5 s in, the clock is being watched after the switch to audio 1.
    await vi.advanceTimersByTimeAsync(21500);
    expect(luna.calls[luna.calls.length - 1]).toBe('luna://com.webos.media/selectTrack');
    stop();
    const made = luna.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(luna.calls).toHaveLength(made);
  });

  it('opens the video again when it was not described, and tries the calls on its new mediaId', async () => {
    // The file was opened long before the subscription, so its description has gone by.
    luna.describes = (mediaId) => mediaId !== 'media-1';
    const element = reopenableVideo();
    const notes: string[] = [];
    runEmbeddedTracksTest(element as unknown as HTMLVideoElement, (line) => notes.push(line));

    await vi.advanceTimersByTimeAsync(2900);
    expect(element.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(element.load).toHaveBeenCalledTimes(1);
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(notes).toContain('No sourceInfo yet: opening the video again to catch it');

    await vi.advanceTimersByTimeAsync(400);
    expect(luna.subscribed).toEqual(['media-1', 'media-2']);
    expect(notes).toContain('new mediaId after 400 ms');
    expect(notes).toContainEqual(expect.stringMatching(/^sourceInfo: 2 subtitles/));
    // Back where it was playing.
    expect(element.currentTime).toBe(42);

    await vi.advanceTimersByTimeAsync(60000);
    expect(notes).toContain('message: returnValue, subscribed');
    expect(notes).not.toContain('No sourceInfo; trying the calls anyway');
    expect(luna.calls.map((uri) => uri.replace('luna://com.webos.media/', ''))).toEqual([
      'setSubtitleEnable',
      'selectTrack',
      'selectTrack',
      'setSubtitleEnable',
      'selectTrack',
      'unsubscribe',
    ]);
    expect(luna.mediaIds.every((id) => id === 'media-2')).toBe(true);
    expect(luna.cancelled).toEqual(['media-1', 'media-2']);
    expect(notes[notes.length - 1]).toBe('Embedded tracks test done');
  });

  it('does not move the next video to the old time when stopped while the video opens again', async () => {
    luna.describes = (mediaId) => mediaId !== 'media-1';
    const element = reopenableVideo();
    const stop = runEmbeddedTracksTest(element as unknown as HTMLVideoElement, () => undefined);
    await vi.advanceTimersByTimeAsync(3000);
    expect(element.load).toHaveBeenCalledTimes(1);
    // The viewer leaves; the element then opens another stream from its start.
    stop();
    await vi.advanceTimersByTimeAsync(400);
    expect(element.currentTime).toBe(0);
  });

  it('goes on when the media service answers "No Error"', async () => {
    // What setSubtitleEnable answered on the TV: no returnValue, errorCode 0.
    luna.answer = { errorCode: 0, errorText: 'No Error' };
    const notes: string[] = [];
    runEmbeddedTracksTest(video as unknown as HTMLVideoElement, (line) => notes.push(line));
    await vi.advanceTimersByTimeAsync(60000);
    expect(notes).toContain('setSubtitleEnable true : ok');
    expect(luna.calls.filter((uri) => uri.endsWith('/selectTrack'))).toHaveLength(3);
    expect(notes[notes.length - 1]).toBe('Embedded tracks test done');
  });
});
