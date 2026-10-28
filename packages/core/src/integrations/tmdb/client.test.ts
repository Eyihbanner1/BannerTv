import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../http';
import { createLimiter, type Limiter } from '../../limiter';
import { createQueryCache } from '../../query';
import { type CacheRecord, type CacheStore, memoryCacheStore } from '../../storage';
import { createTmdbClient, TMDB_POLICY, tmdbImageUrl } from './client';
import { readDetails, readSeason } from './details';
import findMovie from './fixtures/find-movie.json';
import findTv from './fixtures/find-tv.json';
import movie from './fixtures/movie.json';
import season from './fixtures/season.json';
import tv from './fixtures/tv.json';

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const BASE = 'https://api.bannertv.workers.dev/tmdb';
const FIND_FILM = `${BASE}/find/tt0468569?external_source=imdb_id`;
const FILM = `${BASE}/movie/155?append_to_response=images,credits,release_dates&include_image_language=en,null&language=en-GB`;
const FIND_SERIES = `${BASE}/find/tt7678620?external_source=imdb_id`;
const SERIES = `${BASE}/tv/82728?append_to_response=images,aggregate_credits,content_ratings&include_image_language=en,null&language=en-GB`;
const SEASON = `${BASE}/tv/82728/season/1?language=en-GB`;
const FILM_KEY = 'tmdb:1:details:movie:tt0468569';

const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT = { timeoutMs: 10000 };

const answer = (body: unknown) => () => Promise.resolve(body);
const failWith = (status: number) => () =>
  Promise.reject(new HttpError('status', `The addon answered ${status}`, status));

/** A cache store that keeps a list of what was written to it. */
function recordingStore() {
  const inner = memoryCacheStore();
  const writes: Array<{ key: string; record: CacheRecord }> = [];
  const store: CacheStore = {
    read: inner.read,
    write(key, record) {
      writes.push({ key, record });
      return inner.write(key, record);
    },
  };
  return { store, writes };
}

function setup(
  answers: Record<string, () => Promise<unknown>>,
  options: { store?: CacheStore; now?: () => number; limiter?: Limiter } = {},
) {
  const fetchJson = vi.fn((url: string) => {
    const reply = answers[url];
    return reply ? reply() : Promise.reject(new Error('Unexpected request'));
  });
  const client = createTmdbClient({
    // A trailing slash is dropped, so the paths below have no double slash.
    baseUrl: `${BASE}/`,
    fetchJson,
    queries: createQueryCache({ store: options.store, now: options.now }),
    limiter: options.limiter,
  });
  return { client, fetchJson };
}

describe('createTmdbClient', () => {
  it("looks a film up by its IMDb id, then asks for the film's details", async () => {
    const { client, fetchJson } = setup({ [FIND_FILM]: answer(findMovie), [FILM]: answer(movie) });
    const query = client.details('movie', 'tt0468569');
    expect(client.details('movie', 'tt0468569')).toBe(query);
    query.load();
    await flush();
    expect(fetchJson.mock.calls).toEqual([
      [FIND_FILM, TIMEOUT],
      [FILM, TIMEOUT],
    ]);
    expect(query.get()).toEqual({
      status: 'success',
      data: readDetails('movie', 155, movie),
      stale: false,
    });
  });

  it("looks a series up among TMDB's series", async () => {
    const { client, fetchJson } = setup({ [FIND_SERIES]: answer(findTv), [SERIES]: answer(tv) });
    const query = client.details('series', 'tt7678620');
    query.load();
    await flush();
    expect(fetchJson.mock.calls).toEqual([
      [FIND_SERIES, TIMEOUT],
      [SERIES, TIMEOUT],
    ]);
    expect(query.get().data).toEqual(readDetails('tv', 82728, tv));
    expect(query.get().data).toMatchObject({ kind: 'tv', certificate: 'U', network: 'ABC Kids' });
  });

  it('answers null without a request for anything but a film or series with an IMDb id', async () => {
    const { client, fetchJson } = setup({});
    const asked: Array<[string, string]> = [
      ['movie', 'kitsu:1'],
      ['series', 'tt7678620:1:1'],
      ['channel', 'tt0468569'],
      ['tv', 'tt0468569'],
      ['movie', ' tt0468569'],
      ['movie', 'tt'],
    ];
    for (const [type, id] of asked) {
      const query = client.details(type, id);
      query.subscribe(() => undefined)();
      query.load();
      query.retry();
      expect(query.get()).toEqual({ status: 'success', data: null, stale: false });
    }
    await flush();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('keeps "TMDB does not know it" like any answer, for a week before asking again', async () => {
    let time = 0;
    const { store, writes } = recordingStore();
    const first = setup(
      { [FIND_FILM]: answer({ movie_results: [], tv_results: [] }) },
      { store, now: () => time },
    );
    const query = first.client.details('movie', 'tt0468569');
    query.load();
    await flush();
    expect(query.get()).toEqual({ status: 'success', data: null, stale: false });
    // The key names the title only: the service adds TMDB's key, and no address is kept.
    expect(writes).toEqual([
      { key: FILM_KEY, record: { value: null, storedAt: 0, ...TMDB_POLICY } },
    ]);
    expect(TMDB_POLICY).toEqual({ freshFor: 7 * DAY, revalidateFor: 7 * DAY, errorFor: 30 * DAY });

    // The next launch, six days on.
    time = 6 * DAY;
    const second = setup({}, { store, now: () => time });
    const again = second.client.details('movie', 'tt0468569');
    again.load();
    await flush();
    expect(again.get()).toEqual({ status: 'success', data: null, stale: false });
    expect(second.fetchJson).not.toHaveBeenCalled();
  });

  it('reads a 404 from TMDB at either step as a title it does not know, and keeps it', async () => {
    const cases: Array<Record<string, () => Promise<unknown>>> = [
      { [FIND_FILM]: failWith(404) },
      { [FIND_FILM]: answer(findMovie), [FILM]: failWith(404) },
    ];
    for (const answers of cases) {
      const { store, writes } = recordingStore();
      const { client } = setup(answers, { store });
      const query = client.details('movie', 'tt0468569');
      query.load();
      await flush();
      expect(query.get()).toEqual({ status: 'success', data: null, stale: false });
      expect(writes.map((write) => write.record.value)).toEqual([null]);
    }
  });

  it('reports any other failure as an error and keeps nothing', async () => {
    const failures = [
      failWith(503),
      failWith(500),
      () => Promise.reject(new HttpError('network', 'The addon could not be reached')),
      answer('<html>Bad gateway</html>'),
    ];
    for (const failure of failures) {
      const { store, writes } = recordingStore();
      const { client } = setup({ [FIND_FILM]: answer(findMovie), [FILM]: failure }, { store });
      const query = client.details('movie', 'tt0468569');
      query.load();
      await flush();
      expect(query.get()).toEqual({ status: 'error', error: expect.any(HttpError), stale: false });
      expect(writes).toEqual([]);
    }
  });

  it('serves an older answer when TMDB fails, for 30 days past its fortnight', async () => {
    let time = 20 * DAY;
    const store = memoryCacheStore();
    const older = readDetails('movie', 155, movie);
    await store.write(FILM_KEY, { value: older, storedAt: 0, ...TMDB_POLICY });
    const failing = { [FIND_FILM]: failWith(502) };

    const { client } = setup(failing, { store, now: () => time });
    const query = client.details('movie', 'tt0468569');
    query.load();
    await flush();
    expect(query.get()).toEqual({
      status: 'success',
      data: older,
      error: expect.any(HttpError),
      stale: true,
    });

    time = 45 * DAY;
    const later = setup(failing, { store, now: () => time }).client.details('movie', 'tt0468569');
    later.load();
    await flush();
    expect(later.get().status).toBe('error');
  });

  it("reads a season's episodes, and a season TMDB does not have as none", async () => {
    const missing = `${BASE}/tv/82728/season/9?language=en-GB`;
    const { store, writes } = recordingStore();
    const { client, fetchJson } = setup(
      { [SEASON]: answer(season), [missing]: failWith(404) },
      { store },
    );
    const first = client.season(82728, 1);
    const ninth = client.season(82728, 9);
    first.load();
    ninth.load();
    await flush();
    expect(fetchJson.mock.calls).toEqual([
      [SEASON, TIMEOUT],
      [missing, TIMEOUT],
    ]);
    expect(first.get()).toEqual({ status: 'success', data: readSeason(season), stale: false });
    expect(ninth.get()).toEqual({ status: 'success', data: {}, stale: false });
    expect(writes.map((write) => write.key)).toEqual([
      'tmdb:1:season:82728:1',
      'tmdb:1:season:82728:9',
    ]);
  });

  it('answers no episodes without a request for a season that cannot exist', async () => {
    const { client, fetchJson } = setup({});
    const asked: Array<[number, number]> = [
      [0, 1],
      [-3, 1],
      [1.5, 1],
      [Number.NaN, 1],
      [82728, -1],
      [82728, 1.5],
    ];
    for (const [id, number] of asked) {
      const query = client.season(id, number);
      query.load();
      expect(query.get()).toEqual({ status: 'success', data: {}, stale: false });
    }
    await flush();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('queues its requests on the limiter it is given', async () => {
    const limiter = createLimiter(1);
    const run = vi.spyOn(limiter, 'run');
    const { client } = setup(
      { [FIND_FILM]: answer(findMovie), [FILM]: answer(movie) },
      { limiter },
    );
    const query = client.details('movie', 'tt0468569');
    query.load();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(query.get().data).toMatchObject({ tmdbId: 155 });
  });
});

describe('tmdbImageUrl', () => {
  it('builds the address of an image at a size', () => {
    expect(tmdbImageUrl('/fPDlaSJtuubPOvfOHGu6JkPdUdC.png', 'w500')).toBe(
      'https://image.tmdb.org/t/p/w500/fPDlaSJtuubPOvfOHGu6JkPdUdC.png',
    );
    expect(tmdbImageUrl('/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg', 'original')).toBe(
      'https://image.tmdb.org/t/p/original/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg',
    );
  });

  it('gives nothing for a missing path or one that is not a TMDB path', () => {
    expect(tmdbImageUrl(undefined, 'w185')).toBeUndefined();
    expect(tmdbImageUrl('', 'w185')).toBeUndefined();
    expect(tmdbImageUrl('abc.jpg', 'w185')).toBeUndefined();
    expect(tmdbImageUrl('https://example.com/abc.jpg', 'w185')).toBeUndefined();
  });
});
