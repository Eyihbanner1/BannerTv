import type { InstalledAddon, QueryState } from '@bannertv/core';
import { parseStream, type Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entryKey, streamFinder } from './finder';

interface FakeQuery {
  listeners: Set<() => void>;
  state: QueryState<Stream[]>;
}

/** Each video's answers, one per install, as the addon client would give them. */
const addons = vi.hoisted(() => ({
  installs: [] as Array<{ id: string; streams: string[] }>,
  queries: {} as Record<string, FakeQuery[]>,
  answering: true,
}));

vi.mock('../data/addons', () => ({
  addonClient: {
    streams: (_type: string, videoId: string) =>
      addons.installs.map((install, i) => {
        const query: FakeQuery = {
          listeners: new Set(),
          state: addons.answering
            ? {
                status: 'success',
                stale: false,
                data: install.streams.map((url) => parseStream({ url, name: 'Test\n1080p' })!),
              }
            : { status: 'loading', stale: false },
        };
        (addons.queries[videoId] = addons.queries[videoId] ?? [])[i] = query;
        return {
          addon: {
            transportUrl: `https://${i}.example.com/manifest.json`,
            manifest: { id: install.id, name: install.id },
          } as unknown as InstalledAddon,
          query: {
            get: () => query.state,
            subscribe: (listener: () => void) => {
              query.listeners.add(listener);
              return () => query.listeners.delete(listener);
            },
            load: () => undefined,
            retry: () => undefined,
          },
        };
      }),
  },
}));
vi.mock('../data/playback', () => ({ sourceMemory: { score: () => 0.5 } }));

const listening = (videoId: string) =>
  (addons.queries[videoId] ?? []).reduce((sum, query) => sum + query.listeners.size, 0);

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  addons.installs = [{ id: 'org.test.streams', streams: ['https://media.example.com/a.mp4'] }];
  addons.answering = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('streamFinder', () => {
  it('stops following the answers of a finder it replaces after five minutes', () => {
    streamFinder('movie', 'tt-old').start();
    expect(listening('tt-old')).toBe(1);
    vi.advanceTimersByTime(6 * 60 * 1000);
    streamFinder('movie', 'tt-old');
    expect(listening('tt-old')).toBe(0);
  });

  it('stops following the answers of the oldest finder once more than eight are kept', () => {
    for (let i = 0; i < 9; i++) streamFinder('movie', `tt-many-${i}`).start();
    expect(listening('tt-many-0')).toBe(0);
    expect(listening('tt-many-8')).toBe(1);
  });

  it('lets a player waiting on a dropped finder go on', async () => {
    addons.answering = false;
    const waiting = streamFinder('movie', 'tt-waiting').choose();
    for (let i = 0; i < 9; i++) streamFinder('movie', `tt-other-${i}`);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('keeps two installs of one addon apart', () => {
    addons.installs = [
      { id: 'org.test.streams', streams: ['https://media.example.com/rd.mp4'] },
      { id: 'org.test.streams', streams: ['https://media.example.com/ad.mp4'] },
    ];
    const finder = streamFinder('movie', 'tt-twice');
    finder.start();
    const [first, second] = finder.get().entries;
    expect(entryKey(first!)).not.toBe(entryKey(second!));

    finder.markFailed(first!);
    expect(finder.get().candidates.map((entry) => entry.stream)).toEqual([second!.stream]);
    expect(finder.next(new Set([entryKey(first!)]))?.stream).toBe(second!.stream);
  });
});
