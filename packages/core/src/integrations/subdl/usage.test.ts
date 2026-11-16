import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../../storage';
import { createSubdlUsage, SUBDL_DOWNLOADS_PER_DAY, SUBDL_SEARCHES_PER_DAY } from './usage';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function setup(start = Date.UTC(2026, 10, 16, 12, 0)) {
  const storage = memoryKeyValueStore();
  let now = start;
  const usage = createSubdlUsage({ storage, now: () => now });
  await usage.load();
  return {
    storage,
    usage,
    at: (time: number) => {
      now = time;
    },
    pass: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe('createSubdlUsage', () => {
  it('counts searches and downloads up to their caps, and starts again on a new UTC day', async () => {
    const { usage, storage, at } = await setup(Date.UTC(2026, 10, 16, 23, 50));
    for (let i = 0; i < SUBDL_SEARCHES_PER_DAY; i++) expect(usage.takeSearch()).toBe(true);
    expect(usage.takeSearch()).toBe(false);
    for (let i = 0; i < SUBDL_DOWNLOADS_PER_DAY; i++) expect(usage.takeDownload()).toBe(true);
    expect(usage.takeDownload()).toBe(false);
    await Promise.resolve();
    expect(await storage.get('subdl/usage')).toEqual({
      day: '2026-11-16',
      searches: SUBDL_SEARCHES_PER_DAY,
      downloads: SUBDL_DOWNLOADS_PER_DAY,
    });
    at(Date.UTC(2026, 10, 17, 0, 1));
    expect(usage.takeSearch()).toBe(true);
    expect(usage.takeDownload()).toBe(true);
  });

  it('keeps the counts across launches', async () => {
    const { usage, storage, now } = await setup();
    usage.takeSearch();
    usage.takeSearch();
    await Promise.resolve();
    const again = createSubdlUsage({ storage, now });
    await again.load();
    for (let i = 2; i < SUBDL_SEARCHES_PER_DAY; i++) again.takeSearch();
    expect(again.takeSearch()).toBe(false);
  });

  it('rests an hour on a first slow-down, doubling to a day while SubDL keeps asking', async () => {
    const { usage, pass, now } = await setup();
    usage.rest('busy');
    expect(usage.resting()).toEqual({ why: 'busy', until: now() + HOUR });
    pass(HOUR);
    expect(usage.resting()).toBeNull();
    usage.rest('busy');
    expect(usage.resting()!.until - now()).toBe(2 * HOUR);
    for (const hours of [4, 8, 16, 24, 24]) {
      pass(usage.resting()!.until - now());
      usage.rest('busy');
      expect(usage.resting()!.until - now()).toBe(hours * HOUR);
    }
  });

  it('starts the doubling again after an answer, or after a day with no slow-down', async () => {
    const { usage, pass, now } = await setup();
    usage.rest('busy');
    pass(HOUR);
    usage.rest('busy');
    pass(2 * HOUR);
    usage.succeeded();
    usage.rest('busy');
    expect(usage.resting()!.until - now()).toBe(HOUR);
    pass(HOUR);
    usage.rest('busy');
    expect(usage.resting()!.until - now()).toBe(2 * HOUR);
    // A day after that rest ended.
    pass(2 * HOUR + 24 * HOUR);
    usage.rest('busy');
    expect(usage.resting()!.until - now()).toBe(HOUR);
  });

  it('rests until 5 minutes past UTC midnight on a daily limit', async () => {
    const { usage } = await setup(Date.UTC(2026, 10, 16, 20, 30));
    usage.rest('limit');
    expect(usage.resting()).toEqual({ why: 'limit', until: Date.UTC(2026, 10, 17, 0, 5) });
  });

  it('keeps a daily limit to the key that reached it, beside the screen’s own rests', async () => {
    const { usage, storage, now } = await setup(Date.UTC(2026, 10, 16, 20, 30));
    const until = Date.UTC(2026, 10, 17, 0, 5);
    usage.rest('limit', 'FAKE-SUBDL-KEY-0001');
    expect(usage.resting('FAKE-SUBDL-KEY-0001')).toEqual({ why: 'limit', until });
    expect(usage.resting('FAKE-SUBDL-KEY-0002')).toBeNull();
    expect(usage.resting()).toBeNull();
    usage.rest('limit', 'FAKE-SUBDL-KEY-0002');
    // A slow-down is the screen's, for every key, and leaves the limits as they are.
    usage.rest('busy');
    expect(usage.resting('FAKE-SUBDL-KEY-0003')).toEqual({ why: 'busy', until: now() + HOUR });
    expect(usage.resting('FAKE-SUBDL-KEY-0001')).toEqual({ why: 'limit', until });
    expect(usage.resting('FAKE-SUBDL-KEY-0002')).toEqual({ why: 'limit', until });
    await Promise.resolve();
    const again = createSubdlUsage({ storage, now });
    await again.load();
    expect(again.resting('FAKE-SUBDL-KEY-0001')).toEqual({ why: 'limit', until });
    expect(JSON.stringify(await storage.get('subdl/limit'))).not.toContain('FAKE-SUBDL-KEY');
  });

  it('rests 15 minutes after three failures in a row, and an answer between resets them', async () => {
    const { usage, now } = await setup();
    usage.failed();
    usage.failed();
    usage.succeeded();
    usage.failed();
    usage.failed();
    expect(usage.resting()).toBeNull();
    usage.failed();
    expect(usage.resting()).toEqual({ why: 'failing', until: now() + 15 * MINUTE });
    usage.failed();
    usage.failed();
    expect(usage.resting()!.until).toBe(now() + 15 * MINUTE);
  });

  it('ends a rest when the clock went back', async () => {
    const { usage, at, now } = await setup();
    usage.rest('busy');
    at(now() - 30 * HOUR);
    expect(usage.resting()).toBeNull();
  });

  it('tells its listeners', async () => {
    const { usage } = await setup();
    let told = 0;
    const stop = usage.subscribe(() => told++);
    usage.rest('failing');
    expect(told).toBeGreaterThan(0);
    stop();
  });
});
