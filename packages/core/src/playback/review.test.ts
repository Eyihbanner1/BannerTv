import type { MetaDetail, Stream, Video } from '@bannertv/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryKeyValueStore, type KeyValueStore } from '../storage';
import { findBingeStream, nextVideo } from './next';
import { createProgressStore, type ProgressEntry, type ProgressUpdate } from './progress';
import { createProgressTracker } from './tracker';

// Edge cases found in review: tie order, the TV's unstable sort, large inputs and failure paths.

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function saved(videoId: string, updatedAt: number, metaId = 'tt9'): ProgressEntry {
  return {
    metaId,
    type: 'series',
    videoId,
    position: 600,
    duration: 2400,
    updatedAt,
    watched: false,
  };
}

function episode(videoId: string, position: number): ProgressUpdate {
  return { metaId: 'tt9', type: 'series', videoId, position, duration: 2400 };
}

const stableSort = Array.prototype.sort;

/**
 * Chromium 68 sorts arrays of more than 10 items unstably. Node sorts stably,
 * so this stand-in turns ties around to show code that leans on stability.
 */
function sortUnstably() {
  Array.prototype.sort = function <T>(this: T[], compare?: (a: T, b: T) => number): T[] {
    const reversed = this.slice().reverse();
    stableSort.call(reversed, compare);
    reversed.forEach((item, index) => {
      this[index] = item;
    });
    return this;
  };
}

afterEach(() => {
  Array.prototype.sort = stableSort;
});

describe('createProgressStore, reviewed', () => {
  it('keeps the saved order of entries with the same time, so reloads do not flip them', async () => {
    const storage = memoryKeyValueStore();
    // Least recent first, as the store writes it: b was updated after a.
    await storage.set('progress', [saved('a', 5), saved('b', 5)]);
    const progress = createProgressStore({ storage, now: () => 9, maxEntries: 2 });
    await progress.load();
    expect(progress.forMeta('tt9').map((entry) => entry.videoId)).toEqual(['b', 'a']);

    progress.record(episode('c', 100));
    expect(progress.get('a')).toBeUndefined();
    expect(progress.get('b')).toBeDefined();
    await flush();
    expect((await storage.get('progress')) as ProgressEntry[]).toEqual([
      saved('b', 5),
      progress.get('c'),
    ]);
  });

  it('writes back a saved list with tied times in the order it read it', async () => {
    const storage = memoryKeyValueStore();
    const list = [saved('a', 5), saved('b', 5), saved('c', 5)];
    await storage.set('progress', list);
    for (let launch = 0; launch < 3; launch++) {
      const progress = createProgressStore({ storage, now: () => 1 });
      await progress.load();
      progress.clear('none');
      progress.record({ ...episode('z', 100), metaId: 'other' });
      progress.clear('z');
      await flush();
    }
    expect(await storage.get('progress')).toEqual(list);
  });

  it('gives the same answers when the sort is unstable, as on Chromium 68', async () => {
    sortUnstably();
    const storage = memoryKeyValueStore();
    const list: ProgressEntry[] = [];
    for (let i = 0; i < 30; i++) list.push(saved(`v${i}`, i < 15 ? 7 : 8));
    await storage.set('progress', list);
    const progress = createProgressStore({ storage, now: () => 8 });
    await progress.load();
    const expected: string[] = [];
    for (let i = 29; i >= 0; i--) expected.push(`v${i}`);
    expect(progress.forMeta('tt9').map((entry) => entry.videoId)).toEqual(expected);
  });

  it('keeps a record made while reading when the saved list fills the limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('progress', [saved('x', 1), saved('y', 2)]);
    const progress = createProgressStore({ storage, now: () => 3, maxEntries: 2 });
    const loading = progress.load();
    progress.record(episode('z', 100));
    await loading;
    expect(progress.get('x')).toBeUndefined();
    expect(progress.forMeta('tt9').map((entry) => entry.videoId)).toEqual(['z', 'y']);
  });

  it('lands a Start over made during a write in the next write', async () => {
    const values = new Map<string, unknown>();
    const pending: { value: unknown; finish: () => void }[] = [];
    const storage: KeyValueStore = {
      get: (key) => Promise.resolve(values.get(key)),
      set: (key, value) =>
        new Promise<void>((resolve) => {
          pending.push({
            value,
            finish: () => {
              values.set(key, value);
              resolve();
            },
          });
        }),
    };
    const progress = createProgressStore({ storage, now: () => 1 });
    await progress.load();
    progress.record(episode('a', 100));
    progress.record(episode('b', 100));
    await flush();
    expect(pending).toHaveLength(1);

    progress.clear('a');
    pending[0]?.finish();
    await flush();
    expect(pending).toHaveLength(2);
    pending[1]?.finish();
    await flush();
    expect(values.get('progress')).toEqual([progress.get('b')]);
  });

  it('keeps writing after a listener throws while the saved list is read', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('progress', [saved('old', 1)]);
    const progress = createProgressStore({ storage, now: () => 2 });
    progress.subscribe(() => {
      throw new Error('screen bug');
    });
    // The record starts the read itself; the listener then throws inside it.
    expect(() => progress.record(episode('new', 100))).toThrow('screen bug');
    await progress.load().catch(() => undefined);
    await flush();
    expect(await storage.get('progress')).toEqual([saved('old', 1), progress.get('new')]);
  });

  it('loads and trims a very long saved list quickly, keeping the newest', async () => {
    const storage = memoryKeyValueStore();
    const list: ProgressEntry[] = [];
    // Shuffled times, so the trim has to sort.
    for (let i = 0; i < 20000; i++) list.push(saved(`v${i}`, (i * 7919) % 20000));
    await storage.set('progress', list);
    const progress = createProgressStore({ storage, now: () => 30000 });
    const started = Date.now();
    await progress.load();
    for (let i = 0; i < 2000; i++) progress.record(episode(`r${i % 50}`, i));
    progress.forMeta('tt9');
    expect(Date.now() - started).toBeLessThan(1000);
    const kept = progress.forMeta('tt9');
    expect(kept).toHaveLength(500);
    expect(kept.filter((entry) => entry.videoId.charAt(0) === 'r')).toHaveLength(50);
    expect(Math.min(...kept.map((entry) => entry.updatedAt))).toBe(20000 - 450);
  });

  it('marks a position past the end watched and does not resume it', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 1 });
    await progress.load();
    expect(progress.record(episode('a', 2410)).watched).toBe(true);
    expect(progress.resumeAt('a')).toBeUndefined();
  });

  it('reads back saved entries without fields from other versions', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('progress', [{ ...saved('a', 1), extra: 'from a newer build' }]);
    const progress = createProgressStore({ storage });
    await progress.load();
    expect(progress.get('a')).toEqual(saved('a', 1));
  });
});

describe('createProgressTracker, reviewed', () => {
  it('saves every 10 seconds through a two hour film, without drifting', () => {
    const tracker = createProgressTracker({ startAt: 0 });
    let saves = 0;
    for (let ms = 250; ms <= 7_200_000; ms += 250) {
      if (tracker.update(ms / 1000, ms)) saves += 1;
    }
    expect(saves).toBe(720);
  });

  it('keeps saving after one reading came with a time that is not a number', () => {
    const tracker = createProgressTracker({ startAt: 0 });
    expect(tracker.update(1, NaN)).toBe(true);
    expect(tracker.update(2, 20000)).toBe(true);
    expect(tracker.update(3, 21000)).toBe(false);
    expect(tracker.update(4, 30000)).toBe(true);
  });

  it('treats a start point that is not a time as the beginning', () => {
    for (const startAt of [NaN, Infinity, -30]) {
      const tracker = createProgressTracker({ startAt });
      expect(tracker.update(0, 0)).toBe(false);
      expect(tracker.update(0.3, 100)).toBe(true);
    }
  });

  it('trusts a reading at the start point exactly when the tolerance is 0', () => {
    const tracker = createProgressTracker({ startAt: 1800, tolerance: 0 });
    expect(tracker.update(1799.9, 0)).toBe(false);
    expect(tracker.update(1800, 50)).toBe(true);
  });
});

function series(videos: Video[]): MetaDetail {
  return {
    id: 'tt9',
    type: 'series',
    name: 'Show',
    posterShape: 'poster',
    genres: [],
    trailers: [],
    videos,
    cast: [],
    directors: [],
    writers: [],
    links: [],
    behaviorHints: { hasScheduledVideos: false },
  };
}

function ep(season: number, episode: number, released = '2020-01-01T00:00:00.000Z'): Video {
  return { id: `tt9:${season}:${episode}`, title: '', season, episode, released };
}

const NOW = Date.parse('2026-06-01T00:00:00Z');

describe('nextVideo, reviewed', () => {
  it('finds the next episode of a 20,000 episode daily show quickly', () => {
    const videos: Video[] = [];
    for (let season = 40; season >= 1; season--) {
      for (let episode = 500; episode >= 1; episode--) videos.push(ep(season, episode));
    }
    const show = series(videos);
    const started = Date.now();
    expect(nextVideo(show, 'tt9:1:500', NOW)?.id).toBe('tt9:2:1');
    expect(nextVideo(show, 'tt9:40:500', NOW)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('gives the same episode when the sort is unstable, as on Chromium 68', () => {
    sortUnstably();
    const videos: Video[] = [];
    for (let i = 0; i < 15; i++) videos.push({ ...ep(1, 2), id: `copy${i}` });
    const show = series([ep(1, 1), ...videos, ep(1, 3)]);
    expect(nextVideo(show, 'tt9:1:1', NOW)?.id).toBe('copy0');
  });

  it('passes over videos with a season but no episode number between episodes', () => {
    const show = series([ep(1, 1), { id: 'recap', title: 'Recap', season: 1 }, ep(1, 2)]);
    expect(nextVideo(show, 'tt9:1:1', NOW)?.id).toBe('tt9:1:2');
  });

  it('orders an episode 0 and half-numbered episodes by their numbers', () => {
    const show = series([ep(1, 2), ep(1, 1.5), ep(1, 1), ep(1, 0)]);
    expect(nextVideo(show, 'tt9:1:0', NOW)?.id).toBe('tt9:1:1');
    expect(nextVideo(show, 'tt9:1:1', NOW)?.id).toBe('tt9:1:1.5');
    expect(nextVideo(show, 'tt9:1:1.5', NOW)?.id).toBe('tt9:1:2');
  });

  it('stops at a new season whose first episode has not aired', () => {
    const show = series([ep(1, 1), ep(2, 1, '2026-09-01T00:00:00.000Z'), ep(2, 2)]);
    expect(nextVideo(show, 'tt9:1:1', NOW)).toBeUndefined();
  });

  it('counts an episode released at this very moment as aired', () => {
    const show = series([ep(1, 1), ep(1, 2, new Date(NOW).toISOString())]);
    expect(nextVideo(show, 'tt9:1:1', NOW)?.id).toBe('tt9:1:2');
  });

  it('uses the first copy of a video id listed twice with different numbers', () => {
    const show = series([ep(1, 1), ep(1, 2), { ...ep(2, 5), id: 'tt9:1:1' }, ep(1, 3)]);
    expect(nextVideo(show, 'tt9:1:1', NOW)?.id).toBe('tt9:1:2');
  });
});

describe('findBingeStream, reviewed', () => {
  function stream(url: string, hints: Partial<Stream['behaviorHints']>): Stream {
    return {
      source: { kind: 'url', url },
      subtitles: [],
      behaviorHints: { notWebReady: false, ...hints },
    };
  }

  it('matches the binge group exactly, case included', () => {
    const streams = [
      stream('https://a.example/1', { bingeGroup: 'Torrentio|1080p' }),
      stream('https://a.example/2', { bingeGroup: 'torrentio|1080p ' }),
      stream('https://a.example/3', { bingeGroup: 'torrentio|1080p' }),
    ];
    expect(findBingeStream(streams, 'torrentio|1080p')).toBe(streams[2]);
  });

  it('leaves out a stream that needs only response headers', () => {
    const streams = [
      stream('https://a.example/1', {
        bingeGroup: 'g',
        proxyHeaders: { request: {}, response: { 'Content-Type': 'video/mp4' } },
      }),
    ];
    expect(findBingeStream(streams, 'g')).toBeUndefined();
  });

  it('still offers a stream the addon marks not web ready, since the TV plays it natively', () => {
    const streams = [stream('https://a.example/1.mkv', { bingeGroup: 'g', notWebReady: true })];
    expect(findBingeStream(streams, 'g')).toBe(streams[0]);
  });
});
