import { describe, expect, it, vi } from 'vitest';
import { createQueryCache } from '../query';
import { memoryCacheStore } from '../storage';
import {
  createSearchService,
  discoverQuery,
  readMultiAnswer,
  readRemoteAnswer,
  roleOf,
} from './service';

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const BASE = 'https://api.bannertv.workers.dev/search';

describe('readRemoteAnswer', () => {
  it('reads titles by IMDb id, with a sized poster and the strictest UK rating', () => {
    const answer = readRemoteAnswer(
      {
        titles: [
          {
            id: 'tt1109624',
            type: 'movie',
            name: 'Paddington',
            year: '2014',
            poster: '/paddington.jpg',
            genres: ['Family', 'Comedy', 3],
            certificates: { GB: ['PG', '12A'], US: ['PG'] },
          },
          {
            id: 'tt7678620',
            type: 'series',
            name: 'Bluey',
            genres: [],
            certificates: { US: ['TV-Y'] },
          },
          { id: 'tt1109624', type: 'movie', name: 'Paddington again', genres: [] },
          { id: '603', type: 'movie', name: 'TMDB id only', genres: [] },
          { id: 'tt1', type: 'episode', name: 'Not a title', genres: [] },
          { id: 'tt2', type: 'movie', name: '  ', genres: [] },
          { id: 'tt3', type: 'movie', name: 'Odd poster', poster: 'http://elsewhere/x.jpg' },
          'nonsense',
        ],
      },
      'w500',
    );
    expect(answer.titles).toEqual([
      {
        id: 'tt1109624',
        type: 'movie',
        name: 'Paddington',
        posterShape: 'poster',
        genres: ['Family', 'Comedy'],
        trailers: [],
        releaseInfo: '2014',
        poster: 'https://image.tmdb.org/t/p/w500/paddington.jpg',
        certificate: '12',
      },
      {
        id: 'tt7678620',
        type: 'series',
        name: 'Bluey',
        posterShape: 'poster',
        genres: [],
        trailers: [],
        certificate: 'U',
      },
      {
        id: 'tt3',
        type: 'movie',
        name: 'Odd poster',
        posterShape: 'poster',
        genres: [],
        trailers: [],
      },
    ]);
    expect(readRemoteAnswer(null)).toEqual({ titles: [] });
    expect(readRemoteAnswer({ titles: 'no' })).toEqual({ titles: [] });
  });

  it('reads which title the others are like', () => {
    expect(
      readRemoteAnswer({ like: { name: 'The Matrix', type: 'movie', year: '1999' }, titles: [] }),
    ).toEqual({ titles: [], like: { name: 'The Matrix', type: 'movie', year: '1999' } });
    expect(readRemoteAnswer({ like: { name: 'X', type: 'anime' }, titles: [] })).toEqual({
      titles: [],
    });
  });
});

describe('readMultiAnswer', () => {
  it('reads people and the names of titles, leaving out what it cannot read', () => {
    expect(
      readMultiAnswer({
        people: [
          {
            id: 31,
            name: 'Tom Hanks',
            department: 'Acting',
            photo: '/hanks.jpg',
            knownFor: ['Big'],
          },
          { id: 'x', name: 'No id' },
          { id: 2, name: '' },
          { id: 3, name: 'No extras' },
        ],
        titles: [{ name: 'Big', type: 'movie', year: '1988' }, { name: 'Odd', type: 'game' }, 7],
      }),
    ).toEqual({
      people: [
        { id: 31, name: 'Tom Hanks', department: 'Acting', photo: '/hanks.jpg', knownFor: ['Big'] },
        { id: 3, name: 'No extras', knownFor: [] },
      ],
      titles: [{ name: 'Big', type: 'movie', year: '1988' }],
    });
    expect(readMultiAnswer(undefined)).toEqual({ people: [], titles: [] });
  });
});

describe('discoverQuery', () => {
  it('writes a filter in one order, so the same row shares one answer', () => {
    expect(
      discoverQuery({
        certification: 'PG',
        newest: true,
        to: 1999,
        from: 1990,
        country: 'IN',
        language: 'hi',
        keywords: [9716, 356038],
        anyGenres: [10751, 10762],
        genres: [35],
        type: 'series',
      }),
    ).toBe(
      'type=series&genres=35&any=10751%2C10762&keywords=9716%2C356038&language=hi&country=IN&from=1990&to=1999&newest=1&certification=PG',
    );
    expect(discoverQuery({ type: 'movie', genres: [], keywords: [] })).toBe('type=movie');
  });
});

describe('createSearchService', () => {
  function setup(answers: Record<string, unknown>) {
    const fetchJson = vi.fn((url: string, options: { timeoutMs: number }) =>
      url in answers && options.timeoutMs > 0
        ? Promise.resolve(answers[url])
        : Promise.reject(new Error(`Unexpected ${url}`)),
    );
    const store = memoryCacheStore();
    const write = vi.spyOn(store, 'write');
    const service = createSearchService({
      baseUrl: `${BASE}/`,
      fetchJson,
      queries: createQueryCache({ store }),
      posterSize: 'w342',
    });
    return { service, fetchJson, write };
  }

  it('asks each route once, with the words folded, and keeps answers out of storage', async () => {
    const { service, fetchJson, write } = setup({
      [`${BASE}/multi?query=tom%20hanks`]: { people: [{ id: 31, name: 'Tom Hanks' }], titles: [] },
      [`${BASE}/person?id=31&role=cast`]: {
        titles: [{ id: 'tt0109830', type: 'movie', name: 'Forrest Gump' }],
      },
      [`${BASE}/person?id=31&role=cast&ratings=1`]: { titles: [] },
      [`${BASE}/like?query=the%20matrix&type=movie`]: {
        like: { name: 'The Matrix', type: 'movie' },
        titles: [],
      },
      [`${BASE}/titles?query=frozen&ratings=1`]: { titles: [] },
      [`${BASE}/discover?type=movie&keywords=9716`]: { titles: [] },
    });
    const multi = service.multi('  Tom   HANKS ');
    expect(service.multi('tom hanks')).toBe(multi);
    multi.load();
    const person = service.person(31, 'cast', false);
    person.load();
    service.person(31, 'cast', true).load();
    service.like('The Matrix', 'movie', false).load();
    service.titles('Frozen').load();
    service.discover({ type: 'movie', keywords: [9716] }).load();
    await flush();
    expect(fetchJson).toHaveBeenCalledTimes(6);
    expect(multi.get().data?.people[0]?.name).toBe('Tom Hanks');
    expect(person.get().data?.titles[0]?.name).toBe('Forrest Gump');
    expect(write).not.toHaveBeenCalled();
    expect(fetchJson.mock.calls[0]![1]).toEqual({ timeoutMs: 10000 });
  });

  it('asks again for an answer that was missing some titles, and not for a whole one', async () => {
    const title = { id: 'tt0109830', type: 'movie', name: 'Forrest Gump' };
    const { service, fetchJson } = setup({
      [`${BASE}/discover?type=movie&keywords=9716`]: { titles: [title], partial: true },
      [`${BASE}/discover?type=series&keywords=9716`]: { titles: [title] },
    });
    const partial = service.discover({ type: 'movie', keywords: [9716] });
    const whole = service.discover({ type: 'series', keywords: [9716] });
    partial.load();
    whole.load();
    await flush();
    expect(partial.get().data?.titles).toHaveLength(1);
    partial.load();
    whole.load();
    await flush();
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/discover?type=movie&keywords=9716`,
      `${BASE}/discover?type=series&keywords=9716`,
      `${BASE}/discover?type=movie&keywords=9716`,
    ]);
  });
});

describe('roleOf', () => {
  it("reads a person's row from what TMDB says they are known for", () => {
    expect(roleOf('Acting')).toBe('cast');
    expect(roleOf('Directing')).toBe('directing');
    expect(roleOf('Writing')).toBe('writing');
    expect(roleOf('Sound')).toBe('any');
    expect(roleOf(undefined)).toBe('any');
  });
});
