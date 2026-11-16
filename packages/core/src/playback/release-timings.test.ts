import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import {
  createReleaseTimingMemory,
  MAX_RELEASE_TIMINGS,
  type ReleaseTiming,
} from './release-timings';

const timing = (over: Partial<ReleaseTiming> = {}): ReleaseTiming => ({
  metaId: 'tt1',
  release: 'group:flux',
  source: 'opensubtitles',
  lang: 'en',
  offset: 1.2,
  videoId: 'tt1:1:1',
  ...over,
});

describe('createReleaseTimingMemory', () => {
  it('keeps one timing per release of a title', async () => {
    const storage = memoryKeyValueStore();
    const memory = createReleaseTimingMemory({ storage });
    await memory.remember(timing());
    await memory.remember(timing({ release: 'binge:tio|1080p' }));
    // A newer timing for the same release replaces the older one.
    await memory.remember(timing({ offset: -0.46, drift: 'ahead', videoId: 'tt1:1:2' }));
    expect(memory.get('tt1', 'group:flux')).toEqual(
      timing({ offset: -0.5, drift: 'ahead', videoId: 'tt1:1:2' }),
    );
    expect(memory.get('tt1', 'group:ntb')).toBeUndefined();
    expect(memory.get('tt2', 'group:flux')).toBeUndefined();
    expect(await storage.get('releaseTimings')).toEqual([
      timing({ release: 'binge:tio|1080p' }),
      timing({ offset: -0.5, drift: 'ahead', videoId: 'tt1:1:2' }),
    ]);
    // Clamped as the timings are.
    await memory.remember(timing({ offset: 900, subGroup: 'ntb' }));
    expect(memory.get('tt1', 'group:flux')).toEqual(timing({ offset: 600, subGroup: 'ntb' }));
    await memory.forget('tt1', 'group:flux');
    expect(memory.get('tt1', 'group:flux')).toBeUndefined();
  });

  it('keeps no release named by its video alone, and no link', async () => {
    const storage = memoryKeyValueStore();
    const memory = createReleaseTimingMemory({ storage });
    await memory.remember(timing({ release: 'video:tt1:1:1' }));
    await memory.remember(timing({ release: 'flux' }));
    await memory.remember(timing({ release: 'binge:https://x.example/?key=1' }));
    await memory.remember(timing({ source: 'https://subs.example/file.srt' }));
    await memory.remember(timing({ subGroup: 'x://y' }));
    await memory.remember(timing({ lang: '' }));
    await memory.remember(timing({ videoId: '' }));
    await memory.remember(timing({ offset: Number.NaN }));
    await memory.remember(timing({ offset: Infinity }));
    // Nothing to keep: no timing and no drift fix.
    await memory.remember(timing({ offset: 0 }));
    expect(memory.get('tt1', 'group:flux')).toBeUndefined();
    expect(await storage.get('releaseTimings')).toBeUndefined();
    await memory.remember(timing({ offset: 0, drift: 'behind' }));
    expect(memory.get('tt1', 'group:flux')?.drift).toBe('behind');
  });

  it('drops the oldest past 300', async () => {
    const memory = createReleaseTimingMemory({ storage: memoryKeyValueStore() });
    for (let i = 0; i <= MAX_RELEASE_TIMINGS; i++) {
      await memory.remember(timing({ metaId: `tt${i}` }));
    }
    expect(memory.get('tt0', 'group:flux')).toBeUndefined();
    expect(memory.get('tt1', 'group:flux')).toBeDefined();
    expect(memory.get(`tt${MAX_RELEASE_TIMINGS}`, 'group:flux')).toBeDefined();
  });

  it('a decline holds for that episode only, and a new timing clears it', async () => {
    const memory = createReleaseTimingMemory({ storage: memoryKeyValueStore() });
    await memory.decline('tt1', 'group:flux', 'tt1:1:2');
    expect(memory.get('tt1', 'group:flux')).toBeUndefined();
    await memory.remember(timing());
    await memory.decline('tt1', 'group:flux', 'tt1:1:2');
    expect(memory.get('tt1', 'group:flux')?.declined).toBe('tt1:1:2');
    // Another episode declined since: only the newest is held.
    await memory.decline('tt1', 'group:flux', 'tt1:1:3');
    expect(memory.get('tt1', 'group:flux')?.declined).toBe('tt1:1:3');
    await memory.remember(timing({ offset: 2, videoId: 'tt1:1:3' }));
    expect(memory.get('tt1', 'group:flux')).toEqual(timing({ offset: 2, videoId: 'tt1:1:3' }));
  });

  it("reads back what it saved, dropping what it can't trust", async () => {
    const storage = memoryKeyValueStore();
    await storage.set('releaseTimings', [
      timing({ offset: 1 }),
      null,
      'text',
      { ...timing(), metaId: 7 },
      timing({ release: 'video:tt1:1:1' }),
      timing({ metaId: 'tt2', source: 'https://subs.example/a.srt' }),
      { ...timing({ metaId: 'tt3' }), drift: 'sideways' },
      { ...timing({ metaId: 'tt4' }), offset: '1' },
      timing({ metaId: 'tt5', declined: 'tt5:1:2', subGroup: 'ntb' }),
      // A later duplicate is the newer one.
      timing({ offset: 3 }),
    ]);
    const memory = createReleaseTimingMemory({ storage });
    let told = 0;
    memory.subscribe(() => told++);
    await memory.load();
    expect(told).toBeGreaterThan(0);
    expect(memory.get('tt1', 'group:flux')?.offset).toBe(3);
    expect(memory.get('tt1', 'video:tt1:1:1')).toBeUndefined();
    expect(memory.get('tt2', 'group:flux')).toBeUndefined();
    expect(memory.get('tt3', 'group:flux')).toBeUndefined();
    expect(memory.get('tt4', 'group:flux')).toBeUndefined();
    expect(memory.get('tt5', 'group:flux')).toEqual(
      timing({ metaId: 'tt5', declined: 'tt5:1:2', subGroup: 'ntb' }),
    );
  });
});
