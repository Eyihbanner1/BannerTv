import { type MetaPreview, parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { InstalledAddon } from '../addons/collection';
import { BANNERTV_DEMO_URL, DEFAULT_ADDONS } from '../addons/defaults';
import { discoverSources } from '../addons/sources';
import { addonPhrases, planSearch } from './plan';
import { topResults } from './rank';
import { didYouMean, genreChips, suggestions } from './suggest';
import { understand } from './understand';

function installed(manifest: unknown, transportUrl: string): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const cinemeta = DEFAULT_ADDONS.filter((a) => a.transportUrl !== BANNERTV_DEMO_URL).map((a) =>
  installed(a.manifest, a.transportUrl),
);

const anime = installed(
  {
    id: 'org.anime',
    version: '1.0.0',
    name: 'Anime Hub',
    types: ['anime', 'series'],
    resources: ['catalog'],
    catalogs: [
      {
        type: 'anime',
        id: 'trending',
        name: 'Anime Trending',
        extra: [{ name: 'genre', options: ['Mecha', 'Comedy'] }],
      },
      { type: 'series', id: 'top', name: 'Popular', extra: [] },
    ],
  },
  'https://anime.example/manifest.json',
);

const adult = installed(
  {
    id: 'org.late',
    version: '1.0.0',
    name: 'Late',
    types: ['movie'],
    resources: ['catalog'],
    behaviorHints: { adult: true },
    catalogs: [
      {
        type: 'movie',
        id: 'late',
        name: 'Late films',
        extra: [{ name: 'genre', options: ['Comedy'] }],
      },
    ],
  },
  'https://late.example/manifest.json',
);

const plan = (text: string, addons = cinemeta, kids = false) => {
  const sources = discoverSources(addons);
  return planSearch(understand(text, addonPhrases(sources)), sources, { kids });
};
const rows = (text: string, addons = cinemeta, kids = false) =>
  plan(text, addons, kids).map((row) => [row.kind, row.label, row.type, row.extra[0]?.[1] ?? '']);

describe('planSearch', () => {
  it("asks Cinemeta's Popular catalogs for a genre, films first", () => {
    expect(rows('comedy')).toEqual([
      ['genre', 'Comedy', 'movie', 'Comedy'],
      ['genre', 'Comedy', 'series', 'Comedy'],
    ]);
    expect(plan('comedy')[0]).toMatchObject({
      key: '0-movie-top-genre-comedy',
      source: { catalog: { id: 'top', name: 'Popular' } },
      family: false,
    });
  });

  it('keeps to the type the words name, and to the types a genre has', () => {
    expect(rows('scary movies')).toEqual([['genre', 'Horror', 'movie', 'Horror']]);
    expect(rows('sci fi series')).toEqual([['genre', 'Sci-fi', 'series', 'Sci-Fi']]);
    expect(rows('reality')).toEqual([['genre', 'Reality TV', 'series', 'Reality-TV']]);
  });

  it('gives stand-up and other moods their nearest genre until Search may ask TMDB', () => {
    expect(rows('stand-up')).toEqual([
      ['genre', 'Comedy', 'movie', 'Comedy'],
      ['genre', 'Comedy', 'series', 'Comedy'],
    ]);
    expect(rows('true crime')).toEqual([
      ['genre', 'Documentary', 'movie', 'Documentary'],
      ['genre', 'Documentary', 'series', 'Documentary'],
      ['genre', 'Crime', 'movie', 'Crime'],
      ['genre', 'Crime', 'series', 'Crime'],
    ]);
    // Languages and decades need TMDB: no rows yet, and none made up.
    expect(rows('korean')).toEqual([]);
    expect(rows('90s')).toEqual([]);
    expect(rows('90s action')).toEqual([
      ['genre', 'Action', 'movie', 'Action'],
      ['genre', 'Action', 'series', 'Action'],
    ]);
  });

  it("uses Cinemeta's New catalog for a typed year and for new titles", () => {
    expect(rows('2024 films')).toEqual([['year', '2024', 'movie', '2024']]);
    expect(rows('new series')).toEqual([['new', '2026', 'series', '2026']]);
    // A year no catalog lists adds nothing.
    expect(rows('1901')).toEqual([]);
  });

  it('adds nothing for titles, or words it cannot read', () => {
    expect(rows('star wars')).toEqual([]);
    expect(rows('sintel')).toEqual([]);
  });

  it("finds an installed addon's own genres and catalogs by name", () => {
    expect(rows('mecha', [anime].concat(cinemeta))).toEqual([['genre', 'Mecha', 'anime', 'Mecha']]);
    expect(rows('anime trending', [anime].concat(cinemeta))).toEqual([
      ['catalog', 'Anime Trending', 'anime', ''],
    ]);
    // "Popular" names nothing on its own.
    expect(rows('popular', [anime].concat(cinemeta))).toEqual([]);
    // The first addon that filters by a genre answers for it.
    expect(rows('comedy films', [anime, adult].concat(cinemeta))[0]?.[1]).toBe('Comedy');
    expect(plan('comedy films', [adult].concat(cinemeta))[0]?.source.addon.manifest.name).toBe(
      'Late',
    );
  });

  it('keeps a kids profile to films and series from addons not marked adult', () => {
    const kids = plan('comedy films', [adult].concat(cinemeta), true);
    expect(kids.map((row) => row.source.addon.manifest.name)).toEqual(['Cinemeta']);
    expect(rows('mecha', [anime].concat(cinemeta), true)).toEqual([]);
    const family = plan('for kids', cinemeta, true);
    expect(family.map((row) => [row.label, row.family])).toEqual([
      ['Family', true],
      ['Family', true],
    ]);
  });

  it('caps the rows and never repeats one', () => {
    const many = plan('comedy horror action drama war western');
    expect(many).toHaveLength(6);
    expect(new Set(many.map((row) => row.key)).size).toBe(6);
    expect(rows('comedy comedy')).toHaveLength(2);
  });
});

const meta = (id: string, name: string, releaseInfo?: string, type = 'movie'): MetaPreview => ({
  id,
  type,
  name,
  posterShape: 'poster',
  genres: [],
  trailers: [],
  ...(releaseInfo ? { releaseInfo } : {}),
});

describe('topResults', () => {
  const names = (text: string, groups: MetaPreview[][], context = {}) =>
    topResults(understand(text), groups, context).map((item) => item.name);

  it('puts the exact title first, then titles that start with the words', () => {
    expect(
      names('stand up', [
        [meta('a', 'Stand Up Guys'), meta('b', 'Stand Up'), meta('c', 'The Stand')],
        [meta('d', 'Stand Up and Cheer!')],
      ]),
    ).toEqual(['Stand Up', 'Stand Up Guys', 'Stand Up and Cheer!', 'The Stand']);
  });

  it('shows each title once, from the first addon that has it', () => {
    const first = meta('tt1', 'Sintel', '2010');
    const again = { ...meta('tt1', 'Sintel (copy)'), poster: 'x' };
    expect(topResults(understand('sintel'), [[first], [again]])).toEqual([first]);
  });

  it('lifts the typed year, and titles in My List or Continue Watching', () => {
    const groups = [[meta('a', 'Dune', '1984'), meta('b', 'Dune', '2021')]];
    expect(topResults(understand('dune 2021'), groups).map((item) => item.id)).toEqual(['b', 'a']);
    expect(
      topResults(understand('dune'), groups, { saved: (id) => id === 'b' }).map((item) => item.id),
    ).toEqual(['b', 'a']);
  });

  it('reads a typed year as part of a name too', () => {
    const groups = [[meta('a', 'Blade Runner', '1982'), meta('b', 'Blade Runner 2049', '2017')]];
    expect(topResults(understand('blade runner 2049'), groups).map((item) => item.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('keeps to the type the words ask for', () => {
    const groups = [[meta('a', 'Scary Movie'), meta('b', 'Scary Stories', '2019', 'series')]];
    expect(names('scary films', groups)).toEqual(['Scary Movie']);
    expect(names('scary', groups)).toEqual(['Scary Movie', 'Scary Stories']);
  });

  it('forgives a typo in the name', () => {
    expect(names('breking bad', [[meta('a', 'Bad Boys'), meta('b', 'Breaking Bad')]])).toEqual([
      'Breaking Bad',
      'Bad Boys',
    ]);
  });
});

describe('suggestions', () => {
  it('offers the title or phrase a typo away', () => {
    expect(didYouMean('breking bad', ['Better Call Saul', 'Breaking Bad'])).toBe('Breaking Bad');
    expect(didYouMean('stranger thinsg', ['Stranger Things'])).toBe('Stranger Things');
    expect(didYouMean('documentaryy', [])).toBe('documentary');
    expect(didYouMean('sintel', ['Sintel'])).toBeUndefined();
    expect(didYouMean('zzz', ['Sintel'])).toBeUndefined();
  });

  it('offers genres the installed catalogs have, the closest first', () => {
    const sources = discoverSources(cinemeta);
    expect(genreChips('zzz', sources).map((chip) => chip.label)).toEqual([
      'Comedy',
      'Action',
      'Drama',
      'Horror',
      'Sci-fi',
    ]);
    // Two typos from Horror: too far for Search to read it, close enough to offer it.
    expect(understand('hurrer').intents).toEqual([]);
    expect(genreChips('hurrer', sources)[0]?.label).toBe('Horror');
    expect(genreChips('zzz', sources, { kids: true }).map((chip) => chip.label)).toEqual([
      'Family',
      'Animation',
      'Comedy',
      'Adventure',
      'Fantasy',
    ]);
    expect(genreChips('zzz', [])).toEqual([]);
    // Never a genre a kids profile sees nothing of.
    expect(genreChips('hurrer', sources, { kids: true }).map((chip) => chip.label)).not.toContain(
      'Horror',
    );
  });
});

describe('suggestions', () => {
  it('offers recent searches, then TMDB people and titles, then phrases and known titles', () => {
    expect(
      suggestions('stan', {
        recent: ['stand by me', 'dune'],
        remote: {
          people: [{ id: 1, name: 'Stanley Tucci', knownFor: [] }],
          titles: [
            { name: 'Stand by Me', type: 'movie', year: '1986' },
            { name: 'Stan & Ollie', type: 'movie', year: '2018' },
          ],
        },
        known: ['Stanleyville', 'Dune'],
      }),
    ).toEqual([
      { label: 'stand by me', query: 'stand by me', kind: 'recent', key: 'standbyme' },
      { label: 'Stanley Tucci', query: 'Stanley Tucci', kind: 'person', key: 'stanleytucci' },
      { label: 'Stan & Ollie (2018)', query: 'Stan & Ollie', kind: 'title', key: 'stanandolly' },
      { label: 'Stand-up comedy', query: 'Stand-up comedy', kind: 'phrase', key: 'standupcomedy' },
      { label: 'Stanleyville', query: 'Stanleyville', kind: 'known', key: 'stanleyville' },
    ]);
  });

  it("keys each suggestion by its words, so a list that changes keeps each one's key", () => {
    const before = suggestions('tom').map((item) => item.key);
    const after = suggestions('tom', {
      remote: { people: [{ id: 31, name: 'Tom Hanks', knownFor: [] }], titles: [] },
    }).map((item) => item.key);
    expect(after[0]).toBe('tomhank');
    for (const key of before) expect(after).toContain(key);
    for (const key of after) expect(key).toMatch(/^[a-z0-9]+$/);
  });

  it('offers nothing for one letter or for the words themselves, and at most six', () => {
    expect(suggestions('s')).toEqual([]);
    expect(suggestions('korean').map((item) => item.label)).toEqual([]);
    expect(suggestions('co').length).toBeLessThanOrEqual(6);
    expect(suggestions('kor').map((item) => item.label)).toEqual(['Korean']);
  });

  it('gives a kids profile no people, no TMDB titles and no genres not for children', () => {
    const kids = suggestions('hor', {
      kids: true,
      remote: { people: [{ id: 1, name: 'Horace', knownFor: [] }], titles: [] },
    });
    expect(kids).toEqual([]);
    expect(suggestions('hor').map((item) => item.label)).toEqual(['Horror']);
    expect(suggestions('fam', { kids: true }).map((item) => item.label)).toEqual(['Family']);
  });
});

describe('planSearch with TMDB', () => {
  it('leaves moods TMDB tags by keyword to TMDB, and keeps genres', () => {
    const sources = discoverSources(cinemeta);
    expect(planSearch(understand('stand-up'), sources, { remoteMoods: true })).toEqual([]);
    expect(planSearch(understand('stand-up films'), sources).map((row) => row.label)).toEqual([
      'Comedy',
    ]);
    expect(
      planSearch(understand('comedy films'), sources, { remoteMoods: true }).map(
        (row) => row.label,
      ),
    ).toEqual(['Comedy']);
  });
});
