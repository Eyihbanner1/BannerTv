import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { InstalledAddon } from './collection';
import { DEFAULT_ADDONS } from './defaults';
import { discoverSources, orderedTypes, searchSources } from './sources';

function installed(manifest: unknown, transportUrl: string): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const defaults = DEFAULT_ADDONS.map((a) => installed(a.manifest, a.transportUrl));

const anime = installed(
  {
    id: 'org.anime',
    version: '1.0.0',
    name: 'Anime',
    types: ['anime', 'series'],
    resources: ['catalog'],
    catalogs: [
      { type: 'anime', id: 'trending', name: 'Trending', extra: [{ name: 'search' }] },
      {
        type: 'series',
        id: 'search',
        name: 'Search',
        extra: [{ name: 'search', isRequired: true }],
      },
      {
        type: 'series',
        id: 'by-studio',
        name: 'By studio',
        extra: [{ name: 'studio', isRequired: true, options: ['Ghibli'] }],
      },
    ],
  },
  'https://anime.example/manifest.json',
);

describe('searchSources', () => {
  it('groups searchable catalogs by type, movies and series first, then by addon priority', () => {
    const sources = searchSources([anime].concat(defaults));
    expect(sources.map((s) => [s.key, s.addon.manifest.name, s.catalog.type])).toEqual([
      ['1-movie-top', 'Cinemeta', 'movie'],
      ['0-series-search', 'Anime', 'series'],
      ['1-series-top', 'Cinemeta', 'series'],
      ['0-anime-trending', 'Anime', 'anime'],
    ]);
  });

  it('finds nothing when no addon can search', () => {
    expect(searchSources(defaults.slice(1))).toEqual([]);
  });
});

describe('discoverSources', () => {
  it('lists catalogs that need nothing or only a listed genre, with their genres and paging', () => {
    const sources = discoverSources(defaults.concat(anime));
    expect(sources.map((s) => [s.key, s.genreRequired, s.pageable, s.genres.length > 0])).toEqual([
      ['0-movie-top', false, true, true],
      ['0-series-top', false, true, true],
      ['0-movie-year', true, true, true],
      ['0-series-year', true, true, true],
      ['0-movie-imdbrating', false, true, true],
      ['0-series-imdbrating', false, true, true],
      ['2-anime-trending', false, false, false],
    ]);
    expect(sources[0]!.genres).toContain('Action');
    expect(orderedTypes(sources)).toEqual(['movie', 'series', 'anime']);
  });
});
