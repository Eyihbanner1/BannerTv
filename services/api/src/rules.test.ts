import { describe, expect, it } from 'vitest';
import {
  MAX_TOKEN_LENGTH,
  readRetryAfter,
  readTmdbCall,
  readTraktCall,
  tmdbCacheKey,
  tmdbRequest,
  traktAnswer,
  traktRequest,
} from './rules';

const SECRETS = { clientId: 'client-id', clientSecret: 'client-secret' };
const AGENT = 'BannerTV/test';

describe('readTraktCall', () => {
  it('accepts every call BannerTV makes', () => {
    for (const [method, path] of [
      ['POST', '/oauth/device/code'],
      ['GET', '/users/settings'],
      ['POST', '/scrobble/start'],
      ['POST', '/scrobble/pause'],
      ['POST', '/scrobble/stop'],
      ['GET', '/sync/last_activities'],
      ['GET', '/sync/playback'],
      ['GET', '/sync/playback/movies'],
      ['GET', '/sync/playback/episodes'],
      ['GET', '/sync/watched/movies'],
      ['GET', '/sync/watched/shows'],
      ['GET', '/sync/watchlist'],
      ['GET', '/sync/watchlist/movies'],
      ['GET', '/sync/watchlist/shows'],
      ['POST', '/sync/watchlist'],
      ['POST', '/sync/watchlist/remove'],
      ['POST', '/sync/history'],
      ['POST', '/sync/history/remove'],
    ]) {
      expect(readTraktCall({ method, path }), `${method} ${path}`).toMatchObject({ method, path });
    }
    for (const [path, field] of [
      ['/oauth/device/token', 'code'],
      ['/oauth/token', 'refresh_token'],
      ['/oauth/revoke', 'token'],
    ] as const) {
      expect(readTraktCall({ method: 'POST', path, body: { [field]: 'abc123' } }), path).toEqual({
        method: 'POST',
        path,
        query: '',
        body: { [field]: 'abc123' },
      });
    }
  });

  it('refuses methods and paths off the list', () => {
    for (const [method, path] of [
      ['GET', '/oauth/device/code'],
      ['DELETE', '/sync/playback/123'],
      ['POST', '/sync/watched/movies'],
      ['GET', '/sync/history'],
      ['GET', '/users/me'],
      ['GET', '/sync/watchlist/'],
      ['GET', '/sync/watchlist/../history'],
      ['GET', 'sync/watchlist'],
      ['GET', 'https://api.trakt.tv/sync/watchlist'],
      ['GET', '/sync/watchlist#movies'],
      ['get', '/sync/watchlist'],
      ['PUT', '/sync/watchlist'],
    ]) {
      expect(readTraktCall({ method, path }), `${method} ${path}`).toBeUndefined();
    }
    expect(readTraktCall({ method: 'GET' })).toBeUndefined();
    expect(readTraktCall({ path: '/sync/watchlist' })).toBeUndefined();
    expect(readTraktCall(null)).toBeUndefined();
    expect(readTraktCall([{ method: 'GET', path: '/sync/watchlist' }])).toBeUndefined();
    expect(readTraktCall('GET /sync/watchlist')).toBeUndefined();
  });

  it('keeps only extended, page and limit in the query, in name order', () => {
    expect(
      readTraktCall({
        method: 'GET',
        path: '/sync/watchlist/movies?limit=100&extended=full&page=2',
      })?.query,
    ).toBe('extended=full&limit=100&page=2');
    expect(
      readTraktCall({ method: 'GET', path: '/sync/watched/shows?extended=noseasons' })?.query,
    ).toBe('extended=noseasons');
    expect(readTraktCall({ method: 'GET', path: '/sync/playback?' })?.query).toBe('');
    for (const query of [
      'extended=full&client_id=x',
      'extended=full&extended=noseasons',
      'extended=',
      'extended=FULL',
      'extended=full%20x',
      'page=-1',
      'page=1.5',
      'limit=all',
      'limit',
    ]) {
      expect(readTraktCall({ method: 'GET', path: `/sync/watchlist?${query}` }), query).toBe(
        undefined,
      );
    }
  });

  it('takes a token that fits in a header, and treats null as none', () => {
    const path = '/sync/playback';
    expect(readTraktCall({ method: 'GET', path, token: 'a1b2' })?.token).toBe('a1b2');
    expect(readTraktCall({ method: 'GET', path, token: null })).toEqual({
      method: 'GET',
      path,
      query: '',
    });
    expect(
      readTraktCall({ method: 'GET', path, token: 'a'.repeat(MAX_TOKEN_LENGTH) })?.token,
    ).toHaveLength(MAX_TOKEN_LENGTH);
    for (const token of ['', 'a b', 'a\r\nX-Other: 1', 'é', 'a'.repeat(MAX_TOKEN_LENGTH + 1), 42]) {
      expect(readTraktCall({ method: 'GET', path, token }), String(token)).toBeUndefined();
    }
  });

  it('passes on a POST body as sent, and none for a GET', () => {
    const body = { movies: [{ ids: { imdb: 'tt0133093' } }] };
    expect(readTraktCall({ method: 'POST', path: '/sync/watchlist', body })?.body).toEqual(body);
    expect(readTraktCall({ method: 'POST', path: '/sync/watchlist', body: null })).toEqual({
      method: 'POST',
      path: '/sync/watchlist',
      query: '',
    });
    expect(readTraktCall({ method: 'GET', path: '/sync/watchlist', body })?.body).toBeUndefined();
  });

  it('keeps only the one field each OAuth path takes from the TV', () => {
    expect(
      readTraktCall({
        method: 'POST',
        path: '/oauth/device/code',
        body: { client_id: 'other-app' },
      })?.body,
    ).toEqual({});
    expect(
      readTraktCall({
        method: 'POST',
        path: '/oauth/token',
        body: { refresh_token: 'r1', client_secret: 'stolen', grant_type: 'password' },
      })?.body,
    ).toEqual({ refresh_token: 'r1' });
    for (const body of [undefined, null, {}, { code: '' }, { code: 7 }, { refresh: 'x' }, ['x']]) {
      expect(
        readTraktCall({ method: 'POST', path: '/oauth/device/token', body }),
        JSON.stringify(body),
      ).toBeUndefined();
    }
  });
});

describe('traktRequest', () => {
  it('sends the client id as a header, with the viewer token when there is one', () => {
    const call = readTraktCall({
      method: 'GET',
      path: '/sync/watchlist/movies?extended=full',
      token: 'viewer-token',
    })!;
    expect(traktRequest(call, SECRETS, AGENT)).toEqual({
      method: 'GET',
      url: 'https://api.trakt.tv/sync/watchlist/movies?extended=full',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': AGENT,
        'trakt-api-version': '2',
        'trakt-api-key': 'client-id',
        Authorization: 'Bearer viewer-token',
      },
    });
    const anonymous = traktRequest(
      readTraktCall({ method: 'GET', path: '/sync/last_activities' })!,
      SECRETS,
      AGENT,
    );
    expect(anonymous.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(anonymous)).not.toContain('client-secret');
  });

  it('sends a POST body as JSON, and an empty object when the TV sent none', () => {
    const body = { movie: { ids: { tmdb: 603 } }, progress: 41.5 };
    const start = traktRequest(
      readTraktCall({ method: 'POST', path: '/scrobble/start', body, token: 't' })!,
      SECRETS,
      AGENT,
    );
    expect(start.method).toBe('POST');
    expect(JSON.parse(start.body!)).toEqual(body);
    const empty = traktRequest(
      readTraktCall({ method: 'POST', path: '/sync/history' })!,
      SECRETS,
      AGENT,
    );
    expect(empty.body).toBe('{}');
  });

  it('builds each OAuth body with the app keys, and no Trakt headers', () => {
    const oauth = (path: string, body?: unknown) => {
      const request = traktRequest(
        readTraktCall({ method: 'POST', path, body, token: 'viewer-token' })!,
        SECRETS,
        AGENT,
      );
      expect(request.method).toBe('POST');
      expect(request.url).toBe(`https://api.trakt.tv${path}`);
      expect(request.headers).toEqual({ 'Content-Type': 'application/json', 'User-Agent': AGENT });
      return JSON.parse(request.body!) as unknown;
    };
    expect(oauth('/oauth/device/code')).toEqual({ client_id: 'client-id' });
    expect(oauth('/oauth/device/token', { code: 'device-code' })).toEqual({
      code: 'device-code',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
    expect(oauth('/oauth/token', { refresh_token: 'refresh' })).toEqual({
      refresh_token: 'refresh',
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'refresh_token',
    });
    expect(oauth('/oauth/revoke', { token: 'access' })).toEqual({
      token: 'access',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
  });
});

describe('readTmdbCall', () => {
  it('accepts every path BannerTV asks for', () => {
    for (const path of [
      'movie/603',
      'tv/1399',
      'tv/1399/season/1',
      'tv/1399/season/0',
      'movie/603/external_ids',
      'tv/1399/external_ids',
    ]) {
      expect(readTmdbCall(path, ''), path).toEqual({ path, query: '' });
    }
    expect(readTmdbCall('find/tt0133093', '?external_source=imdb_id')).toEqual({
      path: 'find/tt0133093',
      query: 'external_source=imdb_id',
    });
  });

  it('refuses other paths, and find without the IMDb source', () => {
    for (const path of [
      '',
      'movie',
      'movie/',
      'movie/abc',
      'movie/603/',
      'movie/603/videos',
      'movie/603/external_ids/x',
      'tv/1399/season/1/episode/1',
      'tv/1399/season/1/images',
      'person/287',
      'search/movie',
      'find/nm0000206',
      'find/603',
      'movie/%36%30%33',
      '3/movie/603',
    ]) {
      expect(readTmdbCall(path, ''), path).toBeUndefined();
    }
    expect(readTmdbCall('find/tt0133093', '')).toBeUndefined();
    expect(readTmdbCall('find/tt0133093', 'external_source=tvdb_id')).toBeUndefined();
  });

  it('keeps the allowed parameters in name order, whatever order they came in', () => {
    const details = readTmdbCall(
      'movie/603',
      '?language=en-GB&include_image_language=en,null&append_to_response=images,credits,release_dates',
    );
    expect(details?.query).toBe(
      'append_to_response=images,credits,release_dates&include_image_language=en,null&language=en-GB',
    );
    expect(
      readTmdbCall(
        'tv/1399',
        'append_to_response=images%2Caggregate_credits%2Ccontent_ratings%2Cexternal_ids',
      )?.query,
    ).toBe('append_to_response=images,aggregate_credits,content_ratings,external_ids');
    expect(readTmdbCall('tv/1399/season/2', 'language=en')?.query).toBe('language=en');
  });

  it('refuses other parameters and values', () => {
    for (const query of [
      'api_key=someone-elses',
      'page=2',
      'query=matrix',
      'append_to_response=videos',
      'append_to_response=images,videos',
      'append_to_response=images,images',
      'append_to_response=',
      'append_to_response=images,',
      'include_image_language=english',
      'include_image_language=en,en',
      'language=EN',
      'language=en-gb',
      'language=en_GB',
      'language=en&language=fr',
    ]) {
      expect(readTmdbCall('movie/603', query), query).toBeUndefined();
    }
  });
});

describe('tmdbRequest', () => {
  const call = readTmdbCall('movie/603', 'language=en-GB')!;

  it('puts a v3 key in the query', () => {
    expect(tmdbRequest(call, 'v3key', AGENT)).toEqual({
      method: 'GET',
      url: 'https://api.themoviedb.org/3/movie/603?language=en-GB&api_key=v3key',
      headers: { Accept: 'application/json', 'User-Agent': AGENT },
    });
    expect(tmdbRequest(readTmdbCall('tv/1399', '')!, 'v3key', AGENT).url).toBe(
      'https://api.themoviedb.org/3/tv/1399?api_key=v3key',
    );
  });

  it('puts a v4 read access token in the Authorization header', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    expect(tmdbRequest(call, token, AGENT)).toEqual({
      method: 'GET',
      url: 'https://api.themoviedb.org/3/movie/603?language=en-GB',
      headers: {
        Accept: 'application/json',
        'User-Agent': AGENT,
        Authorization: `Bearer ${token}`,
      },
    });
  });
});

describe('tmdbCacheKey', () => {
  it('names the call by the Worker address, with the query sorted and no key', () => {
    const one = readTmdbCall('find/tt0133093', 'external_source=imdb_id&language=en')!;
    const other = readTmdbCall('find/tt0133093', 'language=en&external_source=imdb_id')!;
    expect(tmdbCacheKey('https://api.example.workers.dev', one)).toBe(
      'https://api.example.workers.dev/tmdb/find/tt0133093?external_source=imdb_id&language=en',
    );
    expect(tmdbCacheKey('https://x', other)).toBe(tmdbCacheKey('https://x', one));
    expect(tmdbCacheKey('https://x', readTmdbCall('tv/1', '')!)).toBe('https://x/tmdb/tv/1');
  });
});

describe('readRetryAfter', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');

  it('reads seconds and HTTP dates', () => {
    expect(readRetryAfter('10', now)).toBe(10);
    expect(readRetryAfter(' 0 ', now)).toBe(0);
    expect(readRetryAfter('Wed, 28 Oct 2026 12:00:30 GMT', now)).toBe(30);
    expect(readRetryAfter('Wed, 28 Oct 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('gives undefined for nothing or nonsense', () => {
    expect(readRetryAfter(null, now)).toBeUndefined();
    expect(readRetryAfter('', now)).toBeUndefined();
    expect(readRetryAfter('soon', now)).toBeUndefined();
    expect(readRetryAfter('-5', now)).toBeUndefined();
  });
});

describe('traktAnswer', () => {
  it("carries Trakt's status and JSON body", () => {
    const body = '[{"listed_at":"2026-10-01T00:00:00.000Z","movie":{"title":"The Matrix"}}]';
    expect(JSON.parse(traktAnswer(200, body))).toEqual({ status: 200, data: JSON.parse(body) });
    expect(JSON.parse(traktAnswer(201, '\n{"added":{"movies":1}}\n'))).toEqual({
      status: 201,
      data: { added: { movies: 1 } },
    });
  });

  it('gives null data for an empty body or one that is not JSON', () => {
    expect(JSON.parse(traktAnswer(204, ''))).toEqual({ status: 204, data: null });
    expect(JSON.parse(traktAnswer(400, ''))).toEqual({ status: 400, data: null });
    expect(JSON.parse(traktAnswer(502, '<html>Bad gateway</html>'))).toEqual({
      status: 502,
      data: null,
    });
    expect(JSON.parse(traktAnswer(200, '{"a":1}{"b":2}'))).toEqual({ status: 200, data: null });
  });

  it('adds Retry-After when Trakt sent one', () => {
    expect(JSON.parse(traktAnswer(429, '', 12))).toEqual({
      status: 429,
      data: null,
      retryAfter: 12,
    });
  });
});
