import {
  continueWatching,
  createPlayedVideos,
  createProgressStore,
  createStore,
  memoryKeyValueStore,
  playedCard,
  type Profile,
  type ProfilesState,
  type Store,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchNextCard } from './watch-next';

const app = vi.hoisted(() => ({
  time: 0,
  progress: null as unknown as ReturnType<typeof createProgressStore>,
  played: null as unknown as ReturnType<typeof createPlayedVideos>,
  profiles: null as unknown as Store<ProfilesState>,
  activeId: null as unknown as Store<string | null>,
  router: null as unknown as Store<{ top: string }>,
  /** The installed addons' addresses. */
  addons: [] as string[],
}));

vi.mock('./addons', () => ({
  addonCollection: {
    get: () => ({ addons: app.addons.map((transportUrl) => ({ transportUrl })) }),
  },
}));

vi.mock('./playback', () => ({
  get progress() {
    return app.progress;
  },
  get playedVideos() {
    return app.played;
  },
}));

vi.mock('./profiles', () => {
  const activeProfile = () => app.profiles.get().profiles.find((p) => p.id === app.activeId.get());
  return {
    get profiles() {
      return app.profiles;
    },
    get activeProfileId() {
      return app.activeId;
    },
    activeProfile,
    isKidsProfile: () => activeProfile()?.kids !== undefined,
  };
});

vi.mock('../app/router', () => ({
  get router() {
    return app.router;
  },
  topRoute: () => ({ name: app.router.get().top }),
}));

vi.mock('i18next', () => ({
  default: {
    t: (_key: string, values: { name: string; season: number; episode: number }) =>
      `${values.name} S${values.season}:E${values.episode}`,
  },
}));

type WatchNext = typeof import('./watch-next');

function preview(id: string, type: 'movie' | 'series', extra: Partial<MetaPreview> = {}) {
  const item: MetaPreview = {
    id,
    type,
    name: `Title ${id}`,
    posterShape: 'poster',
    genres: [],
    trailers: [],
    ...extra,
  };
  return item;
}

function meta(item: MetaPreview, videos: Video[] = []): MetaDetail {
  return {
    ...item,
    videos,
    cast: [],
    directors: [],
    writers: [],
    links: [],
    behaviorHints: { hasScheduledVideos: false },
  };
}

const ep = (show: string, season: number, episode: number, title?: string): Video => ({
  id: `${show}:${season}:${episode}`,
  season,
  episode,
  title: title ?? '',
});

/** A video played to `position` of `duration` seconds, with its Continue Watching card. */
function played(
  item: MetaPreview,
  videoId: string,
  position: number,
  duration: number,
  detail?: MetaDetail,
) {
  app.time += 1000;
  app.played.record(playedCard(item, videoId, detail));
  app.progress.record({ metaId: item.id, type: item.type, videoId, position, duration });
}

const label = (name: string, season: number, episode: number) => `${name} S${season}:E${episode}`;

let watchNext: WatchNext;

beforeEach(async () => {
  app.time = 1_000_000;
  const now = () => app.time;
  app.progress = createProgressStore({ storage: memoryKeyValueStore(), now });
  app.played = createPlayedVideos({ storage: memoryKeyValueStore(), now });
  await Promise.all([app.progress.load(), app.played.load()]);
  app.profiles = createStore<ProfilesState>({
    profiles: [{ id: 'main', name: 'Main', colour: 0 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  app.activeId = createStore<string | null>('main');
  app.router = createStore({ top: 'home' });
  app.addons = [];
  vi.resetModules();
  watchNext = await import('./watch-next');
});

describe('watchNextCards', () => {
  const cards = () =>
    watchNext.watchNextCards(
      continueWatching(app.progress, app.played.get, app.time),
      app.progress,
      app.played.get,
      label,
    );

  it('gives a film left part way its place, length, artwork and when it was watched', () => {
    const film = preview('tt1', 'movie', {
      background: 'https://images.example/tt1/wide.jpg',
      poster: 'https://images.example/tt1/poster.jpg',
      description: 'A film.',
    });
    played(film, 'tt1', 1800, 6000);
    expect(cards()).toEqual([
      {
        type: 'movie',
        meta: 'tt1',
        video: 'tt1',
        title: 'Title tt1',
        description: 'A film.',
        landscape: 'https://images.example/tt1/wide.jpg',
        poster: 'https://images.example/tt1/poster.jpg',
        position: app.progress.resumeAt('tt1')!,
        duration: 6000,
        next: false,
        watchedAt: app.time,
      },
    ] satisfies WatchNextCard[]);
  });

  it('offers the next episode after a finished one, from its beginning', () => {
    const show = preview('tt2', 'series');
    const detail = meta(show, [ep('tt2', 1, 1, 'Pilot'), ep('tt2', 1, 2, 'The Second')]);
    played(show, 'tt2:1:1', 2990, 3000, detail);
    expect(cards()).toEqual([
      {
        type: 'series',
        meta: 'tt2',
        video: 'tt2:1:2',
        title: 'Title tt2 S1:E2',
        episodeTitle: 'The Second',
        season: 1,
        episode: 2,
        position: 0,
        duration: 0,
        next: true,
        watchedAt: app.time,
      },
    ] satisfies WatchNextCard[]);
  });

  it('names the episode left part way, with its place, most recently watched first', () => {
    const show = preview('tt3', 'series');
    const detail = meta(show, [ep('tt3', 2, 5, 'Middle')]);
    played(preview('tt4', 'movie'), 'tt4', 600, 6000);
    played(show, 'tt3:2:5', 900, 2700, detail);
    const [first, second] = cards();
    expect(first).toMatchObject({
      meta: 'tt3',
      video: 'tt3:2:5',
      title: 'Title tt3 S2:E5',
      episodeTitle: 'Middle',
      season: 2,
      episode: 5,
      duration: 2700,
      next: false,
    });
    expect(first!.position).toBeGreaterThan(0);
    expect(second).toMatchObject({ meta: 'tt4', next: false });
    expect(first!.watchedAt).toBeGreaterThan(second!.watchedAt);
  });

  it('starts an episode barely begun from the beginning', () => {
    const show = preview('tt5', 'series');
    played(show, 'tt5:1:3', 10, 2700, meta(show, [ep('tt5', 1, 3)]));
    expect(cards()).toEqual([
      expect.objectContaining({ video: 'tt5:1:3', position: 0, duration: 2700, next: true }),
    ]);
    expect(cards()[0]).not.toHaveProperty('episodeTitle');
  });
});

describe('hiddenArtwork', () => {
  it('hides artwork from the host of an addon whose address could hold a key', () => {
    const hidden = watchNext.hiddenArtwork([
      'https://meta.example/secret-config/manifest.json',
      'https://plain.example/manifest.json',
      'https://query.example/manifest.json?token=abc',
    ]);
    expect(hidden('https://meta.example/secret-config/poster/tt1.jpg')).toBe(true);
    expect(hidden('https://meta.example/images/tt1.jpg')).toBe(true);
    expect(hidden('https://query.example/poster/tt1.jpg')).toBe(true);
    // An addon at the root of its host has no key in its address.
    expect(hidden('https://plain.example/poster/tt1.jpg')).toBe(false);
    expect(hidden('https://images.example/tt1/poster.jpg')).toBe(false);
    expect(hidden('not an address')).toBe(true);
  });
});

describe('createWatchNextSchedule', () => {
  const card = (meta: string): WatchNextCard => ({
    type: 'movie',
    meta,
    video: meta,
    title: meta,
    position: 60,
    duration: 600,
    next: false,
    watchedAt: 1,
  });

  let list: WatchNextCard[] | null;
  let sent: (readonly WatchNextCard[])[];
  let schedule: ReturnType<WatchNext['createWatchNextSchedule']>;

  beforeEach(() => {
    vi.useFakeTimers();
    list = [card('a')];
    sent = [];
    schedule = watchNext.createWatchNextSchedule({
      read: () => list,
      publish: (cards) => sent.push(cards),
    });
  });

  afterEach(() => {
    schedule.stop();
    vi.useRealTimers();
  });

  it('waits until Continue Watching has been quiet for a while', () => {
    schedule.changed();
    vi.advanceTimersByTime(watchNext.QUIET_MS - 1);
    schedule.changed();
    vi.advanceTimersByTime(watchNext.QUIET_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([[card('a')]]);
  });

  it('follows soon once playback stops, however often progress is saved', () => {
    schedule.changed();
    schedule.soon();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(watchNext.SOON_MS / 4);
      schedule.changed();
    }
    expect(sent).toHaveLength(1);
  });

  it('sends a list only when it differs from the last one', () => {
    schedule.now();
    schedule.now();
    list = [card('b')];
    schedule.now();
    expect(sent).toEqual([[card('a')], [card('b')]]);
  });

  it('leaves the row as it is while there is nothing to go by', () => {
    list = null;
    schedule.now();
    schedule.soon();
    vi.advanceTimersByTime(watchNext.QUIET_MS);
    expect(sent).toEqual([]);
  });
});

describe('startWatchNext', () => {
  let sent: (readonly WatchNextCard[])[];
  let page: EventTarget & { hidden: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', page);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Starts publishing, and lets the stores' reads settle. */
  async function start() {
    watchNext.startWatchNext((cards) => sent.push(cards));
    await vi.advanceTimersByTimeAsync(0);
  }

  /** The list sent last. */
  const last = (): readonly WatchNextCard[] | undefined => sent[sent.length - 1];
  const titles = () => last()?.map((card) => card.meta);

  function withProfiles(profiles: Profile[], active: string | null) {
    app.profiles.set({ profiles, lastId: profiles[0]!.id, askAtLaunch: false });
    app.activeId.set(active);
  }

  it("publishes the profile in use's Continue Watching once it has settled", async () => {
    played(preview('tt1', 'movie'), 'tt1', 1800, 6000);
    await start();
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(titles()).toEqual(['tt1']);
  });

  it('empties the row at once for a profile with a PIN, and while it is in use', async () => {
    played(preview('tt1', 'movie'), 'tt1', 1800, 6000);
    withProfiles(
      [
        { id: 'main', name: 'Main', colour: 0 },
        { id: 'p2', name: 'Locked', colour: 1, pin: { salt: 's', hash: 'h' } },
      ],
      'p2',
    );
    await start();
    expect(sent).toEqual([[]]);
    // Its history changing sends nothing more.
    played(preview('tt2', 'movie'), 'tt2', 1800, 6000);
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(sent).toEqual([[]]);
  });

  it('empties the row as soon as the profile in use is given a PIN', async () => {
    played(preview('tt1', 'movie'), 'tt1', 1800, 6000);
    await start();
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(titles()).toEqual(['tt1']);
    app.profiles.set((state) => ({
      ...state,
      profiles: [{ id: 'main', name: 'Main', colour: 0, pin: { salt: 's', hash: 'h' } }],
    }));
    expect(last()).toEqual([]);
  });

  it('leaves the row alone while nobody has said who is watching', async () => {
    played(preview('tt1', 'movie'), 'tt1', 1800, 6000);
    withProfiles(
      [
        { id: 'main', name: 'Main', colour: 0 },
        { id: 'p2', name: 'Guest', colour: 1 },
      ],
      null,
    );
    await start();
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(sent).toEqual([]);
  });

  it("keeps artwork an addon serves from its own address off the device's row", async () => {
    app.addons = ['https://meta.example/secret-config/manifest.json'];
    const film = preview('tt1', 'movie', {
      poster: 'https://meta.example/secret-config/poster/tt1.jpg',
      background: 'https://images.example/tt1/wide.jpg',
    });
    played(film, 'tt1', 1800, 6000);
    await start();
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(last()).toEqual([
      expect.objectContaining({ meta: 'tt1', landscape: 'https://images.example/tt1/wide.jpg' }),
    ]);
    expect(last()![0]).not.toHaveProperty('poster');
  });

  it("leaves out of a kids profile's row what is not for children", async () => {
    withProfiles([{ id: 'kid', name: 'Kid', colour: 3, kids: 'PG' }], 'kid');
    played(preview('tt1', 'movie', { genres: ['Family'] }), 'tt1', 1800, 6000);
    played(preview('tt2', 'movie', { genres: ['Horror'] }), 'tt2', 1800, 6000);
    await start();
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(titles()).toEqual(['tt1']);
  });

  it('follows within a second of leaving the player, or of the app leaving the screen', async () => {
    await start();
    await vi.advanceTimersByTimeAsync(watchNext.QUIET_MS);
    expect(sent).toEqual([[]]);

    app.router.set({ top: 'player' });
    played(preview('tt1', 'movie'), 'tt1', 1800, 6000);
    app.router.set({ top: 'details' });
    await vi.advanceTimersByTimeAsync(watchNext.SOON_MS);
    expect(titles()).toEqual(['tt1']);

    played(preview('tt2', 'movie'), 'tt2', 1800, 6000);
    page.hidden = true;
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(watchNext.SOON_MS);
    expect(titles()).toEqual(['tt2', 'tt1']);
  });
});
