import {
  createStore,
  createSubtitleDrifts,
  createSubtitleOffsets,
  createSubtitlePickMemory,
  createTrackMemory,
  type Cue,
  memoryKeyValueStore,
  type StreamEntry,
  subtitleFileKey,
  subtitleRelease,
} from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineTrack } from '../../player/engines/types';
import type { PlaybackSession, SessionState } from '../../player/session';
import type { SubtitleListState, SubtitleOption } from '../../player/subtitles';
import { recentSubtitleTraces } from '../../player/subtitle-trace';
import { driftHintKey, driftOn, syncLine } from '../../player/subtitle-versions';
import { lineNear, type SubtitleChoice, type Subtitles, useSubtitles } from './use-subtitles';

/*
 * The hook runs here on a small stand-in for React, enough for the hooks it
 * uses: state, refs, memos, effects after each render, and external stores.
 * A render happens when the test flushes, as React would after the change.
 */
const react = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    set?: (next: unknown) => void;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
    get?: () => unknown;
    snapshot?: unknown;
    subscribe?: unknown;
    unsubscribe?: () => void;
  }
  const state = {
    slots: [] as Slot[],
    at: 0,
    dirty: false,
    effects: [] as Array<() => void>,
  };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const slot = (): Slot => {
    const i = state.at++;
    if (!state.slots[i]) state.slots[i] = {};
    return state.slots[i]!;
  };
  const module = {
    useState(init: unknown) {
      const s = slot();
      if (!('value' in s)) s.value = typeof init === 'function' ? (init as () => unknown)() : init;
      if (!s.set) {
        s.set = (next: unknown) => {
          const value =
            typeof next === 'function' ? (next as (old: unknown) => unknown)(s.value) : next;
          if (Object.is(value, s.value)) return;
          s.value = value;
          state.dirty = true;
        };
      }
      return [s.value, s.set];
    },
    useRef(init: unknown) {
      const s = slot();
      if (!('value' in s)) s.value = { current: init };
      return s.value;
    },
    useMemo(make: () => unknown, deps: unknown[]) {
      const s = slot();
      if (!same(s.deps, deps)) {
        s.value = make();
        s.deps = deps;
      }
      return s.value;
    },
    useEffect(effect: () => unknown, deps?: unknown[]) {
      const s = slot();
      if (deps && same(s.deps, deps)) return;
      s.deps = deps;
      state.effects.push(() => {
        if (s.cleanup) s.cleanup();
        const cleanup = effect();
        s.cleanup = typeof cleanup === 'function' ? (cleanup as () => void) : undefined;
      });
    },
    useSyncExternalStore(subscribe: (listener: () => void) => () => void, get: () => unknown) {
      const s = slot();
      s.get = get;
      if (s.subscribe !== subscribe) {
        if (s.unsubscribe) s.unsubscribe();
        s.subscribe = subscribe;
        s.unsubscribe = subscribe(() => {
          if (!Object.is(s.get!(), s.snapshot)) state.dirty = true;
        });
      }
      s.snapshot = get();
      return s.snapshot;
    },
  };
  return { state, module };
});

vi.mock('react', () => react.module);

/** The profile's stores, made afresh for each test. */
const stores = vi.hoisted(
  () =>
    ({}) as {
      trackMemory: ReturnType<typeof createTrackMemory>;
      subtitleOffsets: ReturnType<typeof createSubtitleOffsets>;
      subtitleDrifts: ReturnType<typeof createSubtitleDrifts>;
      subtitlePicks: ReturnType<typeof createSubtitlePickMemory>;
      preferences: ReturnType<typeof createStore<Record<string, unknown>>>;
    },
);

vi.mock('../../data/library', () => ({
  get trackMemory() {
    return stores.trackMemory;
  },
  get subtitleOffsets() {
    return stores.subtitleOffsets;
  },
  get subtitleDrifts() {
    return stores.subtitleDrifts;
  },
}));
vi.mock('../../data/playback', () => ({
  get subtitlePicks() {
    return stores.subtitlePicks;
  },
}));
vi.mock('../../data/preferences', () => ({
  get preferences() {
    return stores.preferences;
  },
  setPreference(key: string, value: unknown) {
    stores.preferences.set({ ...stores.preferences.get(), [key]: value });
  },
}));
vi.mock('../../data/addons', () => ({ addonCollection: { get: () => ({ addons: [] }) } }));

/** The subtitle files on offer for each stream, and how reading each goes. */
const world = vi.hoisted(() => ({
  lists: new Map<unknown, unknown>(),
  files: new Map<string, { cues: unknown[]; ms?: number; fail?: boolean }>(),
  loads: [] as string[],
  /** Of those, the ones read only to be lined up, and not kept (`keep: false`). */
  passes: [] as string[],
  cached: new Set<string>(),
  cleared: 0,
}));

vi.mock('../../player/subtitles', () => ({
  // Kept once read, as the real loader keeps the parsed files.
  loadSubtitles(option: { url: string }, how?: { keep?: boolean }) {
    world.loads.push(option.url);
    if (how?.keep === false) world.passes.push(option.url);
    const file = world.files.get(option.url);
    if (!file || file.fail)
      return Promise.reject(new Error('The subtitle file could not be reached'));
    if (!file.ms || world.cached.has(option.url)) return Promise.resolve(file.cues);
    return new Promise((done) =>
      setTimeout(() => {
        world.cached.add(option.url);
        done(file.cues);
      }, file.ms),
    );
  },
  subtitleList(_type: string, _videoId: string, stream: unknown) {
    return world.lists.get(stream);
  },
  clearSubtitleCache() {
    world.cleared++;
    world.cached.clear();
  },
}));

const META = 'tt0000001';
const VIDEO = 'tt0000001';
const VIDEO_S = 7200;

/**
 * Lines spread over the video, a little irregularly as speech is (lining
 * files up needs that): `hearing` of every ten are sounds in brackets.
 */
function lines(count: number, end: number, hearing = 0): Cue[] {
  const step = (end - 2) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const random = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const wobble = i === 0 || i === count - 1 ? 0 : (random - 0.5) * step * 0.5;
    const start = i * step + wobble;
    const text = i % 10 < hearing ? '[door creaks]' : 'Where have you been all night?';
    return { start, end: start + 2, lines: [[{ text }]] };
  });
}

/** Lines in another language's script: Persian, offered as English. */
function persian(count: number, end: number): Cue[] {
  return lines(count, end).map((cue) => ({ ...cue, lines: [[{ text: 'تمام شب کجا بودی؟' }]] }));
}

const FULL = lines(1200, 7000);
const SDH = lines(1200, 7000, 2);
const SIGNS = lines(20, 7000);
const LONG = lines(1200, 9000);

function file(
  id: string,
  cues: Cue[] | null,
  extra: {
    lang?: string;
    label?: string;
    ms?: number;
    season?: number;
    episode?: number;
    hashMatch?: boolean;
    linkedLate?: boolean;
  } = {},
) {
  const option: SubtitleOption = {
    key: `os#${id}`,
    lang: extra.lang ?? 'eng',
    source: 'OpenSubtitles v3',
    url: `https://subs.example/${id}.srt`,
  };
  if (extra.label) option.label = extra.label;
  if (extra.season !== undefined) option.season = extra.season;
  if (extra.episode !== undefined) option.episode = extra.episode;
  if (extra.hashMatch) option.hashMatch = true;
  if (extra.linkedLate) option.linkedLate = true;
  world.files.set(option.url, cues ? { cues, ms: extra.ms } : { cues: [], fail: true });
  return option;
}

function streamEntry(name: string, addonId = 'streams'): StreamEntry {
  return {
    addonId,
    addonRank: 0,
    rank: 0,
    stream: {
      name,
      behaviorHints: { filename: `${name}.mkv`, bingeGroup: `test-${name}` },
      subtitles: [],
      source: { kind: 'url', url: `https://media.example/${name}.mkv` },
    },
    facts: { languages: [] },
    assessment: {},
  } as unknown as StreamEntry;
}

/**
 * The files offered with a stream, how many addons are still to answer, and whether a hash read
 * late may still link a file (the hash then counts among those to answer, as the list counts it).
 */
/**
 * The files an addon offers for the stream, and how many addons are still to answer. With
 * `hashComing`, the hash may still link a file; 'reading' says it is still being read, and is
 * one of those `pending`, as the list counts it.
 */
function offer(
  entry: StreamEntry,
  options: SubtitleOption[],
  pending = 0,
  hashComing: boolean | 'reading' = false,
) {
  const store = createStore<SubtitleListState>({
    options,
    pending,
    ...(hashComing && { hashComing: true }),
    ...(hashComing === 'reading' && { hashReading: true }),
  });
  world.lists.set(entry.stream, {
    get: store.get,
    subscribe: store.subscribe,
    start: () => undefined,
    stop: () => undefined,
  });
  return (more: SubtitleOption[], stillPending = 0, stillComing = false) =>
    store.set({
      options: store.get().options.concat(more),
      pending: stillPending,
      ...(stillComing && { hashComing: true }),
    });
}

function track(id: string, lang: string, extra: Partial<EngineTrack> = {}): EngineTrack {
  return { id, lang, label: '', active: false, ...extra };
}

const BASE: SessionState = {
  status: 'playing',
  entry: null,
  engine: 'native',
  position: 0,
  duration: VIDEO_S,
  live: false,
  liveWindow: null,
  behind: 0,
  error: null,
  failedOver: false,
  steppedDown: false,
  struggling: false,
  audio: [],
  text: [],
  streamCues: {},
  streamTimings: {},
  textComing: false,
  fileText: null,
  rate: 1,
  clip: false,
  attempts: [],
};

/**
 * The player as the hook sees it, with the stream playing and the session's state: a film,
 * or the episode a series video id names.
 */
function play(first: StreamEntry, state: Partial<SessionState> = {}, lab = false, videoId = VIDEO) {
  // A Lab stream has no title.
  const metaId = lab ? undefined : META;
  const playing = createStore<SessionState>({ ...BASE, entry: first, ...state });
  // The tracks the engine was asked for, last last.
  const selected: Array<string | null> = [];
  const session = {
    get: playing.get,
    subscribe: playing.subscribe,
    selectText: (id: string | null) => selected.push(id),
    trustedPosition: () => playing.get().position,
  } as unknown as PlaybackSession;
  let entry = first;
  let result!: Subtitles;
  // The player screen, drawn once more.
  const Screen = () => {
    react.state.at = 0;
    react.state.dirty = false;
    const type = videoId === VIDEO ? 'movie' : 'series';
    result = useSubtitles(type, videoId, metaId, entry, session, playing.get());
  };
  react.state.slots = [];
  react.state.effects = [];
  Screen();
  const slots = react.state.slots;
  const flush = async () => {
    for (let round = 0; round < 200; round++) {
      while (react.state.effects.length > 0) {
        const effects = react.state.effects;
        react.state.effects = [];
        effects.forEach((effect) => effect());
      }
      for (let i = 0; i < 10; i++) await Promise.resolve();
      if (!react.state.dirty && react.state.effects.length === 0) return;
      if (react.state.dirty) Screen();
    }
    throw new Error('The hook kept rendering');
  };
  const player = {
    get subtitles() {
      return result;
    },
    selected,
    flush,
    /** Lets time pass, drawing again as often as anything changes, as React would. */
    async wait(ms: number) {
      await flush();
      for (let left = ms; left > 0; left -= 50) {
        await vi.advanceTimersByTimeAsync(Math.min(50, left));
        await flush();
      }
    },
    async session(patch: Partial<SessionState>) {
      playing.set({ ...playing.get(), ...patch });
      // The player screen draws again with the session.
      react.state.dirty = true;
      await flush();
    },
    async stream(next: StreamEntry) {
      entry = next;
      playing.set({ ...playing.get(), entry: next });
      react.state.dirty = true;
      await flush();
    },
    unmount() {
      for (const s of slots.splice(0)) {
        if (typeof s.cleanup === 'function') s.cleanup();
        if (typeof s.unsubscribe === 'function') s.unsubscribe();
      }
    },
  };
  mounted.push(player.unmount);
  return player;
}

describe('lineNear', () => {
  const cue = (start: number, end: number): Cue => ({ start, end, lines: [[{ text: 'A line' }]] });
  const cues = [cue(10, 12), cue(11, 40), cue(50, 52), cue(60, 62)];

  it('says a line is on screen, or due within 2 s', () => {
    expect(lineNear(cues, 0)).toBe(false);
    expect(lineNear(cues, 7.9)).toBe(false);
    expect(lineNear(cues, 8.1)).toBe(true);
    // A long line that started before another ended.
    expect(lineNear(cues, 30)).toBe(true);
    expect(lineNear(cues, 45)).toBe(false);
    expect(lineNear(cues, 61)).toBe(true);
    expect(lineNear(cues, 70)).toBe(false);
    expect(lineNear([], 10)).toBe(false);
  });
});

/** Players still on screen, closed after each test. */
const mounted: Array<() => void> = [];

const fileChoice = (option: SubtitleOption): SubtitleChoice => ({ kind: 'file', key: option.key });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  world.lists.clear();
  world.files.clear();
  world.loads = [];
  world.passes = [];
  world.cached.clear();
  world.cleared = 0;
  const kv = memoryKeyValueStore();
  stores.trackMemory = createTrackMemory({ storage: kv });
  stores.subtitleOffsets = createSubtitleOffsets({ storage: kv });
  stores.subtitleDrifts = createSubtitleDrifts({ storage: kv });
  stores.subtitlePicks = createSubtitlePickMemory({ storage: kv });
  stores.preferences = createStore<Record<string, unknown>>({
    audioLanguage: null,
    subtitleLanguage: 'eng',
    subtitleWhen: 'always',
    learnLanguages: false,
  });
  await Promise.all([
    stores.trackMemory.load(),
    stores.subtitleOffsets.load(),
    stores.subtitleDrifts.load(),
    stores.subtitlePicks.load(),
  ]);
});

afterEach(() => {
  mounted.splice(0).forEach((unmount) => unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSubtitles', () => {
  it('holds the lines while the first files are read, then shows the full one', async () => {
    const entry = streamEntry('film');
    const signs = file('signs', SIGNS);
    const full = file('full', FULL, { ms: 1000 });
    offer(entry, [signs, full]);
    const player = play(entry);
    await player.flush();
    // The signs file read, the full one still on its way: no line shows meanwhile.
    expect(player.subtitles.cues).toBeNull();
    expect(player.subtitles.loading).toBe(true);
    await player.wait(1000);
    expect(player.subtitles.choice).toEqual(fileChoice(full));
    expect(player.subtitles.cues).toHaveLength(1200);
    player.unmount();
  });

  it('does not wait for two slow downloads, and reads the next file meanwhile', async () => {
    const entry = streamEntry('film');
    const a = file('a', SDH, { ms: 14000 });
    const b = file('b', SDH, { ms: 14000 });
    const c = file('c', FULL);
    offer(entry, [a, b, c]);
    const player = play(entry);
    await player.wait(2500);
    expect(world.loads).toContain(c.url);
    expect(player.subtitles.choice).toEqual(fileChoice(c));
    expect(player.subtitles.cues).toHaveLength(1200);
    // The slow two, read in the end, are not clearly better.
    await player.wait(13000);
    expect(player.subtitles.choice).toEqual(fileChoice(c));
  });

  it('shows a file read soon after the hold, not the slow one the hold ended on', async () => {
    const entry = streamEntry('film');
    // Both still on their way 2 s after they were asked for: the hold ends with none read.
    const a = file('a', FULL, { ms: 14000 });
    const b = file('b', FULL, { ms: 2500 });
    offer(entry, [a, b]);
    const player = play(entry);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(b));
    expect(player.subtitles.cues).toHaveLength(1200);
    // The first, read in the end, is no better: the second stays.
    await player.wait(12000);
    expect(player.subtitles.choice).toEqual(fileChoice(b));
  });

  it('shows a file read after the hold, all three of the first files being slow', async () => {
    const entry = streamEntry('film');
    const a = file('a', FULL, { ms: 14000 });
    const b = file('b', FULL, { ms: 6000 });
    const c = file('c', FULL, { ms: 14000 });
    offer(entry, [a, b, c]);
    const player = play(entry);
    await player.wait(5000);
    expect(player.subtitles.cues).toBeNull();
    await player.wait(1500);
    expect(player.subtitles.choice).toEqual(fileChoice(b));
    expect(player.subtitles.cues).toHaveLength(1200);
  });

  it('shows another copy made for the release when the one chosen is a slow download', async () => {
    const release = 'Some.Film.2021.1080p.BluRay.x264-GROUP';
    const entry = streamEntry(release);
    const first = file('first', FULL, { label: release, ms: 14000 });
    const second = file('second', FULL, { label: release, ms: 500 });
    const other = file('other', FULL, { ms: 300 });
    offer(entry, [first, second, other]);
    const player = play(entry);
    await player.flush();
    expect(player.subtitles.choice).toEqual(fileChoice(first));
    // Until it is slow, the copy chosen is waited for, and nothing else is read.
    await player.wait(1500);
    expect(world.loads).toEqual([first.url]);
    // Then the other copy made for the release is read, and shows.
    await player.wait(1500);
    expect(player.subtitles.choice).toEqual(fileChoice(second));
    expect(player.subtitles.cues).toHaveLength(1200);
    expect(world.loads).not.toContain(other.url);
    // The first, read in the end, is no better: the second stays.
    await player.wait(12000);
    expect(player.subtitles.choice).toEqual(fileChoice(second));
  });

  it('forgets the files read once the player closes', async () => {
    const entry = streamEntry('film');
    offer(entry, [file('full', FULL)]);
    const player = play(entry);
    await player.flush();
    expect(world.cleared).toBe(0);
    player.unmount();
    expect(world.cleared).toBe(1);
  });
});

describe('the version picked by hand for the release', () => {
  const remember = (entry: StreamEntry, option: SubtitleOption) =>
    stores.subtitlePicks.remember({
      metaId: META,
      release: subtitleRelease(entry, VIDEO),
      file: subtitleFileKey(VIDEO, option.key),
    });

  it('shows before the stream’s own track, listed while the stream still loads', async () => {
    const entry = streamEntry('film');
    const one = file('one', FULL);
    const two = file('two', FULL);
    offer(entry, [one, two]);
    await remember(entry, two);
    const player = play(entry, {
      engine: 'hls.js',
      status: 'loading',
      text: [track('en|English', 'en')],
    });
    await player.flush();
    expect(player.subtitles.choice).toEqual(fileChoice(two));
    await player.session({ status: 'playing' });
    expect(player.subtitles.choice).toEqual(fileChoice(two));
  });

  it('takes over from the stream’s own track when its addon answers later', async () => {
    const entry = streamEntry('film');
    const two = file('two', FULL);
    const answer = offer(entry, [], 1);
    await remember(entry, two);
    const player = play(entry, { engine: 'hls.js', text: [track('en|English', 'en')] });
    await player.flush();
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: 'en|English' });
    answer([two]);
    await player.flush();
    expect(player.subtitles.choice).toEqual(fileChoice(two));
  });

  it('gets its drift fix again from the files read beside it, when only they can show it', async () => {
    // A 22-minute PAL episode: the version picked by hand is timed for film speed and ends 26 s
    // past the video, too little to tell on its own; the two others end with the video.
    const entry = streamEntry('episode');
    const a = file('a', lines(350, 1291));
    const b = file('b', lines(360, 1293));
    const x = file('x', lines(370, 1346));
    offer(entry, [a, b, x]);
    await remember(entry, x);
    const player = play(entry, { duration: 1320 });
    await player.wait(500);
    expect(player.subtitles.choice).toEqual(fileChoice(x));
    expect(player.subtitles.drift).toBe('behind');
    expect(player.subtitles.autoDrift).toBe(true);
    // With the viewer's timing kept beside the player's own fix, it stays on when moved.
    player.subtitles.setOffset(0.3);
    await player.flush();
    expect(player.subtitles.drift).toBe('behind');
  });

  it('stays once it took over from a file, though a track is listed later', async () => {
    const entry = streamEntry('film');
    const one = file('one', FULL);
    const two = file('two', FULL);
    const answer = offer(entry, [one], 1);
    await remember(entry, two);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(one));
    answer([two]);
    await player.flush();
    expect(player.subtitles.choice).toEqual(fileChoice(two));
    // hls.js takes the stream over from the TV's player, and lists a track as it loads.
    await player.session({
      engine: 'hls.js',
      status: 'loading',
      text: [track('en|English', 'en')],
    });
    await player.session({ status: 'playing' });
    expect(player.subtitles.choice).toEqual(fileChoice(two));
  });
});

describe('a language turned on from the sheet', () => {
  beforeEach(() => {
    stores.preferences.set({ ...stores.preferences.get(), subtitleLanguage: null });
  });

  it('reads its versions and shows the full one, the language kept as the viewer’s', async () => {
    const entry = streamEntry('film');
    const signs = file('signs', SIGNS);
    const past = file('past', LONG);
    const full = file('full', FULL, { ms: 500 });
    offer(entry, [signs, past, full]);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.choice).toBeNull();
    // Nothing in English read yet: the sheet starts the language on its first version.
    player.subtitles.choose(fileChoice(signs), 'language');
    await player.flush();
    expect(player.subtitles.cues).toBeNull();
    await player.wait(600);
    expect(player.subtitles.choice).toEqual(fileChoice(full));
    expect(player.subtitles.cues).toHaveLength(1200);
    expect(stores.trackMemory.get(META)?.subtitle).toBe('eng');
    // Picking a language keeps no version for the release.
    expect(stores.subtitlePicks.get(META, subtitleRelease(entry, VIDEO))).toBeUndefined();
  });

  it('leaves a version picked from the list as it is', async () => {
    const entry = streamEntry('film');
    const signs = file('signs', SIGNS);
    const full = file('full', FULL);
    offer(entry, [signs, full]);
    const player = play(entry);
    await player.flush();
    player.subtitles.choose(fileChoice(signs), 'version');
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(signs));
    expect(player.subtitles.cues).toHaveLength(20);
  });

  it('shows the version the sheet starts on for a Lab stream, which remembers nothing', async () => {
    const entry = streamEntry('film');
    const signs = file('signs', SIGNS);
    offer(entry, [signs, file('full', FULL)]);
    const player = play(entry, {}, true);
    await player.flush();
    player.subtitles.choose(fileChoice(signs), 'language');
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(signs));
  });
});

describe('the automatic choice, once the viewer acts on it', () => {
  /** Lines for the hard of hearing show after the hold, the plain file still on its way. */
  async function hardOfHearingShowing() {
    const entry = streamEntry('film');
    const sdh = file('sdh', SDH);
    const plain = file('plain', FULL, { ms: 5000 });
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.flush();
    return { entry, sdh, plain, player };
  }

  it('switches to a plain file read later while the viewer leaves it be', async () => {
    const { sdh, plain, player } = await hardOfHearingShowing();
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
  });

  it('is not made the viewer’s by pressing the version already showing', async () => {
    const { entry, sdh, plain, player } = await hardOfHearingShowing();
    await player.wait(2500);
    player.subtitles.choose(fileChoice(sdh), 'version');
    await player.flush();
    expect(stores.subtitlePicks.get(META, subtitleRelease(entry, VIDEO))).toBeUndefined();
    expect(stores.subtitlePicks.wantsHearing(META, subtitleRelease(entry, VIDEO))).toBe(false);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
  });

  it('becomes the viewer’s as they move its timing: the hold ends and nothing takes over', async () => {
    const { sdh, player } = await hardOfHearingShowing();
    expect(player.subtitles.cues).toBeNull();
    player.subtitles.setOffset(0.5);
    await player.flush();
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.cues).toHaveLength(1200);
    await player.wait(6000);
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.offset).toBe(0.5);
  });

  it('becomes the viewer’s as they choose its drift fix', async () => {
    const { sdh, player } = await hardOfHearingShowing();
    await player.wait(2500);
    player.subtitles.setDrift('ahead');
    await player.flush();
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.drift).toBe('ahead');
  });

  it('leaves the player’s own drift fix its own when its chip is pressed again', async () => {
    const pal = streamEntry('film-pal');
    const behind = file('behind', lines(1300, 7450));
    offer(pal, [behind]);
    const player = play(pal);
    await player.wait(2500);
    expect(player.subtitles).toMatchObject({ drift: 'behind', autoDrift: true });
    player.subtitles.setDrift('behind');
    await player.flush();
    expect(stores.subtitleDrifts.drifts()).toEqual([]);
    expect(player.subtitles).toMatchObject({ drift: 'behind', autoDrift: true });
    // Another release, which the file fits as it is: its lines are not stretched.
    const bluRay = streamEntry('film-bluray');
    offer(bluRay, [behind]);
    await player.stream(bluRay);
    await player.session({ duration: 7460 });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(behind));
    expect(player.subtitles).toMatchObject({ drift: null, autoDrift: false });
  });

  it('fixes a drift on another release though the timing was moved where none was to fix', async () => {
    const bluRay = streamEntry('film-bluray');
    const f = file('f', lines(1300, 7190));
    offer(bluRay, [f]);
    const player = play(bluRay);
    await player.wait(2500);
    expect(player.subtitles).toMatchObject({ choice: fileChoice(f), drift: null });
    player.subtitles.setOffset(0.3);
    // No fix pressed where none is in use changes nothing either.
    player.subtitles.setDrift(null);
    await player.flush();
    // The PAL release of the same video, where the file's length shows it falling behind.
    const pal = streamEntry('film-pal');
    offer(pal, [f]);
    await player.stream(pal);
    await player.session({ duration: 6905 });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(f));
    expect(player.subtitles).toMatchObject({ drift: 'behind', autoDrift: true, offset: 0.3 });
  });

  it('keeps the player’s own drift fix with the timing, not as a fixed drift', async () => {
    const entry = streamEntry('film');
    const behind = file('behind', lines(1300, 7450));
    offer(entry, [behind]);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.drift).toBe('behind');
    expect(player.subtitles.autoDrift).toBe(true);
    player.subtitles.setOffset(0.1);
    await player.flush();
    expect(stores.subtitleDrifts.drifts()).toEqual([
      { key: subtitleFileKey(VIDEO, behind.key), drift: 'auto' },
    ]);
    expect(player.subtitles.drift).toBe('behind');
  });

  it('keeps only the timing for the stream’s own track, whatever plays it', async () => {
    for (const engine of ['hls.js', 'shaka', 'android'] as const) {
      const entry = streamEntry(`film-${engine}`);
      offer(entry, []);
      const player = play(entry, { engine, text: [track('en|English', 'en')] });
      await player.wait(100);
      expect(player.subtitles.choice).toEqual({ kind: 'track', id: 'en|English' });
      player.subtitles.setOffset(0.4);
      await player.flush();
      expect(player.subtitles.offset).toBe(0.4);
      expect(stores.subtitleDrifts.drifts()).toEqual([]);
      player.unmount();
    }
  });
});

describe('a version picked by hand', () => {
  it('is not kept for the release when the viewer moves on before it loads', async () => {
    const entry = streamEntry('film');
    const one = file('one', FULL);
    const slow = file('slow', SDH, { ms: 3000 });
    offer(entry, [one, slow]);
    const player = play(entry);
    await player.wait(2500);
    player.subtitles.choose(fileChoice(slow), 'version');
    await player.flush();
    player.subtitles.choose(null, 'version');
    await player.wait(3500);
    expect(stores.subtitlePicks.get(META, subtitleRelease(entry, VIDEO))).toBeUndefined();
  });

  it('is tried again when pressed again after it could not be read', async () => {
    const entry = streamEntry('film');
    const bad = file('bad', null);
    offer(entry, [bad]);
    const player = play(entry);
    await player.flush();
    player.subtitles.choose(fileChoice(bad), 'version');
    await player.wait(100);
    expect(player.subtitles.failed).toBe(true);
    world.files.set(bad.url, { cues: FULL });
    player.subtitles.choose(fileChoice(bad), 'version');
    await player.wait(100);
    expect(player.subtitles.failed).toBe(false);
    expect(player.subtitles.cues).toHaveLength(1200);
  });

  it('is kept for the release once it loads', async () => {
    const entry = streamEntry('film');
    const one = file('one', FULL);
    const slow = file('slow', FULL, { ms: 3000 });
    offer(entry, [one, slow]);
    const player = play(entry);
    await player.wait(2500);
    player.subtitles.choose(fileChoice(slow), 'version');
    await player.wait(3500);
    expect(stores.subtitlePicks.get(META, subtitleRelease(entry, VIDEO))?.file).toBe(
      subtitleFileKey(VIDEO, slow.key),
    );
  });
});

describe('the stream’s own tracks', () => {
  const forced = track('en|Forced', 'en', { label: 'English', forced: true });

  it('pass over a forced track for a full file', async () => {
    const entry = streamEntry('film');
    const full = file('full', FULL);
    offer(entry, [full]);
    const player = play(entry, { engine: 'hls.js', text: [forced] });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(full));
  });

  it('take a forced track only when nothing else in the language is left', async () => {
    const entry = streamEntry('film');
    offer(entry, [file('french', FULL, { lang: 'fre' })]);
    const player = play(entry, { engine: 'hls.js', text: [forced] });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: forced.id });
  });

  it('take a forced track before a file that could not be read', async () => {
    const entry = streamEntry('film');
    offer(entry, [file('gone', null)]);
    const player = play(entry, { engine: 'hls.js', text: [forced] });
    await player.wait(5000);
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: forced.id });
    expect(player.subtitles.failed).toBe(false);
  });

  it('take a forced track before a file in another script', async () => {
    const entry = streamEntry('film');
    offer(entry, [file('other', persian(1200, 7000))]);
    const player = play(entry, { engine: 'hls.js', text: [forced] });
    await player.wait(5000);
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: forced.id });
  });

  it('go back to a forced track once a file that came later could not be read', async () => {
    const entry = streamEntry('film');
    const answer = offer(entry, []);
    const player = play(entry, { engine: 'hls.js', text: [forced] });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: forced.id });
    // A slower addon's file is tried, and fails.
    answer([file('late', null)]);
    await player.wait(5000);
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: forced.id });
  });

  it('take over from a file once listed, but not a forced one', async () => {
    const entry = streamEntry('film');
    const full = file('full', FULL);
    offer(entry, [full]);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(full));
    await player.session({ engine: 'hls.js', text: [forced] });
    expect(player.subtitles.choice).toEqual(fileChoice(full));
    await player.session({ text: [forced, track('en|English', 'en')] });
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: 'en|English' });
  });
});

describe('the video file’s own tracks on the TV’s player', () => {
  const english = track('mkv:2', 'en', { picture: false, timed: true });

  it('are waited for while they may still be listed, then chosen before a file', async () => {
    const entry = streamEntry('film-own');
    const full = file('full', FULL);
    offer(entry, [full]);
    const player = play(entry, { engine: 'native', textComing: true });
    await player.wait(5000);
    expect(player.subtitles.choice).toBeNull();
    expect(player.subtitles.textComing).toBe(true);
    await player.session({ textComing: false, text: [english] });
    await player.wait(100);
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: 'mkv:2' });
    expect(player.selected[player.selected.length - 1]).toBe('mkv:2');
    expect(player.subtitles.textComing).toBe(false);
  });

  it('give way to a file once none was found', async () => {
    const entry = streamEntry('film-none');
    const full = file('full', FULL);
    offer(entry, [full]);
    const player = play(entry, { engine: 'native', textComing: true });
    await player.wait(1000);
    await player.session({ textComing: false });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(full));
  });

  it('say which is for the hard of hearing', async () => {
    const entry = streamEntry('film-hearing');
    offer(entry, []);
    const hearing = track('mkv:5', 'en', { picture: false, hearing: true });
    const player = play(entry, { engine: 'native', text: [english, hearing] });
    await player.wait(100);
    expect(player.subtitles.checkOf({ kind: 'track', id: 'mkv:5' })).toEqual({ hearing: true });
    expect(player.subtitles.checkOf({ kind: 'track', id: 'mkv:2' })).toBeUndefined();
  });
});

describe('files for another episode', () => {
  it('are said to be before they are read, and never chosen', async () => {
    // The stream's name says nothing of the episode: the video's id does.
    const entry = streamEntry('episode-one');
    const named = file('named', FULL, { label: 'Show.S01E02.1080p.WEB.H264-CAKES.srt' });
    const tagged = file('tagged', FULL, { season: 1, episode: 2 });
    const right = file('right', FULL, { ms: 1000, season: 1, episode: 1 });
    offer(entry, [named, tagged, right]);
    const player = play(entry, {}, false, `${META}:1:1`);
    await player.flush();
    const episode = { hearing: false, problem: 'episode' };
    expect(player.subtitles.checkOf({ kind: 'file', key: named.key })).toEqual(episode);
    expect(player.subtitles.checkOf({ kind: 'file', key: tagged.key })).toEqual(episode);
    expect(player.subtitles.checkOf({ kind: 'file', key: right.key })).toBeUndefined();
    await player.wait(1500);
    expect(player.subtitles.choice).toEqual(fileChoice(right));
    expect(world.loads).toEqual([right.url]);
  });

  it('are told by the names alone for a Kitsu episode, whose id gives no season', async () => {
    const entry = streamEntry('episode-five');
    const e5 = file('e5', FULL, { label: 'Death.Note.S01E05.1080p.BluRay.x264.srt' });
    offer(entry, [e5]);
    const player = play(entry, {}, false, 'kitsu:1376:5');
    await player.wait(500);
    expect(player.subtitles.checkOf({ kind: 'file', key: e5.key })).toMatchObject({
      hearing: false,
    });
    expect(player.subtitles.checkOf({ kind: 'file', key: e5.key })).not.toHaveProperty('problem');
    expect(player.subtitles.choice).toEqual(fileChoice(e5));
  });
});

describe('another stream of the same video', () => {
  it('reads its own file, listed first, though four were read for the stream before', async () => {
    const first = streamEntry('film');
    const others = ['a', 'b', 'c', 'd'].map((id) => file(id, SDH));
    offer(first, others);
    const player = play(first);
    await player.wait(2500);
    expect(world.loads.filter((url) => url.endsWith('/d.srt'))).not.toEqual([]);
    const next = streamEntry('film-720p');
    const own = file('own', FULL);
    offer(next, [own, ...others]);
    await player.stream(next);
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(own));
  });
});

describe('lining files up against the video', () => {
  /** The cues moved later by `by` seconds: a file a few seconds out. */
  const shift = (cues: Cue[], by: number): Cue[] =>
    cues.map((cue) => ({ ...cue, start: cue.start + by, end: cue.end + by }));
  const timings = (cues: Cue[]) => cues.map(({ start, end }) => ({ start, end }));
  /** Found by the video's hash, its name saying nothing of the release: linked to the video. */
  const linkedSdh = (ms?: number) =>
    file('sdh', SDH, { label: 'some_film_subs.srt', hashMatch: true, ms });
  const firstStart = (subtitles: Subtitles) => subtitles.cues?.[0]?.start;

  it('shows a plain file lined up against one linked to the video, from its first line', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh(300);
    const plain = file('plain', shift(FULL, 3), { ms: 300 });
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.flush();
    // Held while the file linked to the video is read, and then the other lined up against it.
    expect(player.subtitles.cues).toBeNull();
    await player.wait(400);
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.cues).toBeNull();
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(player.subtitles.sync).toMatchObject({ state: 'moved', rate: 1 });
    if (player.subtitles.sync?.state === 'moved') {
      expect(player.subtitles.sync.offset).toBeCloseTo(-3, 1);
    }
    expect(player.subtitles.offset).toBe(0);
    // Its row says it is in step; the one it was lined up against was checked against nothing,
    // so its row says what is known of it (linked to the video), not that it is in step.
    expect(player.subtitles.checkOf(fileChoice(plain)!)).toMatchObject({ synced: 'video' });
    expect(player.subtitles.checkOf(fileChoice(sdh)!)).not.toHaveProperty('synced');
    const [trace] = recentSubtitleTraces();
    expect(trace).toMatchObject({ reason: 'synced to your video', reference: 'linked' });
    expect(Object.values(trace!.aligned ?? {})).toEqual([
      expect.objectContaining({ language: 'en', confidence: 'sure', reference: 'linked' }),
    ]);
  });

  it('lines a file up against the stream’s own track in another language, read but not shown', async () => {
    const entry = streamEntry('film-hls');
    const english = file('english', shift(FULL, -5));
    offer(entry, [english]);
    const player = play(entry, { engine: 'hls.js', text: [track('fr|French', 'fr')] });
    await player.wait(300);
    // The French track is asked for its lines while the English file is chosen.
    expect(player.subtitles.choice).toEqual(fileChoice(english));
    expect(player.selected[player.selected.length - 1]).toBe('fr|French');
    expect(player.subtitles.cues).toBeNull();
    // hls.js hands the track's lines over: the file is lined up, and shows.
    await player.session({ streamTimings: { 'fr|French': timings(FULL) } });
    await player.wait(300);
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
    expect(recentSubtitleTraces()[0]).toMatchObject({ reference: 'track' });
  });

  it('lines a file up against the video file’s own track in another language, never asked for its lines', async () => {
    const entry = streamEntry('film-own-french');
    const english = file('english', shift(FULL, -5));
    offer(entry, [english]);
    // On the TV's own player: the file's French track, every line's timing from its index.
    const french = track('mkv:3', 'fr', { picture: false, timed: true });
    const player = play(entry, { engine: 'native', textComing: true });
    await player.wait(300);
    expect(player.subtitles.choice).toBeNull();
    await player.session({
      textComing: false,
      text: [french],
      streamTimings: { 'mkv:3': timings(FULL) },
    });
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(english));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
    // Whole already: the engine is never asked for the track.
    expect(player.selected).not.toContain('mkv:3');
    expect(recentSubtitleTraces()[0]).toMatchObject({ reference: 'track' });
    expect(player.subtitles.checkOf(fileChoice(english)!)).toMatchObject({ synced: 'video' });
  });

  it('lines files up against the video file’s own track in the language showing first', async () => {
    const entry = streamEntry('film-own-two');
    const english = file('english', shift(FULL, 3));
    offer(entry, [english]);
    // The Spanish track is out with this cut by 4 s; the English one, listed after, is in step.
    const spanish = track('mkv:2', 'es', { picture: false, timed: true });
    const own = track('mkv:4', 'en', { picture: false, timed: true, hearing: true });
    const player = play(entry, {
      engine: 'native',
      text: [spanish, own],
      streamTimings: { 'mkv:2': timings(shift(FULL, 4)), 'mkv:4': timings(FULL) },
    });
    await player.wait(2500);
    // The viewer's language is embedded: its track shows, for the hard of hearing or not.
    expect(player.subtitles.choice).toEqual({ kind: 'track', id: 'mkv:4' });
    player.subtitles.choose(fileChoice(english), 'version');
    await player.wait(1000);
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(player.selected[player.selected.length - 1]).toBeNull();
  });

  it('waits for the video file’s own tracks before files that agree may decide', async () => {
    const entry = streamEntry('Show.S01E06.2160p.AMZN.WEB-DL.DDP5.1.HEVC-Grp');
    const AMZN = 'Show.S01E06.1080p.AMZN.WEB-DL.DDP5.1.H.264';
    const real = file('real', shift(FULL, 8), { label: 'Show.S01E06.WEB.REAL.srt' });
    offer(entry, [
      real,
      file('ntb', FULL, { lang: 'spa', label: `${AMZN}-NTb.srt` }),
      file('flux', FULL, { lang: 'dut', label: `${AMZN}-FLUX.srt` }),
      file('kings', FULL, { lang: 'eng', label: `${AMZN}-KiNGS.srt` }),
    ]);
    const player = play(entry, { engine: 'native', textComing: true });
    await player.wait(5000);
    expect(recentSubtitleTraces()[0]?.agreement).toBeUndefined();
    // The file's own track comes: the late file is lined up against it, not against the files.
    await player.session({
      textComing: false,
      text: [track('mkv:2', 'fr', { picture: false, timed: true })],
      streamTimings: { 'mkv:2': timings(FULL) },
    });
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(real));
    expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
    expect(player.subtitles.sync?.basis).toBeUndefined();
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(recentSubtitleTraces()[0]?.agreement).toBeUndefined();
  });

  it('says so where there is nothing to check a file against, and moves nothing', async () => {
    const entry = streamEntry('film');
    const plain = file('plain', shift(FULL, 3));
    offer(entry, [plain]);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 3, 5);
    expect(player.subtitles.sync).toEqual({ state: 'unchecked' });
    expect(player.subtitles.checkOf(fileChoice(plain)!)).not.toHaveProperty('synced');
  });

  it('ranks a file whose timing matches nothing in the video’s after one that fits', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    // Another cut's lines: nothing like the video's timing.
    const other = file(
      'other',
      lines(1150, 7000).map((cue, i) => ({
        ...cue,
        start: cue.start + (i % 7) * 0.9,
        end: cue.end + (i % 7) * 0.9,
      })),
    );
    offer(entry, [sdh, other]);
    const player = play(entry);
    await player.wait(2500);
    // The file linked to the video, though for the hard of hearing, stays.
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.checkOf(fileChoice(other)!)).not.toHaveProperty('synced');
  });

  it('leaves a version picked by hand showing, its lines lined up', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    const plain = file('plain', shift(FULL, 3));
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.wait(2500);
    player.subtitles.choose(fileChoice(sdh), 'version');
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.sync).toEqual({ state: 'reference' });
    // Picked by hand, the plain one lined up is still the viewer's to choose: it is moved.
    player.subtitles.choose(fileChoice(plain), 'version');
    await player.wait(500);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
  });

  it('leaves the lines as the viewer set them where they chose the file’s drift fix', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    const plain = file('plain', shift(FULL, 3));
    await stores.subtitleDrifts.remember(subtitleFileKey(VIDEO, plain.key), 'none');
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 3, 5);
    expect(player.subtitles.sync).toEqual({ state: 'yours' });
  });

  it('adds the viewer’s timing to the move, kept as set on lined-up lines', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    const plain = file('plain', shift(FULL, 3));
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.wait(2500);
    player.subtitles.setOffset(0.2);
    await player.flush();
    expect(player.subtitles.offset).toBe(0.2);
    // The move stays; the layer draws the viewer's timing on top of it.
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    const key = subtitleFileKey(VIDEO, plain.key);
    expect(stores.subtitleDrifts.get(key)).toBe('aligned');
    expect(stores.subtitleOffsets.get(key)).toBe(0.2);
  });

  it('never stacks a timing kept from another release on the move, and adds one set on a move', async () => {
    const key = (option: SubtitleOption) => subtitleFileKey(VIDEO, option.key);
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    const plain = file('plain', shift(FULL, 3));
    // Set on the file's own lines, on another release: 3 s later still.
    await stores.subtitleOffsets.remember(key(plain), 3);
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.wait(2500);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(player.subtitles.offset).toBe(0);
    // Kept, not lost: where the file cannot be lined up, it applies as before.
    expect(stores.subtitleOffsets.get(key(plain))).toBe(3);
    player.unmount();

    // Set on lines lined up before: it adds to this stream's move.
    await stores.subtitleOffsets.remember(key(plain), 0.4);
    await stores.subtitleDrifts.remember(key(plain), 'aligned');
    const again = streamEntry('film-again');
    offer(again, [sdh, plain]);
    const next = play(again);
    await next.wait(2500);
    expect(next.subtitles.offset).toBe(0.4);
    expect(firstStart(next.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
  });

  it('lets the viewer undo a stretch the move made, and keeps that choice', async () => {
    const pal = 25 / (24000 / 1001);
    const entry = streamEntry('film');
    const sdh = file('sdh', lines(1200, 6800, 2), { label: 'some_film.srt', hashMatch: true });
    // Timed for 25 frames a second on the 23.976 video: its length (7,090 s) shows no drift.
    const stretched = lines(1200, 6800).map((cue) => ({
      ...cue,
      start: cue.start * pal,
      end: cue.end * pal,
    }));
    const plain = file('plain', stretched);
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
    expect(player.subtitles.drift).toBe('behind');
    expect(player.subtitles.autoDrift).toBe(true);
    const last = () => player.subtitles.cues![player.subtitles.cues!.length - 1]!.start;
    expect(last()).toBeCloseTo(stretched[stretched.length - 1]!.start / pal, 0);
    // No fix: kept for the file, so the move goes, and the lines show as the file has them.
    const key = subtitleFileKey(VIDEO, plain.key);
    player.subtitles.setDrift(null);
    await player.flush();
    expect(stores.subtitleDrifts.get(key)).toBe('none');
    expect(player.subtitles.drift).toBeNull();
    expect(player.subtitles.sync).toEqual({ state: 'yours' });
    expect(last()).toBeCloseTo(stretched[stretched.length - 1]!.start, 5);
    // Another fix, then No fix again: the move does not come back.
    player.subtitles.setDrift('ahead');
    await player.flush();
    player.subtitles.setDrift(null);
    await player.flush();
    expect(stores.subtitleDrifts.get(key)).toBe('none');
    expect(last()).toBeCloseTo(stretched[stretched.length - 1]!.start, 5);
  });

  it('shows none of the drift fixes on for a stretch that is neither, and No fix undoes it', async () => {
    const rate = 24 / (24000 / 1001);
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    const timed = FULL.map((cue) => ({ ...cue, start: cue.start * rate, end: cue.end * rate }));
    const plain = file('plain', timed);
    const last = () => player.subtitles.cues![player.subtitles.cues!.length - 1]!.start;
    offer(entry, [sdh, plain]);
    const player = play(entry);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(player.subtitles.sync).toMatchObject({ state: 'moved', rate });
    expect(player.subtitles).toMatchObject({ drift: null, stretched: true, autoDrift: false });
    expect(last()).toBeCloseTo(FULL[FULL.length - 1]!.start, 0);
    expect(driftOn(player.subtitles, null)).toBe(false);
    expect(driftHintKey(player.subtitles)).toBe('player.driftAligned');
    player.subtitles.setDrift(null);
    await player.flush();
    expect(stores.subtitleDrifts.get(subtitleFileKey(VIDEO, plain.key))).toBe('none');
    expect(player.subtitles.stretched).toBe(false);
    expect(last()).toBeCloseTo(timed[timed.length - 1]!.start, 5);
  });

  it('says the lines are left as the viewer chose once they pick a drift fix over the move', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    const plain = file('plain', shift(FULL, 3));
    const other = file('other', shift(FULL, -2));
    // A drift fix the viewer chose for the other file before: it would not be moved.
    await stores.subtitleDrifts.remember(subtitleFileKey(VIDEO, other.key), 'ahead');
    offer(entry, [sdh, plain, other]);
    const player = play(entry);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
    // Lined up for sure, but its row does not say it is in step: picked, it would not move.
    expect(player.subtitles.checkOf(fileChoice(other)!)).toBeDefined();
    expect(player.subtitles.checkOf(fileChoice(other)!)).not.toHaveProperty('synced');
    player.subtitles.setDrift('ahead');
    await player.flush();
    expect(player.subtitles.sync).toEqual({ state: 'yours' });
    expect(player.subtitles.checkOf(fileChoice(plain)!)).not.toHaveProperty('synced');
    expect(firstStart(player.subtitles)).toBeCloseTo((FULL[0]!.start + 3) / (24000 / 1001 / 25), 3);
  });

  it('moves lines as early ones, however little, while the video is before the first of them', async () => {
    const entry = streamEntry('film-hls');
    // 0.2 s late, its first line a minute in: near enough to leave once a line has shown.
    const near = file(
      'near',
      shift(FULL, 0.2).filter((cue) => cue.start > 60),
    );
    offer(entry, [near]);
    const player = play(entry, { engine: 'hls.js', text: [track('fr|French', 'fr')] });
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(near));
    expect(player.subtitles.cues).not.toBeNull();
    // The track's lines come late, ten seconds into the video: no line of the file has shown.
    await player.session({ position: 10, streamTimings: { 'fr|French': timings(FULL) } });
    await player.wait(300);
    expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
    if (player.subtitles.sync?.state === 'moved') {
      expect(player.subtitles.sync.offset).toBeCloseTo(-0.2, 1);
    }
  });

  describe('with a hash read after the files were asked for', () => {
    /** Linked to the video by OpenSubtitles asked again with the hash: it came late. */
    const linkedLate = (cues: Cue[]) =>
      file('late', cues, { label: 'some_film_subs.srt', hashMatch: true, linkedLate: true });

    it('says the file showing is still being checked while the hash may link one', async () => {
      const entry = streamEntry('film');
      const plain = file('plain', shift(FULL, 3));
      const more = offer(entry, [plain], 1, true);
      const player = play(entry);
      await player.wait(2500);
      expect(player.subtitles.choice).toEqual(fileChoice(plain));
      expect(player.subtitles.cues).not.toBeNull();
      expect(player.subtitles.sync).toEqual({ state: 'checking' });
      // The hash failed: nothing more can come to check it against.
      more([], 0, false);
      await player.flush();
      expect(player.subtitles.sync).toEqual({ state: 'unchecked' });
    });

    it('counts the hash being read as no addon still to answer', async () => {
      const entry = streamEntry('film');
      const plain = file('plain', shift(FULL, 3));
      // The list counts the hash being read as one still to answer: the sheet does not.
      const more = offer(entry, [plain], 1, 'reading');
      const player = play(entry);
      await player.wait(2500);
      expect(player.subtitles.pending).toBe(0);
      expect(player.subtitles.hashReading).toBe(true);
      // Read: OpenSubtitles is asked again, and that is an addon still to answer.
      more([], 1, true);
      await player.flush();
      expect(player.subtitles.pending).toBe(1);
      expect(player.subtitles.hashReading).toBe(false);
    });

    it('takes the place of the file showing before its first line is due', async () => {
      const entry = streamEntry('film');
      // Its first line comes at 30 s; the video is at its start.
      const plain = file('plain', shift(FULL, 30));
      const more = offer(entry, [plain], 1, true);
      const player = play(entry);
      await player.wait(2500);
      expect(player.subtitles.choice).toEqual(fileChoice(plain));
      expect(player.subtitles.cues).not.toBeNull();
      more([linkedLate(shift(FULL, 30))]);
      await player.wait(300);
      expect(player.subtitles.choice).toEqual({ kind: 'file', key: 'os#late' });
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 30, 1);
      expect(recentSubtitleTraces()[0]).toMatchObject({ reason: 'linked to your video' });
    });

    it('is read to line the file showing up against once its lines show, and never shown', async () => {
      const entry = streamEntry('film');
      const plain = file('plain', shift(FULL, 3));
      const more = offer(entry, [plain], 1, true);
      const player = play(entry, { position: 10 });
      await player.wait(2500);
      expect(player.subtitles.choice).toEqual(fileChoice(plain));
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 3, 5);
      expect(player.subtitles.sync).toEqual({ state: 'checking' });
      const late = linkedLate(FULL);
      more([late]);
      await player.wait(300);
      // It stays, its lines moved once, late, onto the file the hash linked.
      expect(player.subtitles.choice).toEqual(fileChoice(plain));
      expect(world.loads).toContain(late.url);
      await player.wait(2000);
      expect(player.subtitles.choice).toEqual(fileChoice(plain));
      expect(player.subtitles.sync).toMatchObject({ state: 'moved', rate: 1 });
      if (player.subtitles.sync?.state === 'moved') {
        expect(player.subtitles.sync.offset).toBeCloseTo(-3, 1);
      }
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
      expect(recentSubtitleTraces()[0]).toMatchObject({ reference: 'linked' });
      expect(player.subtitles.checkOf(fileChoice(late)!)).not.toHaveProperty('synced');
    });
  });

  it('keeps a file’s row and Timing to what is known when it is the reference with nothing else', async () => {
    const entry = streamEntry('film');
    const sdh = linkedSdh();
    offer(entry, [sdh]);
    const player = play(entry);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(sdh));
    expect(player.subtitles.sync).toBeNull();
    expect(player.subtitles.checkOf(fileChoice(sdh)!)).not.toHaveProperty('synced');
  });

  describe('on Android, against the lines it hands over as the video plays', () => {
    const french = track('2:0', 'fr', { picture: false });
    const upTo = (minutes: number, by = 0) =>
      timings(shift(FULL, by)).filter((line) => line.end <= minutes * 60);

    it('moves lines already showing once, late, when far enough out', async () => {
      const entry = streamEntry('film-android');
      const english = file('english', shift(FULL, 2));
      const second = file('second', shift(FULL, -1));
      const third = file('third', shift(FULL, 1.5));
      offer(entry, [english, second, third]);
      const player = play(entry, { engine: 'android', text: [french] });
      await player.wait(2500);
      expect(player.subtitles.choice).toEqual(fileChoice(english));
      expect(player.selected[player.selected.length - 1]).toBe('2:0');
      expect(player.subtitles.sync).toEqual({ state: 'checking' });
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 2, 5);
      // Forty minutes in, its lines showing all along: lined up for sure, it is moved, once.
      await player.session({ position: 2400, streamTimings: { '2:0': upTo(40) } });
      await player.wait(300);
      expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
      // Another picked now is lined up before any of its lines shows: moved, as from the start.
      for (const option of [second, third]) {
        player.subtitles.choose(fileChoice(option), 'version');
        await player.wait(1000);
        expect(player.subtitles.choice).toEqual(fileChoice(option));
        expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
        expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
      }
    });

    it('leaves lines already showing that are near enough in step, and ones the viewer timed', async () => {
      const entry = streamEntry('film-android');
      const near = file('near', shift(FULL, 0.2));
      offer(entry, [near]);
      const player = play(entry, { engine: 'android', text: [french] });
      await player.wait(2500);
      await player.session({ position: 2400, streamTimings: { '2:0': upTo(40) } });
      await player.wait(300);
      expect(player.subtitles.sync).toEqual({ state: 'inStep' });
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 0.2, 5);

      const timed = streamEntry('film-android-2');
      const out = file('out', shift(FULL, 2));
      offer(timed, [out]);
      const other = play(timed, { engine: 'android', text: [french] });
      await other.wait(2500);
      other.subtitles.setOffset(-1.5);
      await other.flush();
      await other.session({ position: 2400, streamTimings: { '2:0': upTo(40) } });
      await other.wait(300);
      expect(other.subtitles.sync).toEqual({ state: 'yours' });
      expect(other.subtitles.offset).toBe(-1.5);
      expect(firstStart(other.subtitles)).toBeCloseTo(FULL[0]!.start + 2, 5);
      // Left as the viewer set them: its row does not say it is in step.
      expect(other.subtitles.checkOf(fileChoice(out)!)).not.toHaveProperty('synced');
    });

    it('takes the timing the viewer kept on lined-up lines into account before moving them late', async () => {
      const entry = streamEntry('film-android');
      // 0.25 s late, with +0.3 s set on lines lined up before: they show 0.55 s late now, and the
      // move with that timing puts them 0.3 s late, near enough: left.
      const near = file('near', shift(FULL, 0.25));
      await stores.subtitleOffsets.remember(subtitleFileKey(VIDEO, near.key), 0.3);
      await stores.subtitleDrifts.remember(subtitleFileKey(VIDEO, near.key), 'aligned');
      offer(entry, [near]);
      const player = play(entry, { engine: 'android', text: [french] });
      await player.wait(2500);
      await player.session({ position: 2400, streamTimings: { '2:0': upTo(40) } });
      await player.wait(300);
      expect(player.subtitles.sync).toEqual({ state: 'inStep' });
    });

    it('changes nothing for a timing or drift fix pressed that is already in use', async () => {
      const entry = streamEntry('film-android');
      const english = file('english', shift(FULL, 2));
      offer(entry, [english]);
      const player = play(entry, { engine: 'android', text: [french] });
      await player.wait(2500);
      // No fix is on, and the timing at +0.0 s: pressing them is no choice of the viewer's.
      player.subtitles.setDrift(null);
      player.subtitles.setOffset(0);
      await player.flush();
      await player.session({ position: 2400, streamTimings: { '2:0': upTo(40) } });
      await player.wait(300);
      expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
      expect(stores.subtitleDrifts.get(subtitleFileKey(VIDEO, english.key))).toBeUndefined();
    });

    it('does not let a file lined up later take over from the one showing long after its first line', async () => {
      const entry = streamEntry('film-android');
      // In step for a quarter of an hour, then 6 s out: two parts that line up differently.
      const first = file(
        'first',
        FULL.map((cue) =>
          cue.start < 900 ? cue : { ...cue, start: cue.start + 6, end: cue.end + 6 },
        ),
      );
      const second = file('second', shift(FULL, 2));
      offer(entry, [first, second]);
      const player = play(entry, { engine: 'android', text: [french] });
      await player.wait(2500);
      expect(player.subtitles.choice).toEqual(fileChoice(first));
      await player.session({ position: 1320, streamTimings: { '2:0': upTo(22) } });
      await player.wait(300);
      await player.session({ position: 2400, streamTimings: { '2:0': upTo(40) } });
      await player.wait(300);
      expect(player.subtitles.checkOf(fileChoice(second)!)).toMatchObject({ synced: 'video' });
      expect(player.subtitles.choice).toEqual(fileChoice(first));
    });

    it('lines a file up after a resume late in the film, and looks again as more lines come', async () => {
      const entry = streamEntry('film-android');
      const english = file('english', shift(FULL, 5));
      offer(entry, [english]);
      const player = play(entry, { engine: 'android', text: [french], position: 5600 });
      await player.wait(2500);
      const from = (seconds: number) =>
        timings(FULL).filter((line) => line.start >= 5600 && line.end <= 5600 + seconds);
      // Five minutes of lines, though the last passes three quarters of the video: still to come.
      await player.session({ position: 5900, streamTimings: { '2:0': from(300) } });
      await player.wait(300);
      expect(player.subtitles.sync).toEqual({ state: 'checking' });
      expect(player.subtitles.checkOf(fileChoice(english)!)).not.toHaveProperty('synced');
      // Over twenty minutes of them: lined up, and moved.
      await player.session({ position: 6900, streamTimings: { '2:0': from(1300) } });
      await player.wait(300);
      expect(player.subtitles.sync).toMatchObject({ state: 'moved' });
      if (player.subtitles.sync?.state === 'moved') {
        expect(player.subtitles.sync.offset).toBeCloseTo(-5, 1);
      }
    });
  });
});

describe('files that agree with each other', () => {
  const shift = (cues: Cue[], by: number): Cue[] =>
    cues.map((cue) => ({ ...cue, start: cue.start + by, end: cue.end + by }));
  const firstStart = (subtitles: Subtitles) => subtitles.cues?.[0]?.start;
  const AMZN = 'Show.S01E06.1080p.AMZN.WEB-DL.DDP5.1.H.264';
  /** The video: an AMZN release no file is named for, with no hash. */
  const RELEASE_OF_E6 = 'Show.S01E06.2160p.AMZN.WEB-DL.DDP5.1.HEVC-Grp';
  const amznVideo = () => streamEntry(RELEASE_OF_E6);
  /** E6's shape: the viewer's best file 8 s late, three AMZN files from other groups in step. */
  function e6(extra: SubtitleOption[] = []) {
    const real = file('real', shift(FULL, 8), { label: 'Show.S01E06.WEB.REAL.srt' });
    const amzn = [
      file('ntb', FULL, { lang: 'spa', label: `${AMZN}-NTb.srt` }),
      file('flux', FULL, { lang: 'dut', label: `${AMZN}-FLUX.srt` }),
      file('kings', FULL, { lang: 'eng', label: `${AMZN}-KiNGS.srt`, ms: 400 }),
    ];
    return { real, amzn, options: [real, ...amzn, ...extra] };
  }
  const synced = (player: ReturnType<typeof play>) => syncLine(player.subtitles.sync);

  it('move a late file onto their timing, and say so', async () => {
    const entry = amznVideo();
    const { real, amzn, options } = e6();
    offer(entry, options);
    const player = play(entry);
    await player.wait(300);
    expect(player.subtitles.choice).toEqual(fileChoice(real));
    // Deciding: checked against other subtitles.
    expect(player.subtitles.sync).toEqual({ state: 'checking', basis: 'files' });
    expect(synced(player)).toEqual({ key: 'player.syncCheckingFiles' });
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(real));
    expect(player.subtitles.sync).toMatchObject({ state: 'moved', rate: 1, basis: 'files' });
    expect(synced(player)).toEqual({ key: 'player.syncMovedFiles', amount: '−8.0 s' });
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
    expect(player.subtitles.offset).toBe(0);
    // Its row says it matches other subtitles (`versionNotes`: 'agreed').
    expect(player.subtitles.checkOf(fileChoice(real)!)).toMatchObject({ synced: 'files' });
    // The file the planner read is not asked for again to be lined up; one it is still reading
    // is shared by the loader. Each of the others once.
    expect(world.passes).not.toContain(real.url);
    expect(new Set(world.passes).size).toBe(world.passes.length);
    expect(new Set(world.loads).size).toBe(options.length);
    const [trace] = recentSubtitleTraces();
    expect(trace?.agreement).toMatchObject({
      state: 'moved',
      best: 9,
      service: 'amzn',
      read: 4,
    });
    expect(trace?.reference).toBe('agreed');
    // The English file of the winner was lined up against the leader too: in step.
    expect(player.subtitles.checkOf(fileChoice(amzn[2]!)!)).toMatchObject({ synced: 'files' });
  });

  it('leave a version picked by hand as picked, saying how far they would move it', async () => {
    const entry = amznVideo();
    const plain = file('plain', shift(FULL, 3), { label: 'Show.S01E06.1080p.WEB.h264-ETHEL.srt' });
    const { options } = e6([plain]);
    offer(entry, options);
    const player = play(entry);
    await player.wait(3300);
    expect(player.subtitles.sync).toMatchObject({ state: 'moved', basis: 'files' });
    player.subtitles.choose(fileChoice(plain), 'version');
    await player.wait(1500);
    expect(player.subtitles.choice).toEqual(fileChoice(plain));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 3, 1);
    expect(player.subtitles.sync).toMatchObject({ state: 'picked', basis: 'files' });
    expect(synced(player)).toEqual({ key: 'player.syncPickedFiles', amount: '−3.0 s' });
  });

  it('leave lines the viewer timed as theirs, saying how far they would move them', async () => {
    const entry = amznVideo();
    const { real, options } = e6();
    offer(entry, options);
    const player = play(entry);
    await player.wait(300);
    player.subtitles.setOffset(0.5);
    await player.wait(3000);
    expect(player.subtitles.choice).toEqual(fileChoice(real));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
    expect(player.subtitles.sync).toMatchObject({ state: 'yours', basis: 'files' });
    expect(synced(player)).toEqual({ key: 'player.syncYoursFiles', amount: '−8.5 s' });
  });

  it('move nothing where they do not agree, and say so', async () => {
    // A video naming no service: three plain WEB files in step, the viewer's 12 s from them.
    const entry = streamEntry('Show.S01E01.1080p.WEB-DL-Grp');
    const WEB = 'Show.S01E01.1080p.WEB.h264';
    const own = file('own', shift(FULL, 12), { label: `${WEB}-APART.srt` });
    const others = [
      file('w0', FULL, { lang: 'fre', label: `${WEB}-RA0.srt` }),
      file('w1', FULL, { lang: 'spa', label: `${WEB}-RB1.srt` }),
      file('w2', FULL, { lang: 'ger', label: `${WEB}-RC2.srt` }),
    ];
    offer(entry, [own, ...others]);
    const player = play(entry);
    await player.wait(3300);
    expect(player.subtitles.choice).toEqual(fileChoice(own));
    expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 12, 5);
    expect(player.subtitles.sync).toEqual({ state: 'disagree' });
    expect(synced(player)).toEqual({ key: 'player.syncDisagree' });
    expect(recentSubtitleTraces()[0]?.agreement).toMatchObject({
      state: 'none',
      why: { kind: 'apart', score: 1, rate: 1 },
    });
  });

  it('never run beside a file named for the release', async () => {
    const entry = amznVideo();
    const named = file('named', FULL, {
      label: 'Show.S01E06.2160p.AMZN.WEB-DL.DDP5.1.HEVC-Grp.srt',
    });
    const { options } = e6();
    offer(entry, [...options, named]);
    const player = play(entry);
    await player.wait(3300);
    expect(recentSubtitleTraces()[0]?.agreement).toBeUndefined();
    expect(player.subtitles.sync?.basis).toBeUndefined();
    // Only what the planner reads.
    expect(world.loads.length).toBeLessThanOrEqual(3);
  });

  describe('handing over what they decided', () => {
    const RELEASE = RELEASE_OF_E6;
    const agreement = () => recentSubtitleTraces()[0]?.agreement;

    it('hand over nothing beside a file named for the release from the last addon to answer', async () => {
      const entry = amznVideo();
      const { real, options } = e6();
      const more = offer(entry, options, 1);
      const player = play(entry);
      await player.wait(3300);
      // Decided, but an addon is still to answer: nothing moved, and Diagnostics says it waits.
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
      expect(player.subtitles.sync).toEqual({ state: 'checking', basis: 'files' });
      expect(agreement()).toMatchObject({ state: 'waiting', read: 4, aligned: 6 });
      // A French file named for this very release: files that agree never run beside one.
      const named = file('named', shift(FULL, 8), { lang: 'fre', label: `${RELEASE}.srt` });
      more([named], 0);
      await player.wait(2000);
      expect(player.subtitles.choice).toEqual(fileChoice(real));
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
      expect(player.subtitles.sync?.basis).toBeUndefined();
      expect(agreement()).toEqual({ state: 'not needed', read: 4, aligned: 6 });
    });

    it('decide again with the files the last addon adds, and hand that over', async () => {
      const entry = amznVideo();
      const { real, options } = e6();
      const more = offer(entry, options, 1);
      const player = play(entry);
      await player.wait(3300);
      expect(agreement()).toMatchObject({ state: 'waiting' });
      // Three more AMZN files of one group, in step with the viewer's: the two groups are too
      // close to tell apart, as when all are offered at once.
      const GROUP = 'Show.S01E06.2160p.AMZN.WEB-DL.DDP5.1.HEVC';
      more(
        [
          file('d1', shift(FULL, 8), { lang: 'pol', label: `${GROUP}-AAA.srt` }),
          file('d2', shift(FULL, 8), { lang: 'rum', label: `${GROUP}-BBB.srt` }),
          file('d3', shift(FULL, 8), { lang: 'hun', label: `${GROUP}-CCC.srt` }),
        ],
        0,
      );
      await player.wait(3000);
      expect(player.subtitles.choice).toEqual(fileChoice(real));
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
      expect(player.subtitles.sync).toEqual({ state: 'disagree' });
      expect(agreement()).toMatchObject({ state: 'none', why: { kind: 'close' }, read: 7 });
    });

    // The hash, read late, links a Spanish file through OpenSubtitles asked again (or a slow
    // addon offers one): before they decided or after, nothing they decided is handed over.
    for (const [when, linkedLate] of [
      ['before they decided', true],
      ['after they decided', true],
      ['after they decided, from a slow addon', false],
    ] as const) {
      it(`hand over nothing beside a file linked to the video ${when}`, async () => {
        const entry = amznVideo();
        const { real, options } = e6();
        const more = offer(entry, options, 1, linkedLate);
        const player = play(entry);
        await player.wait(when === 'before they decided' ? 50 : 3300);
        const linked = file('linked', shift(FULL, 8), {
          lang: 'spa',
          label: 'some_name.srt',
          hashMatch: true,
          ...(linkedLate && { linkedLate: true }),
        });
        more([linked], 0, false);
        await player.wait(3000);
        expect(player.subtitles.choice).toEqual(fileChoice(real));
        expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
        expect(player.subtitles.sync?.basis).toBeUndefined();
        expect(agreement()).toMatchObject({ state: 'not needed' });
      });
    }

    it('wait for the video’s length to judge each file whole', async () => {
      const entry = amznVideo();
      const { real, options } = e6();
      offer(entry, options);
      const player = play(entry, { duration: 0 });
      await player.wait(1500);
      expect(agreement()).toBeUndefined();
      await player.session({ duration: VIDEO_S });
      await player.wait(5000);
      expect(player.subtitles.choice).toEqual(fileChoice(real));
      expect(player.subtitles.sync).toMatchObject({ state: 'moved', basis: 'files' });
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
      expect(agreement()).toMatchObject({ state: 'moved', read: 4, aligned: 6 });
    });

    it('keep the file of theirs they switched to, though the planner never read it', async () => {
      const entry = amznVideo();
      // The viewer's two English files line up with nothing; the English AMZN file is third, so
      // only the files that agree read it.
      const odd = file('odd', shift(lines(900, 7000), 30), { label: 'Show.S01E06.WEB.ODD.srt' });
      const odd2 = file('odd2', shift(lines(700, 7000), 30), { label: 'Show.S01E06.WEB.ODD2.srt' });
      const kings = file('kings', shift(FULL, 30), { lang: 'eng', label: `${AMZN}-KiNGS.srt` });
      offer(entry, [
        odd,
        odd2,
        file('ntb', shift(FULL, 30), { lang: 'spa', label: `${AMZN}-NTb.srt` }),
        file('flux', shift(FULL, 30), { lang: 'dut', label: `${AMZN}-FLUX.srt` }),
        kings,
      ]);
      const player = play(entry);
      const shown: string[] = [];
      for (let t = 0; t < 80; t++) {
        await player.wait(100);
        const key = player.subtitles.choice?.kind === 'file' ? player.subtitles.choice.key : '';
        if (shown[shown.length - 1] !== key) shown.push(key);
      }
      // Once switched to, it stays.
      expect(shown).toContain(kings.key);
      expect(shown.slice(shown.indexOf(kings.key))).toEqual([kings.key]);
      expect(player.subtitles.sync).toEqual({ state: 'inStep', basis: 'files' });
      expect(agreement()).toMatchObject({ state: 'switched', file: 3 });
    });

    it('move the file showing instead of switching once its lines show before they hand over', async () => {
      const entry = amznVideo();
      const odd = file('odd', shift(lines(900, 7000), 30), { label: 'Show.S01E06.WEB.ODD.srt' });
      const odd2 = file('odd2', shift(lines(700, 7000), 30), { label: 'Show.S01E06.WEB.ODD2.srt' });
      const more = offer(
        entry,
        [
          odd,
          odd2,
          file('ntb', shift(FULL, 30), { lang: 'spa', label: `${AMZN}-NTb.srt` }),
          file('flux', shift(FULL, 30), { lang: 'dut', label: `${AMZN}-FLUX.srt` }),
          file('kings', shift(FULL, 30), { lang: 'eng', label: `${AMZN}-KiNGS.srt` }),
        ],
        1,
      );
      const player = play(entry);
      await player.wait(8000);
      expect(agreement()).toMatchObject({ state: 'waiting' });
      // The video reaches the file's first line while the last addon is still to answer.
      await player.session({ position: 30.5 });
      await player.wait(200);
      more([], 0);
      await player.wait(3000);
      // Decided again as no other file may take over: the file showing lines up with none of
      // theirs, so it stays as it is.
      expect(player.subtitles.choice).toEqual(fileChoice(odd));
      expect(player.subtitles.sync).toEqual({ state: 'unmatched', basis: 'files' });
      expect(agreement()).toMatchObject({ state: 'none', why: { kind: 'unmatched' } });
    });
  });

  describe('beside timing the viewer set', () => {
    it('leave the timing kept for a file on an earlier play as theirs, on any stream', async () => {
      const entry = amznVideo();
      const { real, options } = e6();
      offer(entry, options);
      const first = play(entry);
      await first.wait(300);
      first.subtitles.setOffset(-7.5);
      await first.wait(3000);
      expect(first.subtitles.sync).toEqual({ state: 'yours', basis: 'files', offset: -0.5 });
      first.unmount();
      // The next play of the same release: the timing kept for the file is the viewer's still.
      const again = amznVideo();
      offer(again, options);
      const second = play(again);
      await second.wait(3300);
      expect(second.subtitles.choice).toEqual(fileChoice(real));
      expect(second.subtitles.offset).toBe(-7.5);
      expect(firstStart(second.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
      expect(second.subtitles.sync).toEqual({ state: 'yours', basis: 'files', offset: -0.5 });
      expect(synced(second)).toEqual({ key: 'player.syncYoursFiles', amount: '−0.5 s' });
      // Another stream of the video: the same.
      const other = streamEntry(RELEASE_OF_E6, 'other');
      offer(other, options);
      await second.stream(other);
      await second.wait(3300);
      expect(second.subtitles.offset).toBe(-7.5);
      expect(firstStart(second.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
      expect(second.subtitles.sync).toEqual({ state: 'yours', basis: 'files', offset: -0.5 });
    });

    it('leave lines timed while they still read as the viewer’s', async () => {
      const entry = amznVideo();
      const real = file('real', shift(FULL, 8), { label: 'Show.S01E06.WEB.REAL.srt' });
      offer(entry, [
        real,
        file('kings', FULL, { lang: 'eng', label: `${AMZN}-KiNGS.srt`, ms: 400 }),
        file('ntb', FULL, { lang: 'spa', label: `${AMZN}-NTb.srt`, ms: 1500 }),
        file('flux', FULL, { lang: 'dut', label: `${AMZN}-FLUX.srt`, ms: 1500 }),
      ]);
      const player = play(entry);
      await player.wait(100);
      player.subtitles.setOffset(0.5);
      await player.wait(4000);
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start + 8, 1);
      expect(player.subtitles.sync).toEqual({ state: 'yours', basis: 'files', offset: -8.5 });
      expect(synced(player)).toEqual({ key: 'player.syncYoursFiles', amount: '−8.5 s' });
    });

    it('say lines already where they would put them are in step: timed, or a version picked', async () => {
      const entry = amznVideo();
      const other = file('other', FULL, { lang: 'eng', label: `${AMZN}-CMRG.srt` });
      const { options } = e6([other]);
      offer(entry, options);
      const player = play(entry);
      await player.wait(300);
      player.subtitles.setOffset(-8);
      await player.wait(3000);
      expect(player.subtitles.sync).toEqual({ state: 'inStep', basis: 'files' });
      expect(synced(player)).toEqual({ key: 'player.syncInStepFiles' });
      player.subtitles.setOffset(0);
      player.subtitles.choose(fileChoice(other), 'version');
      await player.wait(2000);
      expect(player.subtitles.choice).toEqual(fileChoice(other));
      expect(firstStart(player.subtitles)).toBeCloseTo(FULL[0]!.start, 1);
      expect(player.subtitles.sync).toEqual({ state: 'inStep', basis: 'files' });
      expect(player.subtitles.checkOf(fileChoice(other)!)).toMatchObject({ synced: 'files' });
    });

    it('leave a file with the viewer’s timing, its lines on screen, to a file linked late', async () => {
      const entry = streamEntry('film');
      // Its first line at 20 s in the file, moved 7.5 s earlier on an earlier play: on screen
      // from 12.5 s.
      const plain = file('plain', shift(FULL, 20));
      offer(entry, [plain]);
      const first = play(entry);
      await first.wait(2500);
      first.subtitles.setOffset(-7.5);
      await first.wait(300);
      first.unmount();
      const again = streamEntry('film');
      const more = offer(again, [plain], 1, true);
      const player = play(again);
      await player.wait(2500);
      expect(player.subtitles.offset).toBe(-7.5);
      await player.session({ position: 14 });
      await player.wait(200);
      more([
        file('late', shift(FULL, 20), {
          label: 'some_film_subs.srt',
          hashMatch: true,
          linkedLate: true,
        }),
      ]);
      await player.wait(500);
      expect(player.subtitles.choice).toEqual(fileChoice(plain));
    });
  });

  it('say the file showing is in step where it is the first of theirs', async () => {
    // E5's shape: the viewer's file read first is in step with the AMZN files.
    const entry = amznVideo();
    const web = file('web', FULL, { label: 'Show.S01E06.WEB.srt' });
    const kings = file('kings', FULL, { lang: 'eng', label: `${AMZN}-KiNGS.srt` });
    offer(entry, [
      web,
      kings,
      file('ntb', FULL, { lang: 'spa', label: `${AMZN}-NTb.srt` }),
      file('flux', FULL, { lang: 'dut', label: `${AMZN}-FLUX.srt` }),
    ]);
    const player = play(entry);
    await player.wait(3300);
    expect(player.subtitles.choice).toEqual(fileChoice(web));
    expect(player.subtitles.sync).toEqual({ state: 'inStep', basis: 'files' });
    expect(synced(player)).toEqual({ key: 'player.syncInStepFiles' });
    expect(player.subtitles.checkOf(fileChoice(web)!)).toMatchObject({ synced: 'files' });
    expect(recentSubtitleTraces()[0]?.agreement).toMatchObject({ state: 'kept', best: 10 });
  });
});
