import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchKind, scriptAt } from './boot';

afterEach(() => {
  vi.restoreAllMocks();
});

function navigation(type: string | undefined) {
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((kind) =>
    kind === 'navigation' && type ? ([{ type }] as unknown as PerformanceEntryList) : [],
  );
}

describe('launchKind', () => {
  it('tells a start of the app from the app starting itself again', () => {
    navigation('navigate');
    expect(launchKind()).toBe('cold');
    navigation('reload');
    expect(launchKind()).toBe('reload');
    navigation('back_forward');
    expect(launchKind()).toBe('back_forward');
  });

  it('says unknown when the engine keeps no navigation entry, or throws', () => {
    navigation(undefined);
    expect(launchKind()).toBe('unknown');
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('no');
    });
    expect(launchKind()).toBe('unknown');
  });
});

describe('scriptAt', () => {
  it('is read from the page clock as the module first runs', () => {
    expect(scriptAt).toBeGreaterThan(0);
    expect(scriptAt).toBeLessThanOrEqual(performance.now());
  });
});
