import { describe, expect, it } from 'vitest';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { DEFAULT_MAX_BITRATE } from '../streams/bitrate';
import { createBandwidthMemory } from './bandwidth';

const MBIT = 1e6;

// Lets the chained storage writes finish. Core has no timers.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Memory storage that counts its writes. */
function countingStorage(): KeyValueStore & { writes: number } {
  const inner = memoryKeyValueStore();
  const storage = {
    writes: 0,
    get: inner.get,
    set(key: string, value: unknown) {
      storage.writes++;
      return inner.set(key, value);
    },
  };
  return storage;
}

/** A memory that has finished loading from empty storage. */
async function loaded(storage: KeyValueStore = memoryKeyValueStore()) {
  const memory = createBandwidthMemory({ storage, now: () => 1000 });
  await memory.load();
  return memory;
}

describe('createBandwidthMemory', () => {
  it('starts at the default limit', async () => {
    const memory = createBandwidthMemory({ storage: memoryKeyValueStore() });
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    await memory.load();
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
  });

  it('lowers the limit under a stream that kept buffering', async () => {
    const memory = await loaded();
    memory.struggled(30 * MBIT);
    expect(memory.maxBitrate()).toBe(22.5 * MBIT);
    // A lighter stream that struggles too lowers it further.
    memory.struggled(20 * MBIT);
    expect(memory.maxBitrate()).toBe(15 * MBIT);
  });

  it('keeps the limit when a stream already above it kept buffering', async () => {
    const memory = await loaded();
    memory.struggled(72 * MBIT);
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
  });

  it('never lowers the limit below the floor', async () => {
    const memory = await loaded();
    memory.struggled(4 * MBIT);
    expect(memory.maxBitrate()).toBe(4 * MBIT);
    memory.struggled(1 * MBIT);
    expect(memory.maxBitrate()).toBe(4 * MBIT);
  });

  it('raises the limit to a stream above it that played smoothly', async () => {
    const memory = await loaded();
    memory.smooth(60 * MBIT);
    expect(memory.maxBitrate()).toBe(60 * MBIT);
    // A smaller stream playing smoothly says nothing new.
    memory.smooth(30 * MBIT);
    expect(memory.maxBitrate()).toBe(60 * MBIT);
  });

  it('never raises the limit above the ceiling', async () => {
    const memory = await loaded();
    memory.smooth(500 * MBIT);
    expect(memory.maxBitrate()).toBe(200 * MBIT);
  });

  it('creeps a lowered limit back toward the default when a stream close to it plays smoothly', async () => {
    const memory = await loaded();
    memory.struggled(30 * MBIT);
    expect(memory.maxBitrate()).toBe(22.5 * MBIT);
    // Far under the limit: no proof of anything.
    memory.smooth(10 * MBIT);
    expect(memory.maxBitrate()).toBe(22.5 * MBIT);
    // At least half of it: up by a quarter.
    memory.smooth(20 * MBIT);
    expect(memory.maxBitrate()).toBe(28.125 * MBIT);
    memory.smooth(25 * MBIT);
    expect(memory.maxBitrate()).toBe(35.15625 * MBIT);
  });

  it('does not creep past the default', async () => {
    const memory = await loaded();
    memory.struggled(40 * MBIT);
    expect(memory.maxBitrate()).toBe(30 * MBIT);
    memory.smooth(30 * MBIT);
    expect(memory.maxBitrate()).toBe(37.5 * MBIT);
    // A quarter more would be 46.9 Mbit/s.
    memory.smooth(30 * MBIT);
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    memory.smooth(39 * MBIT);
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    // Only a stream above it raises it further.
    memory.smooth(45 * MBIT);
    expect(memory.maxBitrate()).toBe(45 * MBIT);
  });

  it('undoes a raise from the same stream when it later kept buffering', async () => {
    const memory = await loaded();
    // Ten smooth minutes of a 60 Mbit/s stream lift the limit to it...
    const before = memory.maxBitrate();
    memory.smooth(60 * MBIT);
    expect(memory.maxBitrate()).toBe(60 * MBIT);
    // ...then it kept buffering: back to where it started, not 75% of 60.
    memory.struggled(60 * MBIT, before);
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
  });

  it('ignores a ceiling that is not a rate', async () => {
    const memory = await loaded();
    memory.struggled(20 * MBIT, Number.NaN);
    expect(memory.maxBitrate()).toBe(15 * MBIT);
    memory.struggled(16 * MBIT, 0);
    expect(memory.maxBitrate()).toBe(12 * MBIT);
  });

  it('lifts a lowered limit by a quarter for each full day since it was saved', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 16 * MBIT, updatedAt: 0 });
    const afterHours = createBandwidthMemory({ storage, now: () => DAY - 1 });
    await afterHours.load();
    expect(afterHours.maxBitrate()).toBe(16 * MBIT);
    const afterTwoDays = createBandwidthMemory({ storage, now: () => 2 * DAY + 5 });
    await afterTwoDays.load();
    expect(afterTwoDays.maxBitrate()).toBe(25 * MBIT);
    // Never past the default, however long it has been.
    const afterAYear = createBandwidthMemory({ storage, now: () => 365 * DAY });
    await afterAYear.load();
    expect(afterAYear.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    // Reading does not rewrite what was saved, so the days keep counting from the save.
    expect(await storage.get('bandwidth')).toEqual({ maxBitrate: 16 * MBIT, updatedAt: 0 });
  });

  it('leaves a raised limit, or one saved without a time, as it was', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 60 * MBIT, updatedAt: 0 });
    const raised = createBandwidthMemory({ storage, now: () => 10 * DAY });
    await raised.load();
    expect(raised.maxBitrate()).toBe(60 * MBIT);
    await storage.set('bandwidth', { maxBitrate: 16 * MBIT });
    const untimed = createBandwidthMemory({ storage, now: () => 10 * DAY });
    await untimed.load();
    expect(untimed.maxBitrate()).toBe(16 * MBIT);
  });

  it('ignores bitrates that are not a rate', async () => {
    const storage = countingStorage();
    const memory = await loaded(storage);
    for (const bitrate of [0, -1, NaN, Infinity, -Infinity, '30' as unknown as number]) {
      memory.struggled(bitrate);
      memory.smooth(bitrate);
    }
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    await settle();
    expect(storage.writes).toBe(0);
  });

  it('stores only the limit and when it changed, and only when it changed', async () => {
    const storage = countingStorage();
    const memory = await loaded(storage);
    memory.struggled(30 * MBIT);
    await settle();
    expect(await storage.get('bandwidth')).toEqual({ maxBitrate: 22.5 * MBIT, updatedAt: 1000 });
    expect(storage.writes).toBe(1);

    memory.struggled(72 * MBIT);
    memory.smooth(5 * MBIT);
    await settle();
    expect(storage.writes).toBe(1);
  });

  it('loads a stored limit, kept within the floor and the ceiling', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 18 * MBIT, updatedAt: 1 });
    expect((await loaded(storage)).maxBitrate()).toBe(18 * MBIT);

    await storage.set('bandwidth', { maxBitrate: 1 * MBIT, updatedAt: 1 });
    expect((await loaded(storage)).maxBitrate()).toBe(4 * MBIT);

    await storage.set('bandwidth', { maxBitrate: 900 * MBIT, updatedAt: 1 });
    expect((await loaded(storage)).maxBitrate()).toBe(200 * MBIT);
  });

  it('ignores a stored value that is not a limit', async () => {
    const storage = memoryKeyValueStore();
    for (const stored of [null, 'fast', 42, {}, { maxBitrate: '30' }, { maxBitrate: NaN }]) {
      await storage.set('bandwidth', stored);
      expect((await loaded(storage)).maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    }
  });

  it('survives a restart', async () => {
    const storage = memoryKeyValueStore();
    const first = await loaded(storage);
    first.struggled(30 * MBIT);
    await settle();

    const second = await loaded(storage);
    expect(second.maxBitrate()).toBe(22.5 * MBIT);
  });

  it('applies a change made before loading finished on top of the stored limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 20 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    // Against the default this would only lower the limit to 30 Mbit/s.
    memory.struggled(24 * MBIT);
    expect(memory.maxBitrate()).toBe(18 * MBIT);
    await memory.load();
    expect(memory.maxBitrate()).toBe(18 * MBIT);

    const again = createBandwidthMemory({ storage, now: () => 1000 });
    again.struggled(40 * MBIT);
    expect(again.maxBitrate()).toBe(30 * MBIT);
    await again.load();
    // The stored 18 Mbit/s is already below 75% of 40.
    expect(again.maxBitrate()).toBe(18 * MBIT);
    await settle();
    expect(await storage.get('bandwidth')).toEqual({ maxBitrate: 18 * MBIT, updatedAt: 1000 });
  });

  it('applies changes made while loading in the order they were made', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 10 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    const loading = memory.load();
    memory.struggled(16 * MBIT);
    // Under half of 12, so it lifts nothing yet.
    memory.smooth(5 * MBIT);
    expect(memory.maxBitrate()).toBe(12 * MBIT);
    await loading;
    // The stored 10 is already below 75% of 16, then creeps up by a quarter.
    // The other way round it would end at 12.
    expect(memory.maxBitrate()).toBe(12.5 * MBIT);
  });

  it('saves a change made before loading that only matters to the stored limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 20 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    // Changes nothing against the default, but creeps the stored 20 Mbit/s up.
    memory.smooth(18 * MBIT);
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    await memory.load();
    expect(memory.maxBitrate()).toBe(25 * MBIT);
    await settle();
    expect(await storage.get('bandwidth')).toEqual({ maxBitrate: 25 * MBIT, updatedAt: 1000 });
  });

  it('carries on in memory when storage fails', async () => {
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error('disk full')),
      set: () => Promise.reject(new Error('disk full')),
    };
    const memory = createBandwidthMemory({ storage: broken });
    memory.struggled(30 * MBIT);
    await memory.load();
    expect(memory.maxBitrate()).toBe(22.5 * MBIT);
    expect(() => memory.smooth(60 * MBIT)).not.toThrow();
    await settle();
    expect(memory.maxBitrate()).toBe(60 * MBIT);
  });

  it('is safe to load more than once', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 20 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage });
    await memory.load();
    memory.struggled(20 * MBIT);
    await memory.load();
    expect(memory.maxBitrate()).toBe(15 * MBIT);
  });

  it('tells subscribers each time the limit changes, and only then', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 20 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    let calls = 0;
    const unsubscribe = memory.subscribe(() => calls++);
    await memory.load();
    expect(calls).toBe(1);

    memory.struggled(20 * MBIT);
    expect(calls).toBe(2);
    // Already below 75% of this one.
    memory.struggled(30 * MBIT);
    memory.smooth(1 * MBIT);
    memory.smooth(NaN);
    expect(calls).toBe(2);
    memory.smooth(50 * MBIT);
    expect(calls).toBe(3);

    unsubscribe();
    memory.struggled(10 * MBIT);
    expect(memory.maxBitrate()).toBe(7.5 * MBIT);
    expect(calls).toBe(3);
  });

  it('does not tell subscribers when the stored limit is the default', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: DEFAULT_MAX_BITRATE, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage });
    let calls = 0;
    memory.subscribe(() => calls++);
    await memory.load();
    expect(calls).toBe(0);
  });
});
