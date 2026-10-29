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

  it("puts a newer place onto the TV's own length", async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 5000 });
    await progress.load();
    // The stream is 42 minutes; Trakt's runtime for it is an hour.
    progress.record({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 600,
      duration: 2520,
    });
    expect(await progress.merge([entry('tt1', 6000, { position: 1800, duration: 3600 })])).toBe(1);
    expect(progress.get('tt1')).toMatchObject({ position: 1260, duration: 2520, updatedAt: 6000 });
    expect(progress.resumeAt('tt1')).toBe(1260);
  });

  it("leaves the TV's own stop as it is when it comes back from Trakt", async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 5000 });
    await progress.load();
    progress.record({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 1800,
      duration: 2520,
    });
    const own = progress.get('tt1');
    const before = progress.version();
    // Trakt keeps 71.43% and rebuilds it on its 60 minute runtime, a second later.
    expect(
      await progress.merge([entry('tt1', 6000, { position: 0.7143 * 3600, duration: 3600 })]),
    ).toBe(0);
    expect(progress.get('tt1')).toBe(own);
    expect(progress.version()).toBe(before);
    expect(progress.resumeAt('tt1')).toBe(1800);
    // Over a percentage point away is a place reached elsewhere.
    expect(
      await progress.merge([entry('tt1', 7000, { position: 0.735 * 3600, duration: 3600 })]),
    ).toBe(1);
    expect(progress.get('tt1')!.position).toBeCloseTo(0.735 * 2520);
  });

  it('marks a video finished elsewhere as finished, on its own length', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 5000 });
    await progress.load();
    progress.record({
      metaId: 'tt1',
      type: 'series',
      videoId: 'tt1:1:2',
      position: 600,
      duration: 2520,
    });
    // Two pauses near the end, close enough to be one place; neither marks it watched.
    await progress.merge([
      entry('tt2', 5500, { position: 2500, duration: 2520 }),
      entry('tt2', 5600, { position: 0.995 * 3600, duration: 3600 }),
    ]);
    expect(progress.get('tt2')).toMatchObject({ position: 2500, watched: false });

    await progress.merge([
      entry('tt1:1:2', 6000, { position: 3600, duration: 3600, watched: true }),
      entry('tt2', 6000, { position: 3600, duration: 3600, watched: true }),
    ]);
    expect(progress.get('tt1:1:2')).toMatchObject({
      position: 2520,
      duration: 2520,
      updatedAt: 6000,
      watched: true,
    });
    expect(progress.get('tt2')).toMatchObject({
      position: 2520,
      duration: 2520,
      updatedAt: 6000,
      watched: true,
    });
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
