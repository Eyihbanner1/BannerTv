import { describe, expect, it } from 'vitest';
import { catalogsFromManyAddons, discoverSelection, resolveDiscover } from './browse';
import type { DiscoverSource } from './sources';

function source(
  transportUrl: string,
  type: string,
  id: string,
  genres: string[] = [],
  genreRequired = false,
): DiscoverSource {
  return {
    key: `${transportUrl}-${type}-${id}`,
    addon: { transportUrl } as DiscoverSource['addon'],
    catalog: { type, id, name: id } as DiscoverSource['catalog'],
    genres,
    genreRequired,
    pageable: true,
  };
}

const POPULAR = source('a', 'movie', 'top', ['Action', 'Drama']);
const YEAR = source('a', 'movie', 'year', ['2026', '2025'], true);
const SERIES = source('a', 'series', 'top');
const OTHER = source('b', 'movie', 'trending');
const SOURCES = [SERIES, POPULAR, YEAR, OTHER];

describe('resolveDiscover', () => {
  it('starts on the first catalog of the first type, movies first', () => {
    expect(resolveDiscover(SOURCES, undefined)).toMatchObject({
      types: ['movie', 'series'],
      source: POPULAR,
      genre: undefined,
    });
  });

  it('keeps a wish the addons can answer, and drops a genre the catalog does not list', () => {
    expect(
      resolveDiscover(SOURCES, {
        type: 'movie',
        transportUrl: 'a',
        catalogId: 'top',
        genre: 'Drama',
      }),
    ).toMatchObject({ source: POPULAR, genre: 'Drama' });
    expect(
      resolveDiscover(SOURCES, {
        type: 'movie',
        transportUrl: 'a',
        catalogId: 'top',
        genre: 'Jazz',
      })?.genre,
    ).toBeUndefined();
  });

  it('falls back to the first of the type, and to the first genre of a catalog that needs one', () => {
    expect(
      resolveDiscover(SOURCES, { type: 'series', transportUrl: 'gone', catalogId: 'x' })?.source,
    ).toBe(SERIES);
    expect(
      resolveDiscover(SOURCES, { type: 'movie', transportUrl: 'a', catalogId: 'year' }),
    ).toMatchObject({ source: YEAR, genre: '2026' });
    expect(
      resolveDiscover(SOURCES, { type: 'channel', transportUrl: '', catalogId: '' })?.source,
    ).toBe(POPULAR);
  });

  it('is null with nothing to browse', () => {
    expect(resolveDiscover([], undefined)).toBeNull();
  });
});

describe('discoverSelection and catalogsFromManyAddons', () => {
  it('names the source, with the genre only when there is one', () => {
    expect(discoverSelection(POPULAR, undefined)).toEqual({
      type: 'movie',
      transportUrl: 'a',
      catalogId: 'top',
    });
    expect(discoverSelection(POPULAR, 'Action').genre).toBe('Action');
  });

  it('says when a type has catalogs from more than one addon', () => {
    expect(catalogsFromManyAddons(resolveDiscover(SOURCES, undefined)!)).toBe(true);
    expect(catalogsFromManyAddons(resolveDiscover([SERIES], undefined)!)).toBe(false);
  });
});
