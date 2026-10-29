import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { buildBoard } from './board';
import type { InstalledAddon } from './collection';
import { BANNERTV_DEMO_URL, DEFAULT_ADDONS } from './defaults';

function installed(
  manifest: unknown,
  transportUrl = 'https://a.example/manifest.json',
): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const defaults = DEFAULT_ADDONS.map((a) => installed(a.manifest, a.transportUrl));
/** Cinemeta and OpenSubtitles v3 as shipped, without BannerTV Demo. */
const stremio = defaults.filter((a) => a.transportUrl !== BANNERTV_DEMO_URL);

describe('buildBoard', () => {
  it('turns Cinemeta into Popular and Featured rows plus genre rows', () => {
    const rows = buildBoard(stremio);
    expect(rows.map((r) => [r.key, r.name, r.type, r.style, r.extra])).toEqual([
      ['0-movie-top', 'Popular', 'movie', 'poster', []],
      ['0-series-top', 'Popular', 'series', 'poster', []],
      ['0-movie-imdbrating', 'Featured', 'movie', 'landscape', []],
      ['0-series-imdbrating', 'Featured', 'series', 'landscape', []],
      ['0-movie-top-genre-action', 'Action', 'movie', 'poster', [['genre', 'Action']]],
      ['0-series-top-genre-crime', 'Crime', 'series', 'poster', [['genre', 'Crime']]],
      ['0-movie-top-genre-comedy', 'Comedy', 'movie', 'poster', [['genre', 'Comedy']]],
      ['0-series-top-genre-drama', 'Drama', 'series', 'poster', [['genre', 'Drama']]],
      ['0-movie-top-genre-sci-fi', 'Sci-Fi', 'movie', 'poster', [['genre', 'Sci-Fi']]],
      ['0-series-top-genre-animation', 'Animation', 'series', 'poster', [['genre', 'Animation']]],
    ]);
    // "New" needs a year, and OpenSubtitles has no catalogs, so neither makes a row.
    expect(rows.some((r) => r.catalog.id === 'year')).toBe(false);
  });

  it('follows collection order and takes genre rows from the first addon that can', () => {
    const other = installed(
      {
        id: 'org.other',
        version: '1.0.0',
        name: 'Other',
        types: ['movie'],
        resources: ['catalog'],
        catalogs: [
          {
            type: 'movie',
            id: 'trending',
            name: 'Trending now',
            extra: [{ name: 'genre', options: ['Action'] }],
          },
          { type: 'movie', id: 'x', name: 'Same slug' },
          { type: 'movie', id: 'X!', name: 'Same slug again' },
        ],
      },
      'https://other.example/manifest.json',
    );
    const rows = buildBoard([other, ...stremio]);
    expect(rows.slice(0, 4).map((r) => [r.key, r.style])).toEqual([
      ['0-movie-trending', 'landscape'],
      ['0-movie-x', 'poster'],
      ['0-movie-x-2', 'poster'],
      ['0-movie-trending-genre-action', 'poster'],
    ]);
    // Cinemeta still adds series genres, but no more movie genres.
    const cinemetaGenres = rows.filter((r) => r.kind === 'genre' && r.key.indexOf('1-') === 0);
    expect(cinemetaGenres.map((r) => r.type)).toEqual(['series', 'series', 'series']);
  });

  it('starts a new TV on BannerTV Demo, with genre rows still from Cinemeta', () => {
    const rows = buildBoard(defaults);
    expect(rows.slice(0, 3).map((r) => [r.key, r.name, r.style])).toEqual([
      ['0-movie-blender', 'Blender open movies', 'poster'],
      ['1-movie-top', 'Popular', 'poster'],
      ['1-series-top', 'Popular', 'poster'],
    ]);
    const genres = rows.filter((r) => r.kind === 'genre');
    expect(genres.length).toBeGreaterThan(0);
    expect(genres.every((r) => r.key.indexOf('1-') === 0)).toBe(true);
  });

  it('is empty without addons', () => {
    expect(buildBoard([])).toEqual([]);
  });
});
