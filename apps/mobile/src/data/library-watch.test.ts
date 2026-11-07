import { describe, expect, it } from 'vitest';
import { libraryWatch, type Versioned } from './library-watch';

function fakeStore(): Versioned & { change(): void; listeners: number } {
  const listeners = new Set<() => void>();
  let changes = 0;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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

describe("the Library screen's watch", () => {
  it('has My List follow the list alone, not progress or the played cards', () => {
    const list = fakeStore();
    const progress = fakeStore();
    const played = fakeStore();
    const watch = libraryWatch('list', list, [progress, played]);
    let told = 0;
    const stop = watch.subscribe(() => (told += 1));
    const before = watch.version();

    progress.change();
    played.change();
    expect(told).toBe(0);
    expect(watch.version()).toBe(before);
    expect(progress.listeners).toBe(0);

    list.change();
    expect(told).toBe(1);
    expect(watch.version()).not.toBe(before);

    stop();
    expect(list.listeners).toBe(0);
  });

  it('has History follow the list, progress and the played cards', () => {
    const list = fakeStore();
    const progress = fakeStore();
    const played = fakeStore();
    const watch = libraryWatch('history', list, [progress, played]);
    let told = 0;
    const stop = watch.subscribe(() => (told += 1));
    const versions = [watch.version()];

    for (const store of [list, progress, played]) {
      store.change();
      versions.push(watch.version());
    }
    expect(told).toBe(3);
    expect(new Set(versions).size).toBe(4);

    stop();
    expect([list.listeners, progress.listeners, played.listeners]).toEqual([0, 0, 0]);
  });

  it('never gives the two views the same version', () => {
    const list = fakeStore();
    expect(libraryWatch('list', list, []).version()).not.toBe(
      libraryWatch('history', list, []).version(),
    );
  });
});
