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

/** Lines spread over the video: `hearing` of every ten are sounds in brackets. */
function lines(count: number, end: number, hearing = 0): Cue[] {
  return Array.from({ length: count }, (_, i) => {
    const start = (i * (end - 2)) / (count - 1);
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
  extra: { lang?: string; label?: string; ms?: number } = {},
) {
  const option: SubtitleOption = {
    key: `os#${id}`,
    lang: extra.lang ?? 'eng',
    source: 'OpenSubtitles v3',
    url: `https://subs.example/${id}.srt`,
  };
  if (extra.label) option.label = extra.label;
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
  rate: 1,
  clip: false,
  attempts: [],
};

/** The player as the hook sees it, with the stream playing and the session's state. */
function play(first: StreamEntry, state: Partial<SessionState> = {}, lab = false) {
  // A Lab stream has no title.
  const metaId = lab ? undefined : META;
  const playing = createStore<SessionState>({ ...BASE, entry: first, ...state });
  const session = {
    get: playing.get,
    subscribe: playing.subscribe,
    selectText: () => undefined,
  } as unknown as PlaybackSession;
  let entry = first;
  let result!: Subtitles;
  // The player screen, drawn once more.
  const Screen = () => {
    react.state.at = 0;
    react.state.dirty = false;
    result = useSubtitles('movie', VIDEO, metaId, entry, session, playing.get());
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
