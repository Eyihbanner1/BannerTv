import { describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => {
  function fakeStore() {
    const listeners = new Set<() => void>();
    let changes = 0;
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      version: () => changes,
      change() {
        changes += 1;
        listeners.forEach((listener) => listener());
      },
      get listeners() {
        return listeners.size;
      },
    };
  }
  return { library: fakeStore(), progress: fakeStore(), played: fakeStore() };
});

vi.mock('./library', () => ({ library: stores.library, watchedSet: { has: () => false } }));
vi.mock('./playback', () => ({ progress: stores.progress, playedVideos: stores.played }));
vi.mock('./addons', () => ({ addonClient: {} }));
vi.mock('./profiles', () => ({ isKidsProfile: () => false }));
vi.mock('./tmdb', () => ({ tmdbClient: {}, useTmdbOn: () => false }));

import { calendarWatch } from './calendar';

const all = [stores.library, stores.progress, stores.played];

describe("the calendar's watch", () => {
  it('follows nothing while the calendar is off, so a video saving its place redraws nothing', () => {
    const watch = calendarWatch(false);
    let told = 0;
    const stop = watch.subscribe(() => (told += 1));
    const before = watch.version();

    for (const store of all) store.change();
    expect(told).toBe(0);
    expect(watch.version()).toBe(before);
    for (const store of all) expect(store.listeners).toBe(0);
    stop();
  });

  it('follows My List, the history and the played videos while it is on show', () => {
    const watch = calendarWatch(true);
    let told = 0;
    const stop = watch.subscribe(() => (told += 1));
    const versions = [watch.version()];

    for (const store of all) {
      store.change();
      versions.push(watch.version());
    }
    expect(told).toBe(3);
    expect(new Set(versions).size).toBe(4);

    stop();
    for (const store of all) expect(store.listeners).toBe(0);
  });

  it('is the same watch each render, so it is not subscribed again', () => {
    expect(calendarWatch(true)).toBe(calendarWatch(true));
    expect(calendarWatch(false)).toBe(calendarWatch(false));
  });
});
