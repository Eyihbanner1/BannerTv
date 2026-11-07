import { describe, expect, it } from 'vitest';
import type { TraktAccountState } from './account';
import { createTraktMarks, historyBody, pausedIds } from './marks';
import type { TraktMethod, TraktResponse, TraktTimers } from './transport';

function fakeAccount(
  answers: TraktResponse[] = [],
  status: TraktAccountState['status'] = 'signedIn',
) {
  const calls: { method: TraktMethod; path: string; body: unknown }[] = [];
  const state = { status } as TraktAccountState;
  const account = {
    load: () => Promise.resolve(),
    get: () => state,
    call(method: TraktMethod, path: string, body?: unknown) {
      calls.push({ method, path, body });
      return Promise.resolve(answers.shift() ?? { status: 200, data: null });
    },
  };
  return { account, calls };
}

/** Timers that fire at once, so a Retry-After wait takes no time. */
const instant: TraktTimers = {
  setTimeout: (callback) => {
    callback();
    return 0;
  },
  clearTimeout: () => undefined,
};

describe('historyBody', () => {
  it('puts films by their ids and episodes under their show by season', () => {
    expect(
      historyBody([
        { metaId: 'tt0372784', type: 'movie' },
        { metaId: 'tt0372784', type: 'movie' },
        { metaId: 'tt0903747', type: 'series', season: 1, episode: 2 },
        { metaId: 'tt0903747', type: 'series', season: 1, episode: 3 },
        { metaId: 'tt0903747', type: 'series', season: 2, episode: 1 },
        { metaId: 'tt0903747', type: 'series', season: 1, episode: 3 },
        { metaId: 'tmdb:1399', type: 'series', season: 1, episode: 1 },
      ]),
    ).toEqual({
      movies: [{ ids: { imdb: 'tt0372784' } }],
      shows: [
        {
          ids: { imdb: 'tt0903747' },
          seasons: [
            { number: 1, episodes: [{ number: 2 }, { number: 3 }] },
            { number: 2, episodes: [{ number: 1 }] },
          ],
        },
        { ids: { tmdb: 1399 }, seasons: [{ number: 1, episodes: [{ number: 1 }] }] },
      ],
    });
  });

  it('sends the time each was marked, so what Trakt gives back is no newer', () => {
    expect(
      historyBody([
        { metaId: 'tt0372784', type: 'movie', watchedAt: Date.UTC(2026, 10, 6, 21, 0, 0, 5) },
        { metaId: 'tt0903747', type: 'series', season: 1, episode: 2, watchedAt: 0 },
      ]),
    ).toEqual({
      movies: [{ ids: { imdb: 'tt0372784' }, watched_at: '2026-11-06T21:00:00.005Z' }],
      shows: [
        {
          ids: { imdb: 'tt0903747' },
          seasons: [
            { number: 1, episodes: [{ number: 2, watched_at: '1970-01-01T00:00:00.000Z' }] },
          ],
        },
      ],
    });
  });

  it('leaves out what Trakt cannot identify, and is undefined when nothing is left', () => {
    expect(
      historyBody([
        { metaId: 'yt:abc', type: 'movie' },
        { metaId: 'tt0903747', type: 'series' },
        { metaId: 'tt0903747', type: 'channel', season: 1, episode: 1 },
      ]),
    ).toBeUndefined();
  });
});

describe('pausedIds', () => {
  const items = [
    { id: 1, type: 'movie', movie: { ids: { imdb: 'tt0372784', tmdb: 272 } } },
    { id: 2, type: 'episode', show: { ids: { imdb: 'tt0903747', tmdb: 1396 } } },
    { id: 3, type: 'episode', show: { ids: { imdb: 'tt0903747' } } },
    { id: 4, type: 'episode', show: { ids: { imdb: 'tt9999999' } } },
    { type: 'movie', movie: { ids: { imdb: 'tt0372784' } } },
  ];

  it('finds a film and every paused episode of a series, by any id Trakt gives', () => {
    expect(pausedIds(items, 'tt0372784', 'movie')).toEqual([1]);
    expect(pausedIds(items, 'tt0903747', 'series')).toEqual([2, 3]);
    expect(pausedIds(items, 'tmdb:1396', 'series')).toEqual([2]);
    expect(pausedIds(items, 'tt0903747', 'movie')).toEqual([]);
  });
});

describe('createTraktMarks', () => {
  it('adds marks to the history as watched, or takes them out', async () => {
    const fake = fakeAccount([
      { status: 201, data: {} },
      { status: 200, data: {} },
    ]);
    const marks = createTraktMarks({ account: fake.account, timers: instant });
    expect(await marks.history([{ metaId: 'tt0372784', type: 'movie' }], true)).toBe(true);
    expect(await marks.history([{ metaId: 'tt0372784', type: 'movie' }], false)).toBe(true);
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /sync/history',
      'POST /sync/history/remove',
    ]);
    expect(fake.calls[0]!.body).toEqual({ movies: [{ ids: { imdb: 'tt0372784' } }], shows: [] });
  });

  it('asks once more after a short Retry-After, and gives up on a refusal', async () => {
    const fake = fakeAccount([
      { status: 429, data: null, retryAfter: 1 },
      { status: 201, data: {} },
      { status: 403, data: null },
    ]);
    const marks = createTraktMarks({ account: fake.account, timers: instant });
    expect(await marks.history([{ metaId: 'tt0372784', type: 'movie' }], true)).toBe(true);
    expect(await marks.history([{ metaId: 'tt0372784', type: 'movie' }], true)).toBe(false);
    expect(fake.calls).toHaveLength(3);
  });

  it('sends nothing when signed out or for a title Trakt cannot identify', async () => {
    const out = fakeAccount([], 'signedOut');
    const marks = createTraktMarks({ account: out.account, timers: instant });
    expect(await marks.history([{ metaId: 'tt0372784', type: 'movie' }], true)).toBe(false);
    expect(await marks.forgetPaused('tt0372784', 'movie')).toBe(false);
    const signedIn = fakeAccount();
    const other = createTraktMarks({ account: signedIn.account, timers: instant });
    expect(await other.history([{ metaId: 'yt:abc', type: 'movie' }], true)).toBe(false);
    expect(await other.forgetPaused('yt:abc', 'movie')).toBe(false);
    expect([...out.calls, ...signedIn.calls]).toEqual([]);
  });

  it('takes every paused episode of a series off the paused list', async () => {
    const fake = fakeAccount([
      {
        status: 200,
        data: [
          { id: 7, type: 'episode', show: { ids: { imdb: 'tt0903747' } } },
          { id: 8, type: 'episode', show: { ids: { imdb: 'tt0903747' } } },
        ],
      },
      { status: 204, data: null },
      { status: 404, data: null },
    ]);
    const marks = createTraktMarks({ account: fake.account, timers: instant });
    // One of them could not be taken off.
    expect(await marks.forgetPaused('tt0903747', 'series')).toBe(false);
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /sync/playback/episodes',
      'DELETE /sync/playback/7',
      'DELETE /sync/playback/8',
    ]);
  });

  it('never rejects when the call fails', async () => {
    const account = {
      load: () => Promise.resolve(),
      get: () => ({ status: 'signedIn' }) as TraktAccountState,
      call: () => Promise.reject(new Error('offline')),
    };
    const marks = createTraktMarks({ account, timers: instant });
    expect(await marks.history([{ metaId: 'tt0372784', type: 'movie' }], true)).toBe(false);
    expect(await marks.forgetPaused('tt0372784', 'movie')).toBe(false);
  });
});
