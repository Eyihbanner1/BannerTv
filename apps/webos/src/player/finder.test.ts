import type { InstalledAddon, QueryState } from '@bannertv/core';
import { parseStream, type Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entryKey, isHeavy, streamFinder } from './finder';

interface FakeQuery {
  listeners: Set<() => void>;
  state: QueryState<Stream[]>;
}

/** Each video's answers, one per install, as the addon client would give them. */
const addons = vi.hoisted(() => ({
  // A link alone stands for a 1080p stream of unknown size.
  installs: [] as Array<{ id: string; streams: Array<string | Record<string, unknown>> }>,
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
                data: install.streams.map((raw) =>
                  parseStream(typeof raw === 'string' ? { url: raw, name: 'Test\n1080p' } : raw)!,
                ),
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
// The connection's limit, which a test can lower as the session would after buffering.
const limit = vi.hoisted(() => ({ maxBitrate: 40e6, listeners: new Set<() => void>() }));

vi.mock('../data/playback', () => ({
  sourceMemory: { score: () => 0.5 },
  bandwidth: {
    maxBitrate: () => limit.maxBitrate,
    subscribe: (listener: () => void) => {
      limit.listeners.add(listener);
      return () => limit.listeners.delete(listener);
    },
  },
}));

// Links with "broken" in them fail their test; the rest take too long to answer.
vi.mock('./probe', () => ({
  probeStream: (url: string) => Promise.resolve(url.includes('broken') ? 'failed' : 'slow'),
  cancelProbes: () => undefined,
  holdProbes: () => () => undefined,
}));

/** A stream as an addon offers it, with its resolution in the name and its size in gigabytes. */
const offer = (file: string, resolution: string, gigabytes?: number) => ({
  url: `https://media.example.com/${file}.mkv`,
  name: `Test\n${resolution}`,
  behaviorHints: gigabytes === undefined ? {} : { videoSize: gigabytes * 1e9 },
});

/** Which offer a stream is, by its file name. */
function fileOf(entry: { stream: Stream } | undefined): string | undefined {
  const source = entry?.stream.source;
  return source?.kind === 'url' ? /([^/]+)\.mkv$/.exec(source.url)?.[1] : undefined;
}

const files = (entries: ReadonlyArray<{ stream: Stream }>) => entries.map(fileOf);

function lowerLimit(maxBitrate: number) {
  limit.maxBitrate = maxBitrate;
  limit.listeners.forEach((listener) => listener());
}

const listening = (videoId: string) =>
  (addons.queries[videoId] ?? []).reduce((sum, query) => sum + query.listeners.size, 0);

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  addons.installs = [{ id: 'org.test.streams', streams: ['https://media.example.com/a.mp4'] }];
  addons.answering = true;
  limit.maxBitrate = 40e6;
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

  it('tells a screen still following an expired finder only after the call that replaced it', async () => {
    addons.answering = false;
    const old = streamFinder('movie', 'tt-held');
    old.start();
    const heard = vi.fn();
    old.subscribe(heard);
    vi.advanceTimersByTime(6 * 60 * 1000);
    // All streams asks during its render, while the player still follows the old finder.
    streamFinder('movie', 'tt-held');
    expect(heard).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(heard).toHaveBeenCalled();
    expect(old.get().settled).toBe(true);
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

describe('stepping down', () => {
  // Over two hours: 80, 60, about 33, 28 and 22 Mbit/s.
  const streams = [
    offer('big', '2160p', 72),
    offer('almost', '2160p', 54),
    offer('tried', '1080p', 30),
    offer('broken', '1080p', 25),
    offer('light', '1080p', 20),
  ];

  it('offers the best stream needing at most 70% of the data, skipping tried and failed links', () => {
    addons.installs = [{ id: 'org.test.streams', streams }];
    const finder = streamFinder('movie', 'tt-lighter');
    finder.start();
    const byFile = (file: string) => finder.get().entries.find((entry) => fileOf(entry) === file)!;
    const big = byFile('big');
    expect(fileOf(finder.lighter(big, new Set([entryKey(big)])))).toBe('tried');

    const tried = new Set([entryKey(big), entryKey(byFile('tried'))]);
    finder.markFailed(byFile('broken'));
    expect(fileOf(finder.lighter(big, tried))).toBe('light');
    // 60 Mbit/s is not enough of a step from 80.
    tried.add(entryKey(byFile('light')));
    expect(finder.lighter(big, tried)).toBeUndefined();
  });

  it('skips a link whose test failed', async () => {
    addons.installs = [{ id: 'org.test.streams', streams }];
    const finder = streamFinder('movie', 'tt-lighter-probed');
    finder.start();
    finder.probe();
    await vi.waitFor(() => expect(Object.keys(finder.get().probes)).toHaveLength(3));
    const [tried, broken, light] = finder.get().candidates;
    expect(files([tried!, broken!, light!])).toEqual(['tried', 'broken', 'light']);
    const big = finder.get().entries[0]!;
    expect(finder.lighter(big, new Set([entryKey(big), entryKey(tried!)]))).toBe(light);
  });

  it('steps down by resolution when sizes are unknown', () => {
    addons.installs = [
      {
        id: 'org.test.streams',
        streams: [offer('uhd', '2160p'), offer('uhd-other', '2160p'), offer('hd', '1080p')],
      },
    ];
    const finder = streamFinder('movie', 'tt-lighter-unsized');
    finder.start();
    const [uhd, other, hd] = finder.get().candidates;
    expect(files([uhd!, other!, hd!])).toEqual(['uhd', 'uhd-other', 'hd']);
    expect(finder.lighter(uhd!, new Set([entryKey(uhd!)]))).toBe(hd);
    expect(finder.lighter(hd!, new Set([entryKey(hd!)]))).toBeUndefined();
  });
});

describe('heavy streams', () => {
  // About 33 Mbit/s over two hours, 89 over 45 minutes; the small one 10 and 27.
  const streams = [offer('big', '2160p', 30), offer('small', '1080p', 9)];

  it('assumes two hours for a film and one for an episode until the running time is known', () => {
    expect(streamFinder('movie', 'tt-runtime').runtimeSeconds()).toBe(7200);
    const episode = streamFinder('series', 'tt-runtime:1:1');
    expect(episode.runtimeSeconds()).toBe(3600);
    episode.setRuntime(NaN);
    episode.setRuntime(0);
    expect(episode.runtimeSeconds()).toBe(3600);
    episode.setRuntime(2700);
    expect(episode.runtimeSeconds()).toBe(2700);
  });

  it('ranks a big file below a smaller one when the video turns out short', () => {
    addons.installs = [{ id: 'org.test.streams', streams }];
    const finder = streamFinder('movie', 'tt-short');
    finder.start();
    expect(files(finder.get().candidates)).toEqual(['big', 'small']);
    const heard = vi.fn();
    finder.subscribe(heard);

    finder.setRuntime(45 * 60);
    expect(heard).toHaveBeenCalled();
    expect(files(finder.get().candidates)).toEqual(['small', 'big']);
    expect(isHeavy(finder.get().candidates[1]!, finder.runtimeSeconds())).toBe(true);

    finder.setRuntime(3 * 3600);
    expect(files(finder.get().candidates)).toEqual(['big', 'small']);
  });

  it('ranks again when the limit is lowered, and stops following it when let go', () => {
    addons.installs = [{ id: 'org.test.streams', streams }];
    const finder = streamFinder('movie', 'tt-limit');
    finder.start();
    expect(files(finder.get().candidates)).toEqual(['big', 'small']);
    const following = limit.listeners.size;

    lowerLimit(25e6);
    expect(files(finder.get().candidates)).toEqual(['small', 'big']);

    finder.destroy();
    expect(limit.listeners.size).toBe(following - 1);
  });
});
