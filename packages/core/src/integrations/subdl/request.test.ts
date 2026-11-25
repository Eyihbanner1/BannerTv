import { describe, expect, it } from 'vitest';
import { FAKE_SUBDL_KEY } from './fixtures';
import {
  type SubdlAsk,
  subdlAskFor,
  subdlCacheKey,
  subdlKeyCheckRequest,
  subdlSearchRequest,
} from './request';

const film: SubdlAsk = { type: 'movie', imdbId: 'tt9900001', languages: ['EN'] };
const episode: SubdlAsk = {
  type: 'tv',
  imdbId: 'tt9900002',
  season: 2,
  episode: 3,
  languages: ['EN', 'BR_PT'],
};

describe('subdlSearchRequest', () => {
  it('asks v2 with the key in X-API-Key only', () => {
    const request = subdlSearchRequest(film, FAKE_SUBDL_KEY, 'v2-header');
    expect(request.url).toBe(
      'https://api.subdl.com/api/v2/subtitles/search?imdb_id=tt9900001&type=movie&languages=en&subs_per_page=30&releases=1&unpack=1',
    );
    expect(request.headers).toEqual({ 'X-API-Key': FAKE_SUBDL_KEY });
    expect(request.url).not.toContain(FAKE_SUBDL_KEY);
    const show = subdlSearchRequest(episode, FAKE_SUBDL_KEY, 'v2-header');
    expect(show.url).toBe(
      'https://api.subdl.com/api/v2/subtitles/search?imdb_id=tt9900002&type=tv&season=2&episode=3&languages=en,br_pt&subs_per_page=30&releases=1&unpack=1',
    );
    expect(show.url).not.toContain(FAKE_SUBDL_KEY);
  });

  it('asks v1 with the key in api_key only', () => {
    const request = subdlSearchRequest(film, FAKE_SUBDL_KEY, 'v1-query');
    expect(request.url).toBe(
      `https://api.subdl.com/api/v1/subtitles?api_key=${FAKE_SUBDL_KEY}&imdb_id=tt9900001&type=movie&languages=EN&subs_per_page=30&releases=1&unpack=1`,
    );
    expect(request.headers).toEqual({});
    expect(subdlSearchRequest(episode, FAKE_SUBDL_KEY, 'v1-query').url).toBe(
      `https://api.subdl.com/api/v1/subtitles?api_key=${FAKE_SUBDL_KEY}&imdb_id=tt9900002&type=tv&season_number=2&episode_number=3&languages=EN,BR_PT&subs_per_page=30&releases=1&unpack=1`,
    );
  });

  it('encodes the values', () => {
    const odd = subdlSearchRequest(film, 'key&x=1', 'v1-query');
    expect(odd.url).toContain('api_key=key%26x%3D1&');
  });

  it("checks a key at SubDL's account address, in a header", () => {
    expect(subdlKeyCheckRequest(FAKE_SUBDL_KEY)).toEqual({
      url: 'https://api.subdl.com/api/v2/me',
      headers: { 'X-API-Key': FAKE_SUBDL_KEY },
    });
  });
});

describe('subdlCacheKey', () => {
  it('names the ask and never the key', () => {
    expect(subdlCacheKey(film)).toBe('subdl:2|movie|tt9900001|||EN');
    expect(subdlCacheKey(episode)).toBe('subdl:2|tv|tt9900002|2|3|EN,BR_PT');
    expect(subdlCacheKey(film)).not.toContain(FAKE_SUBDL_KEY);
  });
});

describe('subdlAskFor', () => {
  it('asks for films and series episodes by IMDb id', () => {
    expect(subdlAskFor('movie', 'tt9900001', ['en'])).toEqual(film);
    expect(subdlAskFor('series', 'tt9900002:2:3', ['eng', 'pt-br'])).toEqual(episode);
  });

  it('skips specials, ids that are not IMDb, and no language', () => {
    expect(subdlAskFor('series', 'tt9900002:0:3', ['en'])).toEqual({ skip: 'special' });
    expect(subdlAskFor('series', 'kitsu:1234:5', ['en'])).toEqual({ skip: 'not imdb' });
    expect(subdlAskFor('movie', 'tmdb:550', ['en'])).toEqual({ skip: 'not imdb' });
    expect(subdlAskFor('movie', 'tt9900001', [])).toEqual({ skip: 'subtitles off' });
    expect(subdlAskFor('movie', 'tt9900001', ['und'])).toEqual({ skip: 'subtitles off' });
  });

  it('asks at most two languages, without the same one twice', () => {
    const ask = subdlAskFor('movie', 'tt9900001', ['en', 'eng', 'en-GB', 'fr', 'de']);
    expect(ask).toEqual({ ...film, languages: ['EN', 'FR'] });
  });
});
