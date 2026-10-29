import { describe, expect, it } from 'vitest';
import { metaIdFromIds, traktIds, traktTarget } from './ids';

describe('traktIds', () => {
  it('takes IMDb ids and tmdb: ids', () => {
    expect(traktIds('tt0372784')).toEqual({ imdb: 'tt0372784' });
    expect(traktIds('tmdb:272')).toEqual({ tmdb: 272 });
  });

  it('turns down ids Trakt cannot take', () => {
    for (const id of ['kitsu:1', 'tt', 'tt12a', 'TT0372784', 'tmdb:', 'tmdb:abc', 'tmdb:0', '']) {
      expect(traktIds(id)).toBeUndefined();
    }
    expect(traktIds('tmdb:99999999999999999999')).toBeUndefined();
  });
});

describe('traktTarget', () => {
  it('names a film by its ids', () => {
    expect(traktTarget('movie', 'tt0372784', 'tt0372784')).toEqual({
      movie: { ids: { imdb: 'tt0372784' } },
    });
    expect(traktTarget('movie', 'tmdb:272', 'tmdb:272')).toEqual({ movie: { ids: { tmdb: 272 } } });
  });

  it('names an episode by its show, season and number', () => {
    expect(traktTarget('series', 'tt0903747', 'tt0903747:1:2')).toEqual({
      show: { ids: { imdb: 'tt0903747' } },
      episode: { season: 1, number: 2 },
    });
    expect(traktTarget('series', 'tmdb:1396', 'tmdb:1396:0:3')).toEqual({
      show: { ids: { tmdb: 1396 } },
      episode: { season: 0, number: 3 },
    });
  });

  it('gives nothing for a series video without a season and an episode', () => {
    expect(traktTarget('series', 'tt0903747', 'tt0903747')).toBeUndefined();
    expect(traktTarget('series', 'tt0903747', 'tt0903747:1')).toBeUndefined();
    expect(traktTarget('series', 'tt0903747', 'tt0903747:1:2:3')).toBeUndefined();
    expect(traktTarget('series', 'tt0903747', 'tt0903747:s1:e2')).toBeUndefined();
  });

  it("gives nothing for another show's episode", () => {
    expect(traktTarget('series', 'tt0903747', 'tt1234567:1:2')).toBeUndefined();
    expect(traktTarget('series', 'tt090374', 'tt0903747:1:2')).toBeUndefined();
  });

  it('gives nothing for ids Trakt cannot take or other types', () => {
    expect(traktTarget('series', 'kitsu:1376', 'kitsu:1376:1')).toBeUndefined();
    expect(traktTarget('movie', 'kitsu:1376', 'kitsu:1376')).toBeUndefined();
    expect(traktTarget('channel', 'tt0372784', 'tt0372784')).toBeUndefined();
    expect(traktTarget('tv', 'tt0372784', 'tt0372784')).toBeUndefined();
  });
});

describe('metaIdFromIds', () => {
  it('prefers the IMDb id', () => {
    expect(
      metaIdFromIds({ trakt: 1, slug: 'batman-begins-2005', imdb: 'tt0372784', tmdb: 272 }),
    ).toBe('tt0372784');
  });

  it('falls back to the TMDB id', () => {
    expect(metaIdFromIds({ trakt: 1, imdb: null, tmdb: 272 })).toBe('tmdb:272');
    expect(metaIdFromIds({ imdb: '', tmdb: 272 })).toBe('tmdb:272');
  });

  it('gives nothing without either', () => {
    expect(metaIdFromIds({ trakt: 1, tvdb: 81189 })).toBeUndefined();
    expect(metaIdFromIds({ imdb: 'nm0000123', tmdb: '272' })).toBeUndefined();
    expect(metaIdFromIds({ tmdb: 2.5 })).toBeUndefined();
    expect(metaIdFromIds(null)).toBeUndefined();
    expect(metaIdFromIds('tt0372784')).toBeUndefined();
    expect(metaIdFromIds([])).toBeUndefined();
  });
});
