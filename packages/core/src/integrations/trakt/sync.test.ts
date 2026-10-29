import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../../library/library';
import { createProgressStore } from '../../playback/progress';
import { createWatchedSet, type WatchedSet } from '../../playback/watched';
import { memoryKeyValueStore } from '../../storage';
import { createStore } from '../../store';
import type { TraktAccountState } from './account';
import { createTraktSync } from './sync';
import { TraktError, type TraktMethod, type TraktResponse, type TraktTimers } from './transport';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');

const BATMAN_BEGINS = { trakt: 1, slug: 'batman-begins-2005', imdb: 'tt0372784', tmdb: 272 };
const BREAKING_BAD = {
  trakt: 1388,
  slug: 'breaking-bad',
  tvdb: 81189,
  imdb: 'tt0903747',
  tmdb: 1396,
};

/** sync/last_activities, with every section Trakt sends. */
function lastActivities() {
  return {
    all: '2026-10-27T20:15:04.000Z',
    movies: {
      watched_at: '2026-10-20T21:00:00.000Z',
      collected_at: '2024-01-01T00:00:00.000Z',
      rated_at: '2025-05-05T10:00:00.000Z',
      watchlisted_at: '2026-10-25T10:00:00.000Z',
      favorited_at: '2025-03-01T00:00:00.000Z',
      recommendations_at: '2025-03-01T00:00:00.000Z',
      commented_at: '2024-02-02T00:00:00.000Z',
      paused_at: '2026-10-27T20:15:04.000Z',
      hidden_at: '2024-03-03T00:00:00.000Z',
    },
    episodes: {
      watched_at: '2026-10-26T22:10:00.000Z',
      collected_at: '2024-01-01T00:00:00.000Z',
      rated_at: '2025-05-05T10:00:00.000Z',
      watchlisted_at: '2024-01-01T00:00:00.000Z',
      commented_at: '2024-02-02T00:00:00.000Z',
      paused_at: '2026-10-27T19:00:00.000Z',
    },
    shows: {
      rated_at: '2025-05-05T10:00:00.000Z',
      watchlisted_at: '2026-10-24T09:00:00.000Z',
      favorited_at: '2025-03-01T00:00:00.000Z',
      recommendations_at: '2025-03-01T00:00:00.000Z',
      commented_at: '2024-02-02T00:00:00.000Z',
      hidden_at: '2024-03-03T00:00:00.000Z',
    },
    seasons: {
      rated_at: '2024-01-01T00:00:00.000Z',
      watchlisted_at: '2024-01-01T00:00:00.000Z',
      commented_at: '2024-01-01T00:00:00.000Z',
      hidden_at: '2024-01-01T00:00:00.000Z',
    },
    comments: { liked_at: '2024-01-01T00:00:00.000Z', blocked_at: '2024-01-01T00:00:00.000Z' },
    lists: {
      liked_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      commented_at: '2024-01-01T00:00:00.000Z',
    },
    watchlist: { updated_at: '2026-10-25T10:00:00.000Z' },
    favorites: { updated_at: '2025-03-01T00:00:00.000Z' },
    account: {
      settings_at: '2026-01-01T00:00:00.000Z',
      followed_at: '2024-01-01T00:00:00.000Z',
      following_at: '2024-01-01T00:00:00.000Z',
      pending_at: '2024-01-01T00:00:00.000Z',
      requested_at: '2024-01-01T00:00:00.000Z',
    },
    saved_filters: { updated_at: '2024-01-01T00:00:00.000Z' },
    notes: { updated_at: '2024-01-01T00:00:00.000Z' },
  };
}

/** sync/playback?extended=full. */
function playback(): unknown[] {
  return [
    {
      progress: 10.5,
      paused_at: '2026-10-27T20:15:04.000Z',
      id: 13,
      type: 'movie',
      movie: {
        title: 'Batman Begins',
        year: 2005,
        ids: BATMAN_BEGINS,
        tagline: 'Evil fears the knight.',
        released: '2005-06-15',
        runtime: 140,
        country: 'us',
        genres: ['action', 'crime', 'drama'],
      },
    },
    {
      progress: 65.5,
      paused_at: '2026-10-27T19:00:00.000Z',
      id: 37,
      type: 'episode',
      episode: {
        season: 1,
        number: 3,
        title: "...And the Bag's in the River",
        ids: { trakt: 75, tvdb: 349235, imdb: 'tt1054725', tmdb: 62087 },
        runtime: 48,
      },
      show: { title: 'Breaking Bad', year: 2008, ids: BREAKING_BAD, runtime: 45 },
    },
    {
      // Trakt knows no length for it, so there is no position to give.
      progress: 30,
      paused_at: '2026-10-27T18:00:00.000Z',
      id: 38,
      type: 'movie',
      movie: {
        title: 'Untitled',
        year: 2026,
        ids: { trakt: 2, slug: 'untitled', imdb: 'tt0000002' },
      },
    },
    {
      // A show Trakt has no IMDb or TMDB id for.
      progress: 20,
      paused_at: '2026-10-27T17:00:00.000Z',
      id: 39,
      type: 'episode',
      episode: { season: 1, number: 1, ids: { trakt: 9 }, runtime: 30 },
      show: { title: 'Local news', year: 2026, ids: { trakt: 9, tvdb: 123 }, runtime: 30 },
    },
    null,
    'odd',
    { progress: 'ten', paused_at: '2026-10-27T16:00:00.000Z', type: 'movie', movie: {} },
  ];
}

/** sync/watched/movies. */
function watchedMovies(): unknown[] {
  return [
    {
      plays: 2,
      last_watched_at: '2026-09-01T20:00:00.000Z',
      last_updated_at: '2026-09-01T20:00:00.000Z',
      movie: {
        title: 'The Dark Knight',
        year: 2008,
        ids: { trakt: 120, slug: 'the-dark-knight-2008', imdb: 'tt0468569', tmdb: 155 },
      },
    },
    {
      plays: 1,
      last_watched_at: '2026-10-20T21:00:00.000Z',
      last_updated_at: '2026-10-20T21:00:00.000Z',
      movie: {
        title: 'Brand New',
        year: 2026,
        ids: { trakt: 999, slug: 'brand-new', tmdb: 1234567 },
      },
    },
    { plays: 1, movie: { title: 'Nowhere', ids: { trakt: 5 } } },
  ];
}

/** sync/watched/shows?extended=full. */
function watchedShows(): unknown[] {
  return [
    {
      plays: 2,
      last_watched_at: '2026-10-26T22:10:00.000Z',
      last_updated_at: '2026-10-26T22:10:00.000Z',
      reset_at: null,
      show: { title: 'Breaking Bad', year: 2008, ids: BREAKING_BAD, runtime: 45, network: 'AMC' },
      seasons: [
        {
          number: 1,
          episodes: [
            { number: 1, plays: 1, last_watched_at: '2026-10-20T21:00:00.000Z' },
            { number: 2, plays: 1, last_watched_at: '2026-10-26T22:10:00.000Z' },
          ],
        },
      ],
    },
    {
      // Watched long ago: ticks, but nothing for Continue Watching.
      plays: 2,
      last_watched_at: '2025-01-02T20:00:00.000Z',
      last_updated_at: '2025-01-02T20:00:00.000Z',
      reset_at: null,
      show: {
        title: 'The Wire',
        year: 2002,
        ids: { trakt: 1438, slug: 'the-wire', imdb: 'tt0306414', tmdb: 1438 },
        runtime: 60,
      },
      seasons: [
        {
          number: 1,
          episodes: [
            { number: 1, plays: 1, last_watched_at: '2025-01-01T20:00:00.000Z' },
            { number: 2, plays: 1, last_watched_at: '2025-01-02T20:00:00.000Z' },
          ],
        },
      ],
    },
    {
      // Marked watched in one go, so the episodes share a time.
      plays: 4,
      last_watched_at: '2026-10-10T20:00:00.000Z',
      last_updated_at: '2026-10-10T20:00:00.000Z',
      reset_at: null,
      show: {
        title: 'Severance',
        year: 2022,
        ids: { trakt: 154997, slug: 'severance', imdb: 'tt11280740', tmdb: 95396 },
        runtime: 55,
      },
      seasons: [
        {
          number: 0,
          episodes: [{ number: 1, plays: 1, last_watched_at: '2026-10-10T20:00:00.000Z' }],
        },
        {
          number: 1,
          episodes: [
            { number: 1, plays: 1, last_watched_at: '2026-10-10T20:00:00.000Z' },
            { number: 9, plays: 1, last_watched_at: '2026-10-10T20:00:00.000Z' },
            { number: 2, plays: 1, last_watched_at: '2026-10-10T20:00:00.000Z' },
          ],
        },
        { number: 'two', episodes: [{ number: 1, plays: 1 }] },
      ],
    },
    {
      // No runtime: ticks only.
      plays: 1,
      last_watched_at: '2026-10-27T20:00:00.000Z',
      show: { title: 'Shorts', year: 2026, ids: { trakt: 8, imdb: 'tt0000008' } },
      seasons: [
        {
          number: 1,
          episodes: [{ number: 1, plays: 1, last_watched_at: '2026-10-27T20:00:00.000Z' }],
        },
      ],
    },
  ];
}

function listed(n: number, kind: 'movie' | 'show', title: Record<string, unknown>, at: string) {
  return { rank: n, id: 100 + n, listed_at: at, notes: null, type: kind, [kind]: title };
}

const TRON = {
  title: 'TRON: Legacy',
  year: 2010,
  ids: { trakt: 12601, slug: 'tron-legacy-2010', imdb: 'tt1104001', tmdb: 20526 },
};
const THE_BEAR = {
  title: 'The Bear',
  year: 2022,
  ids: { trakt: 190914, slug: 'the-bear', tvdb: 397172, imdb: 'tt14452776', tmdb: 136315 },
};
const THE_MATRIX = {
  title: 'The Matrix',
  year: 1999,
  ids: { trakt: 481, slug: 'the-matrix-1999', imdb: 'tt0133093', tmdb: 603 },
};

const ok = (data: unknown, status = 200): TraktResponse => ({ status, data });

type Answer = TraktResponse | Promise<TraktResponse>;

interface Ids {
  imdb?: string;
  tmdb?: number;
}

interface WatchlistBody {
  movies: { ids: Ids }[];
  shows: { ids: Ids }[];
}

/** Whether two sets of ids name the same title, as Trakt matches them. */
function sameTitle(a: Ids, b: Ids) {
  return (a.imdb !== undefined && a.imdb === b.imdb) || (a.tmdb !== undefined && a.tmdb === b.tmdb);
}

/** Moves one time in a last_activities answer on, as Trakt does when that part changes. */
function touch(activities: Record<string, unknown>, field: string, at = '2026-10-28T10:00:00Z') {
  const [section = '', name = ''] = field.split('.');
  (activities[section] as Record<string, string>)[name] = at;
}

/** A fake Trakt holding one account's data, which the watchlist calls change. */
function fakeTrakt() {
  const activities: Record<string, unknown> = lastActivities();
  const server = {
    activities,
    playback: playback(),
    watchedMovies: watchedMovies(),
    watchedShows: watchedShows(),
    watchlist: {
      movies: [
        listed(1, 'movie', TRON, '2026-10-25T10:00:00.000Z'),
        listed(2, 'movie', { title: 'Lost', ids: { trakt: 7 } }, '2026-10-25T10:00:00.000Z'),
      ] as unknown[],
      shows: [listed(3, 'show', THE_BEAR, '2026-10-24T09:00:00.000Z')] as unknown[],
    },
    /** Ids Trakt does not know yet. */
    unknown: new Set<string>(),
    /** Titles Trakt knows every id of, and lists with all of them however they were added. */
    catalogue: [THE_MATRIX] as { ids: Ids }[],
    overrides: new Map<string, () => Answer>(),
    calls: [] as { method: TraktMethod; path: string; body?: unknown }[],
    changes: 0,
    answer(method: TraktMethod, path: string, body: unknown): Answer {
      const override = server.overrides.get(`${method} ${path}`);
      if (override) return override();
      switch (`${method} ${path}`) {
        case 'GET /sync/last_activities':
          return ok(server.activities);
        case 'GET /sync/playback?extended=full':
          return ok(server.playback);
        case 'GET /sync/watched/movies':
          return ok(server.watchedMovies);
        case 'GET /sync/watched/shows?extended=full':
          return ok(server.watchedShows);
        case 'GET /sync/watchlist/movies':
          return ok(server.watchlist.movies);
        case 'GET /sync/watchlist/shows':
          return ok(server.watchlist.shows);
        case 'POST /sync/watchlist':
          return ok(server.change(body as WatchlistBody, 'add'), 201);
        case 'POST /sync/watchlist/remove':
          return ok(server.change(body as WatchlistBody, 'remove'));
      }
      return ok({ error: 'not found' }, 404);
    },
    change(body: WatchlistBody, op: 'add' | 'remove') {
      const counts = { movies: 0, shows: 0, seasons: 0, episodes: 0 };
      const notFound = {
        movies: [] as unknown[],
        shows: [] as unknown[],
        seasons: [],
        episodes: [],
      };
      for (const kind of ['movies', 'shows'] as const) {
        const key = kind === 'movies' ? 'movie' : 'show';
        for (const { ids } of body[kind]) {
          const id = ids.imdb ?? `tmdb:${ids.tmdb}`;
          const sameId = (item: unknown) => {
            const title = (item as Record<string, { ids: Ids }>)[key];
            return title !== undefined && sameTitle(title.ids, ids);
          };
          if (server.unknown.has(id)) {
            notFound[kind].push({ ids });
          } else if (op === 'add' && !server.watchlist[kind].some(sameId)) {
            const title = server.catalogue.find((known) => sameTitle(known.ids, ids)) ?? {
              title: `Title ${id}`,
              year: 2020,
              ids: { trakt: 5000, ...ids },
            };
            server.watchlist[kind].push(listed(9, key, title, new Date(NOW).toISOString()));
            counts[kind] += 1;
          } else if (op === 'remove' && server.watchlist[kind].some(sameId)) {
            server.watchlist[kind] = server.watchlist[kind].filter((item) => !sameId(item));
            counts[kind] += 1;
          }
        }
      }
      server.changes += 1;
      const list = { updated_at: new Date(NOW + server.changes).toISOString(), item_count: 0 };
      touch(server.activities, 'watchlist.updated_at', list.updated_at);
      return op === 'add'
        ? {
            added: counts,
            existing: { movies: 0, shows: 0, seasons: 0, episodes: 0 },
            not_found: notFound,
            list,
          }
        : { deleted: counts, not_found: notFound, list };
    },
  };
  return server;
}

type Server = ReturnType<typeof fakeTrakt>;

function fakeAccount(server: Server) {
  const state = createStore<TraktAccountState>({ status: 'signedIn', username: 'sean' });
  const account = {
    load: () => Promise.resolve(),
    get: state.get,
    subscribe: state.subscribe,
    call(method: TraktMethod, path: string, body?: unknown): Promise<TraktResponse> {
      if (state.get().status !== 'signedIn') {
        return Promise.reject(new TraktError('signedOut', 'Not signed in to Trakt'));
      }
      server.calls.push(body === undefined ? { method, path } : { method, path, body });
      return Promise.resolve().then(() => server.answer(method, path, body));
    },
  };
  return { account, state };
}

function preview(id: string, type: string, name: string): MetaPreview {
  return { id, type, name, posterShape: 'poster', genres: [], trailers: [] };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setup(
  options: {
    library?: (library: Library) => Library;
    watched?: (watched: WatchedSet) => WatchedSet;
  } = {},
) {
  const storage = memoryKeyValueStore();
  const clock = { now: NOW };
  const now = () => clock.now;
  const server = fakeTrakt();
  const { account, state } = fakeAccount(server);
  const progress = createProgressStore({ storage, now });
  const library = createLibrary({ storage, now });
  const watched = createWatchedSet({ storage });
  const waits: number[] = [];
  const timers: TraktTimers = {
    setTimeout(callback, ms) {
      waits.push(ms);
      void Promise.resolve().then(callback);
      return waits.length;
    },
    clearTimeout: () => undefined,
  };
  const sync = createTraktSync({
    account,
    storage,
    targets: {
      progress,
      library: options.library ? options.library(library) : library,
      watched: options.watched ? options.watched(watched) : watched,
    },
    now,
    timers,
  });
  const calls = () => server.calls.map((call) => `${call.method} ${call.path}`);
  const forget = () => {
    server.calls.length = 0;
  };
  return { sync, server, state, storage, clock, progress, library, watched, waits, calls, forget };
}

const EVERYTHING = [
  'GET /sync/last_activities',
  'GET /sync/playback?extended=full',
  'GET /sync/watched/movies',
  'GET /sync/watched/shows?extended=full',
  'GET /sync/watchlist/movies',
  'GET /sync/watchlist/shows',
];

describe('createTraktSync', () => {
  it('is skipped while signed out', async () => {
    const { sync, state, calls } = setup();
    state.set({ status: 'signedOut' });
    expect(await sync.run()).toBe('skipped');
    await sync.pushLibrary();
    expect(calls()).toEqual([]);
  });

  it('brings everything in on the first run', async () => {
    const { sync, calls, progress, watched, library, storage } = setup();
    expect(await sync.run()).toBe('done');
    expect(calls()).toEqual(EVERYTHING);

    const film = progress.get('tt0372784')!;
    expect(film).toMatchObject({
      metaId: 'tt0372784',
      type: 'movie',
      videoId: 'tt0372784',
      duration: 140 * 60,
      updatedAt: Date.parse('2026-10-27T20:15:04.000Z'),
      watched: false,
    });
    expect(film.position).toBeCloseTo(0.105 * 140 * 60);
    const episode = progress.get('tt0903747:1:3')!;
    expect(episode).toMatchObject({
      metaId: 'tt0903747',
      type: 'series',
      duration: 48 * 60,
      updatedAt: Date.parse('2026-10-27T19:00:00.000Z'),
      watched: false,
    });
    expect(episode.position).toBeCloseTo(0.655 * 48 * 60);
    expect(progress.get('tt0000002')).toBeUndefined();

    for (const id of [
      'tt0468569',
      'tmdb:1234567',
      'tt0903747:1:1',
      'tt0903747:1:2',
      'tt0306414:1:2',
      'tt11280740:0:1',
      'tt11280740:1:9',
      'tt0000008:1:1',
    ]) {
      expect(watched.has(id)).toBe(true);
    }
    expect(watched.has('tt0372784')).toBe(false);

    // The latest episode of each show watched in the last 30 days, as finished.
    expect(progress.get('tt0903747:1:2')).toEqual({
      metaId: 'tt0903747',
      type: 'series',
      videoId: 'tt0903747:1:2',
      position: 45 * 60,
      duration: 45 * 60,
      updatedAt: Date.parse('2026-10-26T22:10:00.000Z'),
      watched: true,
    });
    expect(progress.get('tt11280740:1:9')).toMatchObject({ watched: true, duration: 55 * 60 });
    expect(progress.get('tt0903747:1:1')).toBeUndefined();
    expect(progress.get('tt11280740:1:2')).toBeUndefined();
    expect(progress.get('tt0306414:1:2')).toBeUndefined();
    expect(progress.get('tt0000008:1:1')).toBeUndefined();

    expect(library.items()).toEqual([
      {
        id: 'tt1104001',
        type: 'movie',
        name: 'TRON: Legacy',
        releaseInfo: '2010',
        addedAt: Date.parse('2026-10-25T10:00:00.000Z'),
      },
      {
        id: 'tt14452776',
        type: 'series',
        name: 'The Bear',
        releaseInfo: '2022',
        addedAt: Date.parse('2026-10-24T09:00:00.000Z'),
      },
    ]);
    expect(await storage.get('traktSync')).toEqual({
      times: {
        'movies.paused_at': '2026-10-27T20:15:04.000Z',
        'episodes.paused_at': '2026-10-27T19:00:00.000Z',
        'movies.watched_at': '2026-10-20T21:00:00.000Z',
        'episodes.watched_at': '2026-10-26T22:10:00.000Z',
        'movies.watchlisted_at': '2026-10-25T10:00:00.000Z',
        'shows.watchlisted_at': '2026-10-24T09:00:00.000Z',
        'watchlist.updated_at': '2026-10-25T10:00:00.000Z',
      },
    });
  });

  it('fetches only what changed since the last run', async () => {
    const { sync, server, calls, forget } = setup();
    await sync.run();
    forget();
    expect(await sync.run()).toBe('done');
    expect(calls()).toEqual(['GET /sync/last_activities']);

    for (const field of ['movies.paused_at', 'episodes.paused_at']) {
      forget();
      touch(server.activities, field);
      await sync.run();
      expect(calls()).toEqual(['GET /sync/last_activities', 'GET /sync/playback?extended=full']);
    }

    for (const field of ['movies.watched_at', 'episodes.watched_at']) {
      forget();
      touch(server.activities, field);
      await sync.run();
      expect(calls()).toEqual([
        'GET /sync/last_activities',
        'GET /sync/watched/movies',
        'GET /sync/watched/shows?extended=full',
      ]);
    }

    for (const field of ['movies.watchlisted_at', 'shows.watchlisted_at', 'watchlist.updated_at']) {
      forget();
      touch(server.activities, field);
      await sync.run();
      expect(calls()).toEqual([
        'GET /sync/last_activities',
        'GET /sync/watchlist/movies',
        'GET /sync/watchlist/shows',
      ]);
    }
  });

  it('does not ask again because Trakt leaves out the watchlist section', async () => {
    const { sync, server, calls, forget } = setup();
    delete server.activities.watchlist;
    await sync.run();
    forget();
    await sync.run();
    expect(calls()).toEqual(['GET /sync/last_activities']);
  });

  it('keeps progress made on the TV since the pause on Trakt', async () => {
    const { sync, progress, clock } = setup();
    clock.now = Date.parse('2026-10-28T08:00:00.000Z');
    progress.record({
      metaId: 'tt0372784',
      type: 'movie',
      videoId: 'tt0372784',
      position: 4000,
      duration: 8400,
    });
    await sync.run();
    expect(progress.get('tt0372784')).toMatchObject({ position: 4000, updatedAt: clock.now });
  });

  it('fetches a part that failed again next run, and keeps the rest', async () => {
    const { sync, server, calls, forget, watched, storage } = setup();
    server.overrides.set('GET /sync/playback?extended=full', () => ok({ error: 'server' }, 500));
    expect(await sync.run()).toBe('failed');
    expect(calls()).toEqual(EVERYTHING);
    expect(watched.has('tt0468569')).toBe(true);
    const saved = (await storage.get('traktSync')) as { times: Record<string, string> };
    expect(Object.keys(saved.times)).not.toContain('movies.paused_at');
    expect(Object.keys(saved.times)).not.toContain('episodes.paused_at');

    server.overrides.clear();
    forget();
    expect(await sync.run()).toBe('done');
    expect(calls()).toEqual(['GET /sync/last_activities', 'GET /sync/playback?extended=full']);
  });

  it('fails without last_activities, and fetches nothing else', async () => {
    const { sync, server, calls, forget } = setup();
    server.overrides.set('GET /sync/last_activities', () =>
      Promise.reject(new TraktError('network', 'offline')),
    );
    expect(await sync.run()).toBe('failed');
    expect(calls()).toEqual(['GET /sync/last_activities']);

    forget();
    server.overrides.set('GET /sync/last_activities', () => ok(null));
    expect(await sync.run()).toBe('failed');
    server.overrides.set('GET /sync/last_activities', () => ok({ error: 'locked' }, 423));
    expect(await sync.run()).toBe('failed');
    expect(calls()).toEqual(['GET /sync/last_activities', 'GET /sync/last_activities']);
  });

  it('fails a part whose list it cannot read rather than emptying it', async () => {
    const { sync, server, library, watched } = setup();
    await sync.run();
    touch(server.activities, 'watchlist.updated_at');
    touch(server.activities, 'movies.watched_at');
    server.overrides.set('GET /sync/watchlist/movies', () => ok({ error: 'odd' }));
    server.overrides.set('GET /sync/watched/shows?extended=full', () => ok(null));
    expect(await sync.run()).toBe('failed');
    expect(library.has('tt1104001')).toBe(true);
    expect(watched.has('tt0903747:1:2')).toBe(true);
  });

  it('shares one run between two asked for at once', async () => {
    const { sync, calls } = setup();
    expect(await Promise.all([sync.run(), sync.run()])).toEqual(['done', 'done']);
    expect(calls().filter((call) => call === 'GET /sync/last_activities')).toHaveLength(1);
    await sync.run();
    expect(calls().filter((call) => call === 'GET /sync/last_activities')).toHaveLength(2);
  });

  it('never rejects, whatever fails', async () => {
    const { sync } = setup({
      library: (library) => ({
        ...library,
        mergeRemote: () => Promise.reject(new Error('disk full')),
      }),
    });
    expect(await sync.run()).toBe('failed');
  });

  it("sends the TV's changes before pulling the watchlist, and what the merge queued after", async () => {
    const { sync, library, calls, server } = setup();
    await library.add(preview('tt0137523', 'movie', 'Fight Club'));
    await library.forgetRemote();
    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));

    expect(await sync.run()).toBe('done');
    expect(calls().slice(4)).toEqual([
      'POST /sync/watchlist',
      'GET /sync/watchlist/movies',
      'GET /sync/watchlist/shows',
      'POST /sync/watchlist',
    ]);
    const posts = server.calls.filter((call) => call.method === 'POST').map((call) => call.body);
    expect(posts).toEqual([
      { movies: [{ ids: { imdb: 'tt0111161' } }], shows: [] },
      { movies: [{ ids: { imdb: 'tt0137523' } }], shows: [] },
    ]);
    expect(library.outbox()).toEqual([]);
    expect(
      library
        .items()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['tt0111161', 'tt0137523', 'tt1104001', 'tt14452776']);
  });

  it('takes a title removed on Trakt out of My List', async () => {
    const { sync, server, library } = setup();
    await sync.run();
    expect(library.has('tt1104001')).toBe(true);
    server.watchlist.movies = [];
    touch(server.activities, 'movies.watchlisted_at');
    await sync.run();
    expect(library.has('tt1104001')).toBe(false);
    expect(library.has('tt14452776')).toBe(true);
  });

  it('sends additions and removals to the watchlist', async () => {
    const { sync, server, library, forget } = setup();
    await sync.run();
    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));
    await library.add(preview('tmdb:1399', 'series', 'Game of Thrones'));
    await library.remove('tt1104001');
    await library.remove('tt14452776');
    forget();

    await sync.pushLibrary();

    expect(server.calls).toEqual([
      {
        method: 'POST',
        path: '/sync/watchlist',
        body: { movies: [{ ids: { imdb: 'tt0111161' } }], shows: [{ ids: { tmdb: 1399 } }] },
      },
      {
        method: 'POST',
        path: '/sync/watchlist/remove',
        body: {
          movies: [{ ids: { imdb: 'tt1104001' } }],
          shows: [{ ids: { imdb: 'tt14452776' } }],
        },
      },
    ]);
    expect(library.outbox()).toEqual([]);
    forget();
    await sync.pushLibrary();
    expect(server.calls).toEqual([]);
  });

  it('keeps a title Trakt cannot take in My List, and sends nothing for it', async () => {
    const { sync, server, library } = setup();
    await library.add(preview('kitsu:1376', 'series', 'Death Note'));
    await library.add(preview('tt0111161', 'channel', 'A channel'));
    await sync.run();
    touch(server.activities, 'watchlist.updated_at');
    await sync.run();
    await sync.run();
    expect(library.has('kitsu:1376')).toBe(true);
    expect(library.has('tt0111161')).toBe(true);
    expect(server.calls.filter((call) => call.method === 'POST')).toEqual([]);

    await library.remove('kitsu:1376');
    await sync.pushLibrary();
    expect(library.outbox().map((change) => change.id)).toEqual(['tt0111161']);
    expect(server.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('keeps a title Trakt does not know yet queued, and tries it again', async () => {
    const { sync, server, library, forget } = setup();
    server.unknown.add('tt9999999');
    await library.add(preview('tt9999999', 'movie', 'Not on Trakt yet'));
    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));
    await sync.pushLibrary();
    expect(library.outbox().map((change) => change.id)).toEqual(['tt9999999']);

    forget();
    server.unknown.clear();
    await sync.pushLibrary();
    expect(server.calls.map((call) => call.body)).toEqual([
      { movies: [{ ids: { imdb: 'tt9999999' } }], shows: [] },
    ]);
    expect(library.outbox()).toEqual([]);
  });

  it('keeps changes queued when Trakt cannot take them now', async () => {
    const { sync, server, library } = setup();
    await sync.run();
    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));
    await library.remove('tt1104001');
    server.overrides.set('POST /sync/watchlist', () =>
      Promise.reject(new TraktError('network', 'offline')),
    );
    server.overrides.set('POST /sync/watchlist/remove', () => ok({ error: 'server' }, 502));

    expect(await sync.run()).toBe('failed');
    expect(library.outbox().map((change) => `${change.op} ${change.id}`)).toEqual([
      'add tt0111161',
      'remove tt1104001',
    ]);

    server.overrides.clear();
    expect(await sync.run()).toBe('done');
    expect(library.outbox()).toEqual([]);
  });

  it('waits as Trakt asks when it takes one change a second', async () => {
    const { sync, server, library, waits } = setup();
    let first = true;
    server.overrides.set('POST /sync/watchlist', () => {
      if (!first) return ok({ added: { movies: 1, shows: 0 }, not_found: {} }, 201);
      first = false;
      return { status: 429, data: null, retryAfter: 1 };
    });
    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));
    await sync.pushLibrary();
    expect(waits).toEqual([1000]);
    expect(library.outbox()).toEqual([]);

    server.overrides.set('POST /sync/watchlist', () => ({
      status: 429,
      data: null,
      retryAfter: 300,
    }));
    await library.add(preview('tt0137523', 'movie', 'Fight Club'));
    await sync.pushLibrary();
    expect(waits).toEqual([1000]);
    expect(library.outbox().map((change) => change.id)).toEqual(['tt0137523']);
  });

  it('runs one push at a time, and another after it for what came since', async () => {
    const { sync, server, library } = setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.overrides.set('POST /sync/watchlist', () =>
      held.then(() => ok({ added: { movies: 1, shows: 0 }, not_found: {} }, 201)),
    );
    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));
    const first = sync.pushLibrary();
    await flush();
    await library.add(preview('tt0137523', 'movie', 'Fight Club'));
    const second = sync.pushLibrary();
    const third = sync.pushLibrary();
    await flush();
    expect(server.calls).toHaveLength(1);
    release();
    await Promise.all([first, second, third]);
    expect(server.calls.map((call) => call.body)).toEqual([
      { movies: [{ ids: { imdb: 'tt0111161' } }], shows: [] },
      { movies: [{ ids: { imdb: 'tt0137523' } }], shows: [] },
    ]);
    expect(library.outbox()).toEqual([]);
  });

  it('keeps a title saved by its TMDB id when Trakt lists it by its IMDb id as well', async () => {
    const { sync, server, library, calls, forget } = setup();
    await library.add(preview('tmdb:603', 'movie', 'The Matrix'));
    expect(await sync.run()).toBe('done');
    // Sent by the id the TV saved, then listed by both.
    expect(server.calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { movies: [{ ids: { tmdb: 603 } }], shows: [] },
    ]);
    expect(server.watchlist.movies.map((item) => (item as { movie: unknown }).movie)).toContain(
      THE_MATRIX,
    );
    expect(library.has('tmdb:603')).toBe(true);
    expect(library.has('tt0133093')).toBe(false);
    expect(library.outbox()).toEqual([]);

    touch(server.activities, 'watchlist.updated_at', '2026-10-28T11:00:00Z');
    forget();
    expect(await sync.run()).toBe('done');
    expect(calls()).toContain('GET /sync/watchlist/movies');
    expect(library.has('tmdb:603')).toBe(true);
    expect(library.has('tt0133093')).toBe(false);
    expect(server.calls.filter((call) => call.method === 'POST')).toEqual([]);

    // Taken off here: Trakt is told by the same id, and takes it off.
    await library.remove('tmdb:603');
    forget();
    await sync.pushLibrary();
    expect(server.calls).toEqual([
      {
        method: 'POST',
        path: '/sync/watchlist/remove',
        body: { movies: [{ ids: { tmdb: 603 } }], shows: [] },
      },
    ]);
    expect(server.watchlist.movies.map((item) => (item as { movie: unknown }).movie)).not.toContain(
      THE_MATRIX,
    );
  });

  it('brings progress and watched ticks in under the TMDB ids the TV plays by', async () => {
    const { sync, server, progress, watched, clock } = setup();
    clock.now = Date.parse('2026-10-27T10:00:00.000Z');
    progress.record({
      metaId: 'tmdb:603',
      type: 'movie',
      videoId: 'tmdb:603',
      position: 600,
      duration: 8100,
    });
    progress.record({
      metaId: 'tmdb:1396',
      type: 'series',
      videoId: 'tmdb:1396:1:1',
      position: 2700,
      duration: 2820,
    });
    clock.now = NOW;
    const pausedAt = '2026-10-27T21:00:00.000Z';
    server.playback.push({
      progress: 50,
      paused_at: pausedAt,
      id: 40,
      type: 'movie',
      movie: { ...THE_MATRIX, runtime: 136 },
    });

    expect(await sync.run()).toBe('done');

    // Watched to half way elsewhere since: on the TV's own id and length.
    expect(progress.get('tmdb:603')).toMatchObject({
      metaId: 'tmdb:603',
      position: 4050,
      duration: 8100,
      updatedAt: Date.parse(pausedAt),
    });
    expect(progress.get('tt0133093')).toBeUndefined();
    // Another episode of a show the TV has progress in, under the show's id there.
    expect(progress.get('tmdb:1396:1:3')).toMatchObject({ metaId: 'tmdb:1396', duration: 48 * 60 });
    expect(progress.get('tt0903747:1:3')).toBeUndefined();
    // The show's latest episode watched, as finished, goes there too.
    expect(progress.get('tmdb:1396:1:2')).toMatchObject({ metaId: 'tmdb:1396', watched: true });
    expect(progress.get('tt0903747:1:2')).toBeUndefined();
    // A title the TV has never played comes in by its IMDb id.
    expect(progress.get('tt0372784')).toMatchObject({ metaId: 'tt0372784' });

    // Ticks are under every id, whichever the TV knows a title by.
    for (const id of [
      'tt0468569',
      'tmdb:155',
      'tmdb:1234567',
      'tt0903747:1:1',
      'tmdb:1396:1:1',
      'tt0903747:1:2',
      'tmdb:1396:1:2',
      'tt11280740:1:9',
      'tmdb:95396:1:9',
    ]) {
      expect(watched.has(id)).toBe(true);
    }
    expect(watched.has('tmdb:272')).toBe(false);
  });

  it("does not move the resume point when the TV's own stop comes back from Trakt", async () => {
    const { sync, server, progress, clock } = setup();
    const stoppedAt = Date.parse('2026-10-27T20:15:03.000Z');
    clock.now = stoppedAt;
    progress.record({
      metaId: 'tt0372784',
      type: 'movie',
      videoId: 'tt0372784',
      position: 1800,
      duration: 2520,
    });
    clock.now = NOW;
    // What the stop scrobble left: 71.43%, a second later, which on Trakt's 140 minutes is 6000 s.
    server.playback[0] = { ...(server.playback[0] as object), progress: 71.43 };

    expect(await sync.run()).toBe('done');
    expect(progress.get('tt0372784')).toMatchObject({
      position: 1800,
      duration: 2520,
      updatedAt: stoppedAt,
    });
    expect(progress.resumeAt('tt0372784')).toBe(1800);
  });

  it('keeps one resume point for an episode played by its TMDB id when its show has progress by both', async () => {
    const { sync, server, progress, clock } = setup();
    // The first sync puts Breaking Bad's progress under its IMDb id.
    await sync.run();
    expect(progress.forMeta('tt0903747')).not.toEqual([]);
    // Then the TV plays 1x1 from a TMDB catalogue, and stops there.
    const stoppedAt = NOW + 60_000;
    clock.now = stoppedAt;
    progress.record({
      metaId: 'tmdb:1396',
      type: 'series',
      videoId: 'tmdb:1396:1:1',
      position: 1080,
      duration: 2700,
    });
    clock.now = NOW + 120_000;
    // Trakt sends that stop back: 40% of its 58 minutes.
    server.playback.push({
      progress: 40,
      paused_at: new Date(stoppedAt + 1000).toISOString(),
      id: 41,
      type: 'episode',
      episode: {
        season: 1,
        number: 1,
        title: 'Pilot',
        ids: { trakt: 73, tvdb: 349232, imdb: 'tt0959621', tmdb: 62085 },
        runtime: 58,
      },
      show: { title: 'Breaking Bad', year: 2008, ids: BREAKING_BAD, runtime: 45 },
    });
    touch(server.activities, 'episodes.paused_at');

    expect(await sync.run()).toBe('done');
    expect(progress.get('tt0903747:1:1')).toBeUndefined();
    expect(progress.get('tmdb:1396:1:1')).toMatchObject({
      position: 1080,
      duration: 2700,
      updatedAt: stoppedAt,
    });
    expect(progress.resumeAt('tmdb:1396:1:1')).toBe(1080);
    // The episode paused on Trakt before stays under the id the first sync gave it.
    expect(progress.get('tt0903747:1:3')).toMatchObject({ metaId: 'tt0903747' });
    expect(progress.get('tmdb:1396:1:3')).toBeUndefined();
  });

  it('brings a paused film in by its IMDb id when only a show has progress under its TMDB number', async () => {
    const { sync, server, progress, clock } = setup();
    clock.now = Date.parse('2026-10-27T10:00:00.000Z');
    // TMDB counts films and shows separately, so a show can be 603 too.
    progress.record({
      metaId: 'tmdb:603',
      type: 'series',
      videoId: 'tmdb:603:1:1',
      position: 600,
      duration: 2700,
    });
    clock.now = NOW;
    server.playback.push({
      progress: 50,
      paused_at: '2026-10-27T21:00:00.000Z',
      id: 40,
      type: 'movie',
      movie: { ...THE_MATRIX, runtime: 136 },
    });

    expect(await sync.run()).toBe('done');
    expect(progress.get('tt0133093')).toMatchObject({
      metaId: 'tt0133093',
      type: 'movie',
      duration: 136 * 60,
    });
    expect(progress.get('tmdb:603')).toBeUndefined();
    expect(progress.get('tmdb:603:1:1')).toMatchObject({ position: 600, duration: 2700 });
  });

  it("lists every title's own id among the watched ticks before its other ids", async () => {
    const replaced: (readonly string[])[] = [];
    const { sync, progress, clock } = setup({
      watched: (watched) => ({
        ...watched,
        replace(videoIds) {
          replaced.push(videoIds);
          return watched.replace(videoIds);
        },
      }),
    });
    clock.now = Date.parse('2026-10-27T10:00:00.000Z');
    progress.record({
      metaId: 'tmdb:1396',
      type: 'series',
      videoId: 'tmdb:1396:1:1',
      position: 2700,
      duration: 2820,
    });
    clock.now = NOW;

    await sync.run();
    // The set keeps so many from the start, so a long history loses only ids the TV does not use.
    expect(replaced).toEqual([
      [
        'tt0468569',
        'tmdb:1234567',
        'tmdb:1396:1:1',
        'tmdb:1396:1:2',
        'tt0306414:1:1',
        'tt0306414:1:2',
        'tt11280740:0:1',
        'tt11280740:1:1',
        'tt11280740:1:9',
        'tt11280740:1:2',
        'tt0000008:1:1',
        'tmdb:155',
        'tt0903747:1:1',
        'tt0903747:1:2',
        'tmdb:1438:1:1',
        'tmdb:1438:1:2',
        'tmdb:95396:0:1',
        'tmdb:95396:1:1',
        'tmdb:95396:1:9',
        'tmdb:95396:1:2',
      ],
    ]);
  });

  it('sends no removal for a title saved and taken off before signing in', async () => {
    const { sync, server, state, library, forget } = setup();
    state.set({ status: 'signedOut' });
    await flush();
    await library.add(preview('tt1104001', 'movie', 'TRON: Legacy'));
    await library.remove('tt1104001');
    await sync.pushLibrary();
    expect(library.outbox()).toEqual([]);

    // The account signed in to has it on its watchlist, put there elsewhere.
    state.set({ status: 'signedIn' });
    forget();
    expect(await sync.run()).toBe('done');
    expect(server.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(library.has('tt1104001')).toBe(true);
  });

  it('holds a push asked for during a watchlist pull until the pull is in', async () => {
    const { sync, server, library, calls } = setup();
    await sync.run();
    let asked!: () => void;
    const askedFor = new Promise<void>((resolve) => (asked = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.overrides.set('GET /sync/watchlist/movies', () => {
      // The list as it was when asked for, answered later.
      const movies = server.watchlist.movies.slice();
      asked();
      return held.then(() => ok(movies));
    });
    touch(server.activities, 'watchlist.updated_at');
    const run = sync.run();
    await askedFor;

    await library.add(preview('tt0111161', 'movie', 'The Shawshank Redemption'));
    const pushed = sync.pushLibrary();
    await flush();
    expect(calls().slice(-1)).toEqual(['GET /sync/watchlist/movies']);

    release();
    await Promise.all([run, pushed]);
    expect(await run).toBe('done');
    expect(calls().slice(-3)).toEqual([
      'GET /sync/watchlist/movies',
      'GET /sync/watchlist/shows',
      'POST /sync/watchlist',
    ]);
    expect(library.has('tt0111161')).toBe(true);
    expect(library.outbox()).toEqual([]);

    // The next pull finds it on Trakt's list, and keeps it.
    server.overrides.clear();
    touch(server.activities, 'watchlist.updated_at', '2026-10-28T11:00:00Z');
    await sync.run();
    expect(library.has('tt0111161')).toBe(true);
  });

  it('forgets the sync when the profile signs out', async () => {
    const { sync, server, state, storage, watched, library, calls, forget } = setup();
    await sync.run();
    state.set({ status: 'signedOut', expired: true });
    await flush();
    expect(await storage.get('traktSync')).toBeNull();
    expect(watched.has('tt0468569')).toBe(false);
    expect(library.has('tt1104001')).toBe(true);

    // Signed in again to an account with an empty watchlist: nothing here counts as removed there.
    server.watchlist.movies = [];
    server.watchlist.shows = [];
    state.set({ status: 'signedIn' });
    forget();
    expect(await sync.run()).toBe('done');
    expect(calls()).toContain('GET /sync/playback?extended=full');
    expect(library.has('tt1104001')).toBe(true);
    expect(library.has('tt14452776')).toBe(true);
    expect(server.calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { movies: [{ ids: { imdb: 'tt1104001' } }], shows: [{ ids: { imdb: 'tt14452776' } }] },
    ]);
  });

  it('writes nothing for a run that outlives its sign-in', async () => {
    const { sync, server, state, storage, watched } = setup();
    server.overrides.set('GET /sync/watched/shows?extended=full', () => {
      state.set({ status: 'signedOut' });
      return ok(server.watchedShows);
    });
    expect(await sync.run()).toBe('skipped');
    await flush();
    expect(watched.has('tt0468569')).toBe(false);
    expect(await storage.get('traktSync')).toBeUndefined();
  });
});
