import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { DEFAULT_MAX_BITRATE } from '../streams/bitrate';
import { createBandwidthMemory } from './bandwidth';

const MBIT = 1e6;
const DAY = 24 * 60 * 60 * 1000;

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('createBandwidthMemory, per debrid service', () => {
  it('does not carry a rate one service proved over to another', async () => {
    // A 70 Mbit/s remux played smoothly from Real-Debrid, before limits were kept per service.
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 70 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    await memory.load();
    expect(memory.maxBitrate()).toBe(70 * MBIT);
    // TorBox starts from the default, not from Real-Debrid's raise.
    expect(memory.maxBitrate('TB')).toBe(DEFAULT_MAX_BITRATE);
  });

  it('starts a new service from a lowered general limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 18 * MBIT, updatedAt: 1 });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    await memory.load();
    // A slow home connection holds whichever service the link goes through.
    expect(memory.maxBitrate('TB')).toBe(18 * MBIT);
  });

  it('keeps what one service learns to that service', async () => {
    const memory = createBandwidthMemory({ storage: memoryKeyValueStore(), now: () => 1000 });
    await memory.load();
    memory.smooth(70 * MBIT, 'RD');
    memory.struggled(36 * MBIT, undefined, 'TB');
    expect(memory.maxBitrate('RD')).toBe(70 * MBIT);
    expect(memory.maxBitrate('TB')).toBe(27 * MBIT);
    expect(memory.maxBitrate()).toBe(DEFAULT_MAX_BITRATE);
    // Links that go through no service use the general limit.
    memory.struggled(20 * MBIT);
    expect(memory.maxBitrate()).toBe(15 * MBIT);
    expect(memory.maxBitrate('RD')).toBe(70 * MBIT);
    expect(memory.maxBitrate('TB')).toBe(27 * MBIT);
  });

  it('undoes a service raise when the same stream later kept buffering', async () => {
    const memory = createBandwidthMemory({ storage: memoryKeyValueStore(), now: () => 1000 });
    await memory.load();
    const before = memory.maxBitrate('TB');
    memory.smooth(60 * MBIT, 'TB');
    expect(memory.maxBitrate('TB')).toBe(60 * MBIT);
    memory.struggled(60 * MBIT, before, 'TB');
    expect(memory.maxBitrate('TB')).toBe(DEFAULT_MAX_BITRATE);
  });

  it('treats a name that is not a service code as no service', async () => {
    const memory = createBandwidthMemory({ storage: memoryKeyValueStore(), now: () => 1000 });
    await memory.load();
    for (const odd of ['', '__proto__', 'not a code', 'TOOLONGCODE']) {
      memory.struggled(30 * MBIT, undefined, odd);
    }
    expect(memory.maxBitrate()).toBe(22.5 * MBIT);
    expect(memory.maxBitrate('__proto__')).toBe(22.5 * MBIT);
  });

  it('reads service codes in any case', async () => {
    const memory = createBandwidthMemory({ storage: memoryKeyValueStore(), now: () => 1000 });
    await memory.load();
    memory.struggled(30 * MBIT, undefined, 'tb');
    expect(memory.maxBitrate('TB')).toBe(22.5 * MBIT);
  });

  it('stores each service with its own time and survives a restart', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', { maxBitrate: 30 * MBIT, updatedAt: 1 });
    let time = 1000;
    const first = createBandwidthMemory({ storage, now: () => time });
    await first.load();
    time = 5000;
    first.struggled(32 * MBIT, undefined, 'TB');
    await settle();
    // The general limit did not change, so it keeps its own save time.
    expect(await storage.get('bandwidth')).toEqual({
      maxBitrate: 30 * MBIT,
      updatedAt: 1,
      services: { TB: { maxBitrate: 24 * MBIT, updatedAt: 5000 } },
    });
    const second = createBandwidthMemory({ storage, now: () => 6000 });
    await second.load();
    expect(second.maxBitrate()).toBe(30 * MBIT);
    expect(second.maxBitrate('TB')).toBe(24 * MBIT);
  });

  it('lifts a lowered service limit for each full day since it was saved', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', {
      maxBitrate: DEFAULT_MAX_BITRATE,
      updatedAt: 0,
      services: { TB: { maxBitrate: 16 * MBIT, updatedAt: 0 } },
    });
    const memory = createBandwidthMemory({ storage, now: () => 2 * DAY + 5 });
    await memory.load();
    expect(memory.maxBitrate('TB')).toBe(25 * MBIT);
  });

  it('ignores stored service limits that are not limits', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', {
      maxBitrate: 30 * MBIT,
      updatedAt: 1,
      services: { TB: 'fast', RD: { maxBitrate: NaN }, 'bad key': { maxBitrate: 5 * MBIT } },
    });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    await memory.load();
    expect(memory.maxBitrate('TB')).toBe(30 * MBIT);
    expect(memory.maxBitrate('RD')).toBe(30 * MBIT);
    expect(memory.maxBitrate()).toBe(30 * MBIT);
  });

  it('applies a service change made before loading on top of what was stored', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('bandwidth', {
      maxBitrate: 40 * MBIT,
      updatedAt: 1,
      services: { TB: { maxBitrate: 20 * MBIT, updatedAt: 1 } },
    });
    const memory = createBandwidthMemory({ storage, now: () => 1000 });
    // Against the default this would only lower TorBox to 30 Mbit/s.
    memory.struggled(24 * MBIT, undefined, 'TB');
    await memory.load();
    expect(memory.maxBitrate('TB')).toBe(18 * MBIT);
    await settle();
    expect(await storage.get('bandwidth')).toEqual({
      maxBitrate: 40 * MBIT,
      updatedAt: 1,
      services: { TB: { maxBitrate: 18 * MBIT, updatedAt: 1000 } },
    });
  });

  it('tells subscribers when a service limit changes', async () => {
    const memory = createBandwidthMemory({ storage: memoryKeyValueStore(), now: () => 1000 });
    await memory.load();
    let calls = 0;
    memory.subscribe(() => calls++);
    memory.struggled(30 * MBIT, undefined, 'TB');
    expect(calls).toBe(1);
    // Already below 75% of this one.
    memory.struggled(40 * MBIT, undefined, 'TB');
    expect(calls).toBe(1);
  });
});
