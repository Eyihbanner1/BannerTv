import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { createProgressStore, type ProgressEntry } from './progress';

function entry(videoId: string, updatedAt: number, extra: Partial<ProgressEntry> = {}) {
  return {
    metaId: videoId.split(':')[0]!,
    type: videoId.indexOf(':') === -1 ? 'movie' : 'series',
    videoId,
    position: 600,
    duration: 3000,
    updatedAt,
    watched: false,
    ...extra,
  };
}

describe('progress.merge', () => {
  it('takes only entries newer than the TV has, and keeps a watched mark', async () => {
    const storage = memoryKeyValueStore();
    let time = 5000;
    const progress = createProgressStore({ storage, now: () => time });
    await progress.load();
    progress.record({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 2900,
      duration: 3000,
    });
    time = 6000;
    progress.record({
      metaId: 'tt2',
      type: 'movie',
      videoId: 'tt2',
      position: 100,
      duration: 3000,
    });

    const taken = await progress.merge([
      entry('tt1', 9000, { position: 300 }),
      entry('tt2', 1000, { position: 2000 }),
      entry('tt3:1:2', 7000),
      { nonsense: true } as unknown as ProgressEntry,
    ]);
    expect(taken).toBe(2);
    expect(progress.get('tt1')).toMatchObject({ position: 300, watched: true, updatedAt: 9000 });
    expect(progress.get('tt2')).toMatchObject({ position: 100, updatedAt: 6000 });
    expect(progress.recent().map((e) => e.videoId)).toEqual(['tt1', 'tt3:1:2', 'tt2']);
    expect(await progress.merge([entry('tt2', 1)])).toBe(0);

    const again = createProgressStore({ storage });
    await again.load();
    expect(again.recent().map((e) => e.videoId)).toEqual(['tt1', 'tt3:1:2', 'tt2']);
  });

  it('trims the oldest, wherever they came from', async () => {
    const progress = createProgressStore({
      storage: memoryKeyValueStore(),
      now: () => 100,
      maxEntries: 2,
    });
    await progress.load();
    progress.record({ metaId: 'tt1', type: 'movie', videoId: 'tt1', position: 60, duration: 600 });
    await progress.merge([entry('old', 1), entry('new', 200)]);
    expect(progress.recent().map((e) => e.videoId)).toEqual(['new', 'tt1']);
  });
});
