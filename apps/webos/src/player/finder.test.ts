import type { EventSource, InstalledAddon, ItemSource, QueryState } from '@bannertv/core';
import { parseStream, type Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackMemory } from '../data/library';
import { requestHeaderRelayChanged, setRequestHeaderRelay } from '../platform/capabilities';
import { setPreference } from '../data/preferences';
import { type Tuning, TUNING_DEFAULTS } from '../platform/tuning';
import {
  BINGE_WAIT_MS,
  entryKey,
  isHeavy,
  putPlayerFirst,
  SETTLE_AFTER_FIRST_MS,
  streamFinder,
} from './finder';

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
  // The collection that sports events' sources are found in.
  collection: [] as InstalledAddon[],
  // Every stream request made for a sports source, and every one loaded again.
  asked: [] as string[],
  loaded: [] as string[],
  // The videos put first for a player, and whether each was let go.
  first: [] as Array<{ videos: Array<{ type: string; id: string }>; released: boolean }>,
}));

vi.mock('../data/addons', () => ({
  putVideosFirst: (videos: Array<{ type: string; id: string }>) => {
    const put = { videos, released: false };
    addons.first.push(put);
    return () => (put.released = true);
  },
  addonCollection: {
    get: () => ({ ready: true, addons: addons.collection }),
    subscribe: () => () => undefined,
  },
  addonClient: {
    // One stream per source, named after the install and the item.
    streamsFrom: (sources: readonly ItemSource[]) =>
      sources.map((source) => {
        const name = `${source.addon.manifest.name}-${source.id}`;
        addons.asked.push(name);
        const state: QueryState<Stream[]> = {
          status: 'success',
          stale: false,
          data: [
            parseStream({ url: `https://media.example.com/${name}.mkv`, name: 'Test\n1080p' })!,
          ],
        };
        return {
          addon: source.addon,
          query: {
            get: () => state,
            subscribe: () => () => undefined,
            load: () => addons.loaded.push(name),
            retry: () => undefined,
          },
        };
      }),
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
// The tester's switches, which a test can change.
const tuned = vi.hoisted(() => ({}) as Tuning);

vi.mock(import('../platform/tuning'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, tuning: Object.assign(tuned, actual.TUNING_DEFAULTS) };
});

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

/** Answers one install's request, as its addon would. */
function answer(videoId: string, index: number) {
  const query = addons.queries[videoId]![index]!;
  const install = addons.installs[index]!;
  query.state = {
    status: 'success',
    stale: false,
    data: install.streams.map((raw) =>
      parseStream(typeof raw === 'string' ? { url: raw, name: 'Test\n1080p' } : raw)!,
    ),
  };
  query.listeners.forEach((listener) => listener());
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers();
  Object.assign(tuned, TUNING_DEFAULTS);
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

  it('plays streams that need request headers once a stream helper is paired, without asking again', () => {
    let paired = false;
    setRequestHeaderRelay(() => paired);
    addons.installs = [
      {
        id: 'org.test.sports',
        streams: [
          {
            url: 'https://live.example.com/match.m3u8',
            name: 'Live',
            behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example.com/' } } },
          },
        ],
      },
    ];
    const finder = streamFinder('tv', 'tt-needs-headers');
    finder.start();
    expect(finder.get().entries[0]!.assessment.action).toEqual({
      kind: 'unavailable',
      reason: 'proxy-headers',
    });
    expect(finder.get().candidates).toHaveLength(0);

    // Paired in Settings while this list was kept: the same finder, no new answers.
    paired = true;
    requestHeaderRelayChanged();
    expect(finder.get().entries[0]!.assessment.action).toEqual({ kind: 'play' });
    expect(finder.get().candidates).toHaveLength(1);
    setRequestHeaderRelay(() => false);
  });
});

describe('settling', () => {
  beforeEach(() => {
    addons.answering = false;
    addons.installs = [
      { id: 'org.test.quick', streams: ['https://media.example.com/quick.mkv'] },
      { id: 'org.test.slow', streams: ['https://media.example.com/slow.mkv'] },
    ];
  });

  it('gives slower addons two seconds once one stream could play', async () => {
    expect(TUNING_DEFAULTS.settleAfterFirstMs).toBe(SETTLE_AFTER_FIRST_MS);
    const finder = streamFinder('movie', 'tt-settle');
    finder.start();
    answer('tt-settle', 0);
    await vi.advanceTimersByTimeAsync(SETTLE_AFTER_FIRST_MS - 1);
    expect(finder.get().settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finder.get()).toMatchObject({ settled: true, pending: 1 });
  });

  it('settles as soon as every addon has answered', () => {
    const finder = streamFinder('movie', 'tt-settle-all');
    finder.start();
    answer('tt-settle-all', 0);
    answer('tt-settle-all', 1);
    expect(finder.get()).toMatchObject({ settled: true, pending: 0 });
  });

  it('marks its stages for a trace when the marks switch is on', async () => {
    tuned.marks = true;
    const finder = streamFinder('movie', 'tt-settle-marked');
    // The oldest finder it pushed out settles as it goes: not this one's.
    await vi.advanceTimersByTimeAsync(0);
    const marked: string[] = [];
    const spy = vi.spyOn(performance, 'mark').mockImplementation((name: string) => {
      marked.push(name);
      return undefined as unknown as PerformanceMark;
    });
    finder.start();
    answer('tt-settle-marked', 0);
    await vi.advanceTimersByTimeAsync(SETTLE_AFTER_FIRST_MS);
    answer('tt-settle-marked', 1);
    expect(marked).toEqual(['play:finder-start', 'play:first-stream', 'play:settled']);
    spy.mockRestore();
  });

  it('gives them the time the settleAfterFirstMs switch says', async () => {
    tuned.settleAfterFirstMs = 500;
    const finder = streamFinder('movie', 'tt-settle-tuned');
    let chosen: string | undefined = 'none yet';
    void finder.choose().then((entry) => (chosen = fileOf(entry)));
    answer('tt-settle-tuned', 0);
    await vi.advanceTimersByTimeAsync(499);
    expect(chosen).toBe('none yet');
    await vi.advanceTimersByTimeAsync(1);
    expect(chosen).toBe('quick');
  });
});

describe('sports events', () => {
  /** An install of a sports addon, as the collection holds it. */
  const install = (name: string, id = 'org.test.sports'): InstalledAddon =>
    ({
      transportUrl: `https://${name}.example.com/manifest.json`,
      manifest: { id, name },
    }) as unknown as InstalledAddon;

  /** One addon's listing of the match. */
  const source = (addon: InstalledAddon, id: string, addonIndex = 0): EventSource => ({
    addonIndex,
    addonId: addon.manifest.id,
    transportUrl: addon.transportUrl,
    type: 'tv',
    id,
    name: 'Arsenal v Brighton',
    catalogId: 'live',
  });

  beforeEach(() => {
    addons.asked = [];
    addons.loaded = [];
  });

  it('shares one finder while the event asks the same installs', () => {
    const a = install('a');
    addons.collection = [a];
    const play = { key: '0-a-shared', sources: [source(a, 'a:shared')], replay: false };
    const prefetched = streamFinder('tv', 'a:shared', play);
    expect(streamFinder('tv', 'a:shared', { ...play, sources: play.sources.slice() })).toBe(
      prefetched,
    );
  });

  it('asks a source the event gained after its finder was made', () => {
    const [a, b] = [install('a'), install('b', 'org.other.sports')];
    addons.collection = [a, b];
    // Prefetched on the event page while only the first addon listed the match.
    streamFinder('tv', 'a:1', {
      key: '0-a-1',
      sources: [source(a, 'a:1')],
      replay: false,
    }).start();
    expect(addons.asked).toEqual(['a-a:1']);
    // The second addon's copy merged in later, under the same event key.
    const finder = streamFinder('tv', 'a:1', {
      key: '0-a-1',
      sources: [source(a, 'a:1'), source(b, 'b:9', 1)],
      replay: false,
    });
    finder.start();
    expect(addons.asked).toEqual(['a-a:1', 'a-a:1', 'b-b:9']);
    expect(finder.get().entries.map((entry) => entry.addonId)).toEqual([
      'org.test.sports',
      'org.other.sports',
    ]);
  });

  it('never asks an install that was removed when its event key passes to another', () => {
    // Two installs of one addon, with other settings: they list the same ids.
    const [first, second] = [install('first'), install('second')];
    addons.collection = [first, second];
    streamFinder('tv', 'x:7', {
      key: '0-x-7',
      sources: [source(first, 'x:7'), source(second, 'x:7', 1)],
      replay: false,
    }).start();
    addons.asked = [];
    addons.loaded = [];
    // The first is removed: the second's copy now leads, and takes the key.
    addons.collection = [second];
    const finder = streamFinder('tv', 'x:7', {
      key: '0-x-7',
      sources: [source(second, 'x:7')],
      replay: false,
    });
    finder.start();
    expect(addons.asked).toEqual(['second-x:7']);
    expect(addons.loaded).toEqual(['second-x:7']);
    expect(finder.get().entries).toHaveLength(1);
  });

  it("puts the player's video and each of the event's sources first, until let go", () => {
    const [a, b] = [install('a'), install('b', 'org.other.sports')];
    addons.collection = [a, b];
    addons.first = [];
    const release = putPlayerFirst('tv', 'a:first', {
      key: '0-a-first',
      sources: [source(a, 'a:first'), source(b, 'b:first', 1)],
      replay: false,
    });
    expect(addons.first).toEqual([
      {
        videos: [
          { type: 'tv', id: 'a:first' },
          { type: 'tv', id: 'a:first' },
          { type: 'tv', id: 'b:first' },
        ],
        released: false,
      },
    ]);
    release();
    expect(addons.first[0]!.released).toBe(true);

    putPlayerFirst('movie', 'tt1');
    expect(addons.first[1]!.videos).toEqual([{ type: 'movie', id: 'tt1' }]);
  });

  it('leaves out the sources of addons no longer installed', () => {
    const [a, gone] = [install('a'), install('gone', 'org.gone.sports')];
    addons.collection = [a];
    streamFinder('tv', 'a:2', {
      key: '0-a-2',
      sources: [source(a, 'a:2'), source(gone, 'g:2', 1)],
      replay: false,
    }).start();
    expect(addons.asked).toEqual(['a-a:2']);
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

  it('keeps to the language heard and passes over a clip', () => {
    addons.installs = [
      {
        id: 'org.test.streams',
        streams: [
          { ...offer('big', '2160p', 72), description: '🗣 EN' },
          { ...offer('spanish', '1080p', 20), description: '🗣 ES' },
          { ...offer('sample', '1080p', 1), description: 'Sample 1080p' },
          { ...offer('english', '1080p', 22), description: '🗣 EN' },
        ],
      },
    ];
    const finder = streamFinder('movie', 'tt-lighter-language');
    finder.start();
    const big = finder.get().entries.find((entry) => fileOf(entry) === 'big')!;
    const tried = new Set([entryKey(big)]);
    expect(fileOf(finder.lighter(big, tried, { entry: big, audioLanguage: 'en' }))).toBe('english');
    // Nothing in the language heard: none, rather than a change of language.
    tried.add(entryKey(finder.get().entries.find((entry) => fileOf(entry) === 'english')!));
    expect(finder.lighter(big, tried, { entry: big, audioLanguage: 'en' })).toBeUndefined();
  });
});

describe('the next episode', () => {
  const release = (file: string, resolution: string, bingeGroup: string) => ({
    url: `https://media.example.com/${file}.mkv`,
    name: `Test\n${resolution}`,
    behaviorHints: { bingeGroup },
  });
  const hint = { addonId: 'org.test.second', bingeGroup: 'second-720p' };

  beforeEach(() => {
    addons.installs = [
      { id: 'org.test.first', streams: [release('best', '2160p', 'first-4k')] },
      { id: 'org.test.second', streams: [release('same', '720p', 'second-720p')] },
    ];
  });

  it('starts on the release the episode before played, ahead of the best ranked', async () => {
    const finder = streamFinder('series', 'tt-binge:1:2');
    expect(fileOf(await finder.choose())).toBe('best');
    expect(fileOf(await finder.choose(hint))).toBe('same');
  });

  it("waits a little for that release's addon after the rest have settled", async () => {
    addons.answering = false;
    const finder = streamFinder('series', 'tt-binge:1:3');
    let chosen: string | undefined = 'none yet';
    void finder.choose(hint).then((entry) => (chosen = fileOf(entry)));
    answer('tt-binge:1:3', 0);
    await vi.advanceTimersByTimeAsync(SETTLE_AFTER_FIRST_MS);
    expect(finder.get().settled).toBe(true);
    await vi.advanceTimersByTimeAsync(BINGE_WAIT_MS - 1000);
    expect(chosen).toBe('none yet');
    answer('tt-binge:1:3', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen).toBe('same');
  });

  it('takes the usual choice once the wait is over, or when the release is not there', async () => {
    addons.answering = false;
    const finder = streamFinder('series', 'tt-binge:1:4');
    let chosen: string | undefined = 'none yet';
    void finder.choose(hint).then((entry) => (chosen = fileOf(entry)));
    answer('tt-binge:1:4', 0);
    await vi.advanceTimersByTimeAsync(SETTLE_AFTER_FIRST_MS + BINGE_WAIT_MS - 1);
    expect(chosen).toBe('none yet');
    await vi.advanceTimersByTimeAsync(1);
    expect(chosen).toBe('best');

    addons.answering = true;
    const other = streamFinder('series', 'tt-binge:1:5');
    expect(fileOf(await other.choose({ ...hint, bingeGroup: 'gone' }))).toBe('best');
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
    // Only one the page gave is known: a clip is judged against nothing assumed.
    expect(episode.knownRuntimeSeconds()).toBeUndefined();
    episode.setRuntime(2700);
    expect(episode.runtimeSeconds()).toBe(2700);
    expect(episode.knownRuntimeSeconds()).toBe(2700);
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

describe('streamFinder and the audio language wanted', () => {
  const dubbed = [
    { url: 'https://media.example.com/castellano.mkv', name: 'Test\n2160p', title: 'Film 🇪🇸' },
    { url: 'https://media.example.com/original.mkv', name: 'Test\n1080p', title: 'Film' },
  ];

  afterEach(() => {
    setPreference('audioLanguage', null);
    setPreference('maxResolution', null);
  });

  it('ranks again within the highest picture set in Settings', () => {
    addons.installs = [
      {
        id: 'org.test.streams',
        streams: [
          { url: 'https://media.example.com/uhd.mkv', name: 'Test\n2160p' },
          { url: 'https://media.example.com/hd.mkv', name: 'Test\n1080p' },
        ],
      },
    ];
    const finder = streamFinder('movie', 'tt-limited');
    finder.start();
    expect(files(finder.get().candidates)).toEqual(['uhd', 'hd']);
    setPreference('maxResolution', '1080p');
    expect(finder.orderOptions().maxResolution).toBe('1080p');
    expect(files(finder.get().candidates)).toEqual(['hd', 'uhd']);
  });

  it('puts a dub below the rest, and ranks again when another language is chosen', () => {
    addons.installs = [{ id: 'org.test.streams', streams: dubbed }];
    const finder = streamFinder('movie', 'tt-dubbed');
    finder.start();
    expect(files(finder.get().candidates)).toEqual(['original', 'castellano']);
    expect(finder.orderOptions().audioLanguage).toBeUndefined();

    setPreference('audioLanguage', 'spa');
    expect(finder.orderOptions().audioLanguage).toBe('spa');
    expect(files(finder.get().candidates)).toEqual(['castellano', 'original']);
  });

  it("follows the language chosen for the episode's series over the profile's", async () => {
    addons.installs = [{ id: 'org.test.streams', streams: dubbed }];
    setPreference('audioLanguage', 'spa');
    await trackMemory.rememberAudio('tt-series', 'eng');
    const episode = streamFinder('series', 'tt-series:1:2');
    episode.start();
    expect(episode.orderOptions().audioLanguage).toBe('eng');
    expect(files(episode.get().candidates)).toEqual(['original', 'castellano']);
  });
});
