import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { InstalledAddon } from '../addons/collection';
import { DEFAULT_ADDONS } from '../addons/defaults';
import { buildKidsBoard, kidsAddons, kidsTitleAllowed, ratingAllowed, ukRating } from './kids';

function installed(
  manifest: unknown,
  transportUrl = 'https://a.example/manifest.json',
): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const defaults = DEFAULT_ADDONS.map((a) => installed(a.manifest, a.transportUrl));

const adult = installed(
  {
    id: 'org.adult',
    version: '1.0.0',
    name: 'Adult',
    types: ['movie'],
    resources: ['catalog', 'stream'],
    catalogs: [
      { type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'genre', options: ['Family'] }] },
    ],
    behaviorHints: { adult: true },
  },
  'https://adult.example/manifest.json',
);

describe('kidsTitleAllowed', () => {
  it('lets in films and series named as for families or children', () => {
    expect(kidsTitleAllowed({ type: 'movie', genres: ['Animation', 'Family'] })).toBe(true);
    expect(kidsTitleAllowed({ type: 'series', genres: [' kids '] })).toBe(true);
    expect(kidsTitleAllowed({ type: 'series', genres: ['Children'] })).toBe(true);
  });

  it('leaves out everything else, including titles with no genres', () => {
    expect(kidsTitleAllowed({ type: 'series', genres: ['Animation', 'Comedy'] })).toBe(false);
    expect(kidsTitleAllowed({ type: 'movie', genres: [] })).toBe(false);
    expect(kidsTitleAllowed({ type: 'movie', genres: ['Family', 'Horror'] })).toBe(false);
    expect(kidsTitleAllowed({ type: 'movie', genres: ['Family', 'Crime'] })).toBe(false);
    expect(kidsTitleAllowed({ type: 'tv', genres: ['Family'] })).toBe(false);
    expect(kidsTitleAllowed({ type: 'channel', genres: ['Kids'] })).toBe(false);
  });

  it('trusts a Family catalog for what it leaves out, not for what is unsuitable', () => {
    expect(kidsTitleAllowed({ type: 'movie', genres: [] }, true)).toBe(true);
    expect(kidsTitleAllowed({ type: 'movie', genres: ['Animation'] }, true)).toBe(true);
    expect(kidsTitleAllowed({ type: 'movie', genres: ['Horror'] }, true)).toBe(false);
    expect(kidsTitleAllowed({ type: 'tv', genres: [] }, true)).toBe(false);
  });
});

describe('age ratings', () => {
  it('reads UK certificates, with 12A as 12', () => {
    expect(ukRating('U', 'GB')).toBe('U');
    expect(ukRating(' 12a ', 'GB')).toBe('12');
    expect(ukRating('15', 'GB')).toBe('15');
    expect(ukRating('', 'GB')).toBeUndefined();
    expect(ukRating('NR', 'GB')).toBeUndefined();
  });

  it('maps US film and TV ratings up to the nearest UK one', () => {
    expect(ukRating('G', 'US')).toBe('U');
    expect(ukRating('PG-13', 'US')).toBe('12');
    expect(ukRating('R', 'US')).toBe('15');
    expect(ukRating('TV-Y7', 'US')).toBe('U');
    expect(ukRating('TV-PG', 'US')).toBe('PG');
    expect(ukRating('TV-14', 'US')).toBe('15');
    expect(ukRating('TV-MA', 'US')).toBe('18');
    expect(ukRating('Unrated', 'US')).toBeUndefined();
  });

  it('allows ratings up to the profile limit', () => {
    expect(ratingAllowed('U', 'PG')).toBe(true);
    expect(ratingAllowed('PG', 'PG')).toBe(true);
    expect(ratingAllowed('12', 'PG')).toBe(false);
    expect(ratingAllowed('12', '12')).toBe(true);
    expect(ratingAllowed('15', '12')).toBe(false);
    expect(ratingAllowed('weird', '12')).toBe(false);
  });
});

describe('kids addons and Home', () => {
  it('drops adult addons', () => {
    expect(kidsAddons([adult, ...defaults]).map((a) => a.manifest.id)).toEqual(
      defaults.map((a) => a.manifest.id),
    );
  });

  it('builds Family rows from the catalogs that can filter by it', () => {
    const rows = buildKidsBoard([adult, ...defaults]);
    expect(rows.map((r) => [r.key, r.name, r.type, r.extra])).toEqual([
      ['1-movie-top-genre-family', 'Popular', 'movie', [['genre', 'Family']]],
      ['1-series-top-genre-family', 'Popular', 'series', [['genre', 'Family']]],
      ['1-movie-imdbrating-genre-family', 'Featured', 'movie', [['genre', 'Family']]],
      ['1-series-imdbrating-genre-family', 'Featured', 'series', [['genre', 'Family']]],
    ]);
  });

  it('gives a catalog without the genre no row', () => {
    const plain = installed({
      id: 'org.plain',
      version: '1.0.0',
      name: 'Plain',
      types: ['movie', 'tv'],
      resources: ['catalog'],
      catalogs: [
        { type: 'movie', id: 'new', name: 'New' },
        { type: 'tv', id: 'live', name: 'Live', extra: [{ name: 'genre', options: ['Family'] }] },
        {
          type: 'movie',
          id: 'needs',
          name: 'Needs',
          extra: [{ name: 'genre', isRequired: true, options: ['Family'] }],
        },
      ],
    });
    expect(buildKidsBoard([plain])).toEqual([]);
  });
});
