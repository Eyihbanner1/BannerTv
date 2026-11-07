import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFETCH_REST_MS, startPrefetch } from './prefetch';

/** The one finder the tests look through, and what was asked of it. */
const fake = vi.hoisted(() => ({
  settled: false,
  listeners: new Set<() => void>(),
  created: 0,
  started: 0,
  probed: 0,
  stopped: 0,
  runtimes: [] as Array<number | undefined>,
  probing: 'on' as 'auto' | 'on' | 'off',
}));

vi.mock('./finder', () => ({
  streamFinder: () => {
    fake.created++;
    return {
      get: () => ({ settled: fake.settled }),
      subscribe: (listener: () => void) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      },
      setRuntime: (seconds: number | undefined) => fake.runtimes.push(seconds),
      start: () => fake.started++,
      probe: () => fake.probed++,
    };
  },
  stopProbing: () => fake.stopped++,
}));

vi.mock('../data/preferences', () => ({
  preferences: { get: () => ({ probing: fake.probing }) },
}));

vi.mock('../platform/android', () => ({ isAndroid: () => false }));

vi.mock('../platform/capabilities', () => ({ knownCapabilities: () => ({ webOS: 22 }) }));

function settle() {
  fake.settled = true;
  fake.listeners.forEach((listener) => listener());
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  fake.settled = false;
  fake.listeners.clear();
  fake.created = 0;
  fake.started = 0;
  fake.probed = 0;
  fake.stopped = 0;
  fake.runtimes = [];
  fake.probing = 'on';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startPrefetch', () => {
  it('asks the addons once the rest is over, then tests links once they have answered', () => {
    startPrefetch('movie', 'tt1', undefined, PREFETCH_REST_MS, '2h 10min');
    vi.advanceTimersByTime(PREFETCH_REST_MS - 1);
    expect(fake.started).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fake.started).toBe(1);
    expect(fake.runtimes).toEqual([7800]);
    expect(fake.probed).toBe(0);
    settle();
    expect(fake.probed).toBe(1);
    expect(fake.listeners.size).toBe(0);
  });

  it('asks nothing when focus moves on during the rest', () => {
    const prefetch = startPrefetch('movie', 'tt1', undefined, PREFETCH_REST_MS, undefined);
    vi.advanceTimersByTime(PREFETCH_REST_MS - 1);
    prefetch.stop();
    vi.advanceTimersByTime(PREFETCH_REST_MS);
    expect(fake.created).toBe(0);
    expect(fake.stopped).toBe(1);
  });

  it('takes a running time that arrives during the rest without waiting again', () => {
    const prefetch = startPrefetch('movie', 'tt1', undefined, PREFETCH_REST_MS, '90 min');
    vi.advanceTimersByTime(1000);
    prefetch.setRuntime('2h 10min');
    vi.advanceTimersByTime(PREFETCH_REST_MS - 1000);
    expect(fake.started).toBe(1);
    expect(fake.runtimes).toEqual([7800]);
  });

  it('hands a later running time to the finder, without stopping a link test', () => {
    const prefetch = startPrefetch('movie', 'tt1', undefined, PREFETCH_REST_MS, '90 min');
    vi.advanceTimersByTime(PREFETCH_REST_MS);
    settle();
    prefetch.setRuntime('2h 10min');
    expect(fake.runtimes).toEqual([5400, 7800]);
    expect(fake.started).toBe(1);
    expect(fake.stopped).toBe(0);
  });

  it('waits the rest it is given', () => {
    startPrefetch('movie', 'tt1', undefined, 300, undefined);
    vi.advanceTimersByTime(299);
    expect(fake.started).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fake.started).toBe(1);
  });

  it('tests no links where probing is off', () => {
    fake.probing = 'off';
    startPrefetch('movie', 'tt1', undefined, PREFETCH_REST_MS, undefined);
    vi.advanceTimersByTime(PREFETCH_REST_MS);
    settle();
    expect(fake.started).toBe(1);
    expect(fake.probed).toBe(0);
  });
});
