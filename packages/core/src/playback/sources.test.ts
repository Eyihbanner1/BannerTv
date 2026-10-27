import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { createSourceMemory } from './sources';

// Lets the chained storage writes finish. Core has no timers.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('createSourceMemory', () => {
  it('scores an addon by how often its streams played', () => {
    const memory = createSourceMemory({ storage: memoryKeyValueStore() });
    expect(memory.score('org.torrentio')).toBe(0.5);
    memory.record('org.torrentio', true);
    memory.record('org.torrentio', true);
    memory.record('com.flaky', false);
    expect(memory.score('org.torrentio')).toBe(0.75);
    expect(memory.score('com.flaky')).toBeCloseTo(1 / 3);
  });

  it('keeps counts small, so a change in an addon shows up', () => {
    const memory = createSourceMemory({ storage: memoryKeyValueStore() });
    for (let i = 0; i < 40; i++) memory.record('a', true);
    for (let i = 0; i < 10; i++) memory.record('a', false);
    expect(memory.score('a')).toBeLessThan(0.6);
  });

  it('survives a restart, adding a record made while loading to what was saved', async () => {
    const storage = memoryKeyValueStore();
    const first = createSourceMemory({ storage });
    first.record('a', false);
    first.record('b', true);
    await settle();

    const second = createSourceMemory({ storage });
    second.record('a', true);
    await second.load();
    // One failure from the first launch and one success from this one.
    expect(second.score('a')).toBeCloseTo(2 / 4);
    expect(second.score('b')).toBeCloseTo(2 / 3);
    await settle();

    const third = createSourceMemory({ storage });
    await third.load();
    expect(third.score('a')).toBeCloseTo(2 / 4);
  });

  it('ignores unreadable storage and storage that fails', async () => {
    const broken = {
      get: () =>
        Promise.resolve({ a: { worked: 'x' }, b: null, c: { worked: 1, failed: 0, updatedAt: 1 } }),
      set: () => Promise.reject(new Error('disk full')),
    };
    const memory = createSourceMemory({ storage: broken });
    await memory.load();
    expect(memory.score('a')).toBe(0.5);
    expect(memory.score('c')).toBeCloseTo(2 / 3);
    expect(() => memory.record('c', true)).not.toThrow();
  });
});
