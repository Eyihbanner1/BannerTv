import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { InstalledAddon } from '../addons/collection';
import { BANNERTV_DEMO_URL, DEFAULT_ADDONS } from '../addons/defaults';
import { discoverSources, searchSources } from '../addons/sources';
import {
  buildKidsBoard,
  kidsAddons,
  kidsDetailsAllowed,
  kidsDiscoverSources,
  kidsSearchSources,
  kidsTitleAllowed,
  ratingAllowed,
  ukRating,
} from './kids';

function installed(
  manifest: unknown,
  transportUrl = 'https://a.example/manifest.json',
): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

// Cinemeta and OpenSubtitles v3, without BannerTV Demo.
const defaults = DEFAULT_ADDONS.filter((a) => a.transportUrl !== BANNERTV_DEMO_URL).map((a) =>
  installed(a.manifest, a.transportUrl),
);

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

describe('kids Discover and Search', () => {
  const tv = installed(
    {
      id: 'org.tv',
      version: '1.0.0',
      name: 'TV',
      types: ['tv', 'movie'],
      resources: ['catalog'],
      catalogs: [
        { type: 'tv', id: 'live', name: 'Live', extra: [{ name: 'search' }] },
        { type: 'movie', id: 'new', name: 'New', extra: [{ name: 'genre', options: ['Drama'] }] },
      ],
    },
    'https://tv.example/manifest.json',
  );

  it('keeps film and series catalogs that can ask for Family, and only for Family', () => {
    const sources = kidsDiscoverSources(discoverSources([...defaults, adult, tv]));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(['movie', 'series']).toContain(source.catalog.type);
      expect(source.addon.manifest.behaviorHints.adult).toBe(false);
      expect(source.genres).toEqual(['Family']);
      expect(source.genreRequired).toBe(true);
    }
    expect(sources.some((s) => s.catalog.id === 'new')).toBe(false);
  });

  it('searches films and series only, never an adult addon', () => {
    const sources = kidsSearchSources(searchSources([...defaults, adult, tv]));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.catalog.type === 'movie' || s.catalog.type === 'series')).toBe(
      true,
    );
    expect(sources.some((s) => s.addon === adult || s.addon === tv)).toBe(false);
  });
});

describe('kidsDetailsAllowed', () => {
  const film = (genres: string[]) => ({ type: 'movie', genres });

  it('lets the strictest UK rating decide: a PG at the cinema and 15 on disc is a 15', () => {
    const rated = { certificate: 'PG', strictestCertificate: '15' };
    expect(kidsDetailsAllowed(film(['Animation']), rated, 'PG')).toBe(false);
    expect(kidsDetailsAllowed(film(['Animation']), rated, '12')).toBe(false);
    expect(kidsDetailsAllowed(film(['Animation']), { certificate: 'PG' }, 'PG')).toBe(true);
  });

  it('needs no Family genre with a rating, but never takes a genre not for children', () => {
    expect(kidsDetailsAllowed(film(['Animation', 'Adventure']), { certificate: 'U' }, 'PG')).toBe(
      true,
    );
    expect(kidsDetailsAllowed(film(['Horror']), { certificate: 'PG' }, '12')).toBe(false);
    expect(kidsDetailsAllowed(film(['Family']), { certificate: '12' }, 'PG')).toBe(false);
  });

  it('needs Family without a rating, and a profile limit with one', () => {
    expect(kidsDetailsAllowed(film(['Family', 'Comedy']), undefined, 'PG')).toBe(true);
    expect(kidsDetailsAllowed(film(['Comedy']), {}, 'PG')).toBe(false);
    expect(kidsDetailsAllowed(film([]), undefined, 'PG')).toBe(false);
    expect(kidsDetailsAllowed(film(['Family']), { certificate: 'U' }, undefined)).toBe(false);
    expect(
      kidsDetailsAllowed({ type: 'channel', genres: ['Family'] }, { certificate: 'U' }, 'PG'),
    ).toBe(false);
  });
});
