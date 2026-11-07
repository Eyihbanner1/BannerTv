import type { QueryState } from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const switches = vi.hoisted(() => ({ marks: true }));
vi.mock('../platform/tuning', () => ({ tuning: switches }));

const reads = vi.hoisted(() => ({
  layout: Promise.resolve(),
  progress: Promise.resolve(),
  played: Promise.resolve(),
}));

vi.mock('../data/addons', async () => {
  const { createStore } = await import('@bannertv/core');
  return { addonCollection: createStore({ ready: false, addons: [] }) };
});
vi.mock('../data/library', () => ({ homeLayout: { load: () => reads.layout } }));
vi.mock('../data/playback', () => ({
  progress: { load: () => reads.progress },
  playedVideos: { load: () => reads.played },
}));

const idle: QueryState<string[]> = { status: 'idle', stale: false };
const loading: QueryState<string[]> = { status: 'loading', stale: false };
const filled = (stale: boolean): QueryState<string[]> => ({
  status: 'success',
  data: ['tt1'],
  stale,
});

/** A fresh copy of the modules, so marks made by another test are forgotten. */
async function load() {
  vi.resetModules();
  return import('./boot-marks');
}

let made: string[];

beforeEach(() => {
  made = [];
  vi.spyOn(performance, 'mark').mockImplementation((name: string) => {
    made.push(name);
    return undefined as never;
  });
  vi.stubGlobal('window', {});
});

afterEach(() => {
  switches.marks = true;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('rowFills', () => {
  it('tells a row filled from the cache, then refreshed by its addon', async () => {
    const { rowFills } = await load();
    const fills = rowFills();
    expect(fills(idle)).toBeUndefined();
    // An older copy, shown while a fresh one is fetched.
    expect(fills(filled(true))).toBe('cached');
    expect(fills(filled(false))).toBe('network');
  });

  it('tells a row with a fresh copy as cached, and one with none as network', async () => {
    const { rowFills } = await load();
    const fresh = rowFills();
    fresh(idle);
    expect(fresh(filled(false))).toBe('cached');
    const none = rowFills();
    none(idle);
    expect(none(loading)).toBeUndefined();
    expect(none(filled(false))).toBe('network');
  });

  it('says nothing of a row already filled when drawn, until it is fetched again', async () => {
    const { rowFills } = await load();
    const fills = rowFills();
    const shown = filled(false);
    expect(fills(shown)).toBeUndefined();
    expect(fills(shown)).toBeUndefined();
    expect(fills(filled(false))).toBe('network');
  });

  it('counts an old copy kept because the addon failed as no fill', async () => {
    const { rowFills } = await load();
    const fills = rowFills();
    fills(idle);
    expect(fills({ ...filled(true), error: new Error('down') })).toBeUndefined();
    expect(fills({ status: 'error', error: new Error('down'), stale: false })).toBeUndefined();
  });
});

describe('startBootMarks', () => {
  it('marks the reads of the launch once each, and sets the reader', async () => {
    const { startBootMarks } = await load();
    const { addonCollection } = (await import('../data/addons')) as unknown as {
      addonCollection: { set: (value: { ready: boolean; addons: [] }) => void };
    };
    startBootMarks();
    await Promise.resolve();
    await Promise.resolve();
    expect(made).toEqual(['boot:script', 'boot:layout-read', 'boot:continue-read']);
    addonCollection.set({ ready: true, addons: [] });
    addonCollection.set({ ready: true, addons: [] });
    expect(made).toEqual([
      'boot:script',
      'boot:layout-read',
      'boot:continue-read',
      'boot:addons-read',
    ]);
    expect(typeof (window as Window).__bannertvBoot).toBe('function');
  });

  it('does nothing with the marks switch off, as it ships', async () => {
    switches.marks = false;
    const { startBootMarks } = await load();
    startBootMarks();
    await Promise.resolve();
    await Promise.resolve();
    expect(made).toEqual([]);
    expect((window as Window).__bannertvBoot).toBeUndefined();
  });
});

describe('readBoot', () => {
  it('lists the navigation, the first paints and the launch marks in time order', async () => {
    const entries: Record<string, unknown[]> = {
      navigation: [
        {
          type: 'reload',
          responseEnd: 4,
          domInteractive: 180,
          domContentLoadedEventEnd: 181.04,
          loadEventEnd: 0,
        },
      ],
      paint: [
        { name: 'first-paint', startTime: 420 },
        { name: 'first-contentful-paint', startTime: 1210 },
      ],
      mark: [
        { name: 'boot:script', startTime: 170 },
        { name: 'key:ArrowDown', startTime: 2000 },
        { name: 'boot:first-focus', startTime: 1500 },
        { name: 'matcher:end', startTime: 1900 },
        { name: 'matcher:end', startTime: 2600 },
      ],
    };
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      (kind) => (entries[kind] ?? []) as PerformanceEntryList,
    );
    const { readBoot } = await load();
    const report = readBoot();
    expect(report.launch).toBe('reload');
    expect(Object.entries(report.steps)).toEqual([
      ['nav:responseEnd', 4],
      ['boot:script', 170],
      ['nav:domInteractive', 180],
      ['nav:domContentLoadedEventEnd', 181],
      ['paint:first-paint', 420],
      ['paint:first-contentful-paint', 1210],
      ['boot:first-focus', 1500],
      ['matcher:end', 1900],
    ]);
  });
});
