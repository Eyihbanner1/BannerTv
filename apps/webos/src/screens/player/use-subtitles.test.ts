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
import { driftHintKey, driftOn } from '../../player/subtitle-versions';
import { type SubtitleChoice, type Subtitles, useSubtitles } from './use-subtitles';

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
  cached: new Set<string>(),
  cleared: 0,
}));

vi.mock('../../player/subtitles', () => ({
  // Kept once read, as the real loader keeps the parsed files.
  loadSubtitles(option: { url: string }) {
    world.loads.push(option.url);
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

/** The files offered with a stream, and how many addons are still to answer. */
function offer(entry: StreamEntry, options: SubtitleOption[], pending = 0) {
  const store = createStore<SubtitleListState>({ options, pending });
  world.lists.set(entry.stream, {
    get: store.get,
    subscribe: store.subscribe,
    start: () => undefined,
    stop: () => undefined,
  });
  return (more: SubtitleOption[], stillPending = 0) =>
    store.set({ options: store.get().options.concat(more), pending: stillPending });
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

/** Players still on screen, closed after each test. */
const mounted: Array<() => void> = [];

const fileChoice = (option: SubtitleOption): SubtitleChoice => ({ kind: 'file', key: option.key });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  world.lists.clear();
  world.files.clear();
  world.loads = [];
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
    expect(player.subtitles.checkOf(fileChoice(plain)!)).toMatchObject({ synced: true });
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
      expect(player.subtitles.checkOf(fileChoice(second)!)).toMatchObject({ synced: true });
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
