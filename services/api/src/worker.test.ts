import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json';
import { MAX_BODY_BYTES, UPSTREAM_TIMEOUT_MS } from './rules';
import worker, { type Context, type Env } from './worker';

const ORIGIN = 'https://api.example.workers.dev';
const V4_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.tmdb-read-token.signature';
const ENV: Env = {
  TRAKT_CLIENT_ID: 'trakt-client-id',
  TRAKT_CLIENT_SECRET: 'trakt-client-secret',
  TMDB_API_KEY: 'tmdb-v3-key',
};
/** What no answer may ever contain. */
const SECRETS = ['trakt-client-id', 'trakt-client-secret', 'tmdb-v3-key', V4_TOKEN, 'viewer-token'];

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

type Reply = (sent: Sent, signal: AbortSignal) => Response | Promise<Response>;

/** Trakt and TMDB in memory: every request is kept in the list, and `reply` answers it. */
function fakeUpstream(reply: Reply): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const request: Sent = {
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    sent.push(request);
    return reply(request, init.signal!);
  });
  return sent;
}

const reply = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } });

function headerList(headers: Headers): Record<string, string> {
  const list: Record<string, string> = {};
  headers.forEach((value, name) => (list[name] = value));
  return list;
}

/** The edge cache in memory, by key address. */
function fakeCache(): Map<string, Response> {
  const entries = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (key: Request) => entries.get(key.url)?.clone(),
      put: async (key: Request, response: Response) => {
        expect(key.method).toBe('GET');
        entries.set(key.url, response);
      },
    },
  });
  return entries;
}

let pending: Promise<unknown>[] = [];
const ctx: Context = { waitUntil: (promise) => void pending.push(promise) };

/**
 * One request to the Worker, with the checks every answer must pass: open
 * to any origin, never sniffed, and never holding a secret or token.
 */
async function call(method: string, path: string, options: { body?: string; env?: Env } = {}) {
  const request = new Request(ORIGIN + path, {
    method,
    body: options.body,
    headers: options.body === undefined ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' },
  });
  const response = await worker.fetch(request, options.env ?? ENV, ctx);
  await Promise.all(pending);
  pending = [];
  const text = await response.text();
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  return {
    status: response.status,
    headers: response.headers,
    text,
    json: () => JSON.parse(text) as unknown,
  };
}

const trakt = (envelope: unknown, env?: Env) =>
  call('POST', '/trakt', { body: JSON.stringify(envelope), env });

const LOGS = ['log', 'info', 'warn', 'error', 'debug'] as const;

beforeEach(() => {
  for (const name of LOGS) vi.spyOn(console, name);
  // No network in tests: a test that needs Trakt or TMDB fakes them.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in tests')));
});

afterEach(() => {
  // Requests carry viewers' tokens, so the Worker writes nothing to the log.
  for (const name of LOGS) expect(console[name]).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('status', () => {
  it('says which services have keys, without showing them', async () => {
    const all = await call('GET', '/status');
    expect(all.status).toBe(200);
    expect(all.json()).toEqual({ trakt: true, tmdb: true });
    expect(all.headers.get('Cache-Control')).toBe('no-store');
    expect(all.headers.get('Content-Type')).toContain('application/json');

    expect((await call('GET', '/status', { env: {} })).json()).toEqual({
      trakt: false,
      tmdb: false,
    });
    // Trakt issues no secret to newer apps, so the client id alone is enough.
    for (const idOnly of [
      { TRAKT_CLIENT_ID: 'trakt-client-id' },
      { TRAKT_CLIENT_ID: 'trakt-client-id', TRAKT_CLIENT_SECRET: ' ' },
    ]) {
      expect((await call('GET', '/status', { env: idOnly })).json()).toEqual({
        trakt: true,
        tmdb: false,
      });
    }
    const secretOnly: Env = { TRAKT_CLIENT_ID: ' ', TRAKT_CLIENT_SECRET: 'trakt-client-secret' };
    expect((await call('GET', '/status', { env: secretOnly })).json()).toEqual({
      trakt: false,
      tmdb: false,
    });
    const tmdbOnly: Env = { TMDB_API_KEY: V4_TOKEN };
    expect((await call('GET', '/status', { env: tmdbOnly })).json()).toEqual({
      trakt: false,
      tmdb: true,
    });
  });
});

describe('preflight', () => {
  it('answers one anyway, though the TV never sends it', async () => {
    const sent = fakeUpstream(() => reply('{}'));
    for (const path of ['/trakt', '/tmdb/movie/603', '/status']) {
      const response = await call('OPTIONS', path);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(sent).toHaveLength(0);
  });
});

describe('trakt', () => {
  it('passes a GET on with the app key and the viewer token, and wraps the answer', async () => {
    const list = [{ listed_at: '2026-10-01T00:00:00.000Z', movie: { ids: { imdb: 'tt0133093' } } }];
    const sent = fakeUpstream(() => reply(JSON.stringify(list), 200, { 'X-Other': '1' }));
    const response = await trakt({
      method: 'GET',
      path: '/sync/watchlist/movies?extended=full',
      token: 'viewer-token',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.trakt.tv/sync/watchlist/movies?extended=full');
    expect(sent[0]!.method).toBe('GET');
    expect(sent[0]!.body).toBeUndefined();
    expect(headerList(sent[0]!.headers)).toEqual({
      'content-type': 'application/json',
      'user-agent': `BannerTV/${pkg.version}`,
      'trakt-api-version': '2',
      'trakt-api-key': 'trakt-client-id',
      authorization: 'Bearer viewer-token',
    });

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({ status: 200, data: list });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('passes a POST body on as JSON', async () => {
    const body = { movie: { ids: { imdb: 'tt0133093' } }, progress: 92.5 };
    const sent = fakeUpstream(() => reply('{"id":1,"action":"scrobble","progress":92.5}', 201));
    const response = await trakt({
      method: 'POST',
      path: '/scrobble/stop',
      token: 'viewer-token',
      body,
    });
    expect(sent[0]!.method).toBe('POST');
    expect(JSON.parse(sent[0]!.body!)).toEqual(body);
    expect(response.json()).toEqual({
      status: 201,
      data: { id: 1, action: 'scrobble', progress: 92.5 },
    });
  });

  it("answers Trakt's refusals with 200, its status inside, and Retry-After", async () => {
    let next: Response = reply('', 401);
    fakeUpstream(() => next);
    expect((await trakt({ method: 'GET', path: '/users/settings' })).json()).toEqual({
      status: 401,
      data: null,
    });

    next = reply('', 429, { 'Retry-After': '30' });
    const limited = await trakt({
      method: 'GET',
      path: '/sync/last_activities',
      token: 'viewer-token',
    });
    expect(limited.status).toBe(200);
    expect(limited.json()).toEqual({ status: 429, data: null, retryAfter: 30 });

    next = new Response('<html>Service unavailable</html>', { status: 503 });
    expect((await trakt({ method: 'GET', path: '/sync/playback' })).json()).toEqual({
      status: 503,
      data: null,
    });
  });

  it('signs in and refreshes with the app keys, which only the Worker adds', async () => {
    let next: Response = reply('{}');
    const sent = fakeUpstream(() => next);
    const asked = () => {
      const request = sent[sent.length - 1]!;
      expect(request.method).toBe('POST');
      expect(request.headers.get('Content-Type')).toBe('application/json');
      expect(request.headers.get('User-Agent')).toBe(`BannerTV/${pkg.version}`);
      expect(request.headers.get('Authorization')).toBeNull();
      expect(request.headers.get('trakt-api-key')).toBeNull();
      return { url: request.url, body: JSON.parse(request.body!) as unknown };
    };

    const code = {
      device_code: 'device-code',
      user_code: '5055CC52',
      verification_url: 'https://trakt.tv/activate',
      expires_in: 600,
      interval: 5,
    };
    next = reply(JSON.stringify(code));
    const started = await trakt({ method: 'POST', path: '/oauth/device/code', body: {} });
    expect(started.json()).toEqual({ status: 200, data: code });
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/device/code',
      body: { client_id: 'trakt-client-id' },
    });

    // Waiting for the viewer: Trakt answers 400 with no body.
    next = reply('', 400);
    const poll = { method: 'POST', path: '/oauth/device/token', body: { code: 'device-code' } };
    expect((await trakt(poll)).json()).toEqual({ status: 400, data: null });
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/device/token',
      body: {
        code: 'device-code',
        client_id: 'trakt-client-id',
        client_secret: 'trakt-client-secret',
      },
    });

    const tokens = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 86400 };
    next = reply(JSON.stringify(tokens));
    expect((await trakt(poll)).json()).toEqual({ status: 200, data: tokens });

    await trakt({
      method: 'POST',
      path: '/oauth/token',
      token: 'viewer-token',
      body: { refresh_token: 'new-refresh', client_id: 'another-app', grant_type: 'password' },
    });
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/token',
      body: {
        refresh_token: 'new-refresh',
        client_id: 'trakt-client-id',
        client_secret: 'trakt-client-secret',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'refresh_token',
      },
    });

    next = reply('', 200);
    const revoked = await trakt({
      method: 'POST',
      path: '/oauth/revoke',
      body: { token: 'new-access' },
    });
    expect(revoked.json()).toEqual({ status: 200, data: null });
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/revoke',
      body: {
        token: 'new-access',
        client_id: 'trakt-client-id',
        client_secret: 'trakt-client-secret',
      },
    });
  });

  it('signs in, refreshes and revokes with the client id alone for an app without a secret', async () => {
    const sent = fakeUpstream(() => reply('{}'));
    const idOnly: Env = { TRAKT_CLIENT_ID: 'trakt-client-id', TMDB_API_KEY: 'tmdb-v3-key' };
    const asked = () => {
      const request = sent[sent.length - 1]!;
      return { url: request.url, body: JSON.parse(request.body!) as unknown };
    };

    expect((await trakt({ method: 'POST', path: '/oauth/device/code' }, idOnly)).status).toBe(200);
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/device/code',
      body: { client_id: 'trakt-client-id' },
    });
    const poll = { method: 'POST', path: '/oauth/device/token', body: { code: 'device-code' } };
    await trakt(poll, { ...idOnly, TRAKT_CLIENT_SECRET: ' ' });
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/device/token',
      body: { code: 'device-code', client_id: 'trakt-client-id' },
    });
    await trakt({ method: 'POST', path: '/oauth/token', body: { refresh_token: 'r' } }, idOnly);
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/token',
      body: {
        refresh_token: 'r',
        client_id: 'trakt-client-id',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'refresh_token',
      },
    });
    await trakt({ method: 'POST', path: '/oauth/revoke', body: { token: 'access' } }, idOnly);
    expect(asked()).toEqual({
      url: 'https://auth.trakt.tv/oauth/revoke',
      body: { token: 'access', client_id: 'trakt-client-id' },
    });

    // Every other call still goes to the API host with the client id as its key.
    await trakt({ method: 'GET', path: '/sync/watchlist', token: 'viewer-token' }, idOnly);
    const listed = sent[sent.length - 1]!;
    expect(listed.url).toBe('https://api.trakt.tv/sync/watchlist');
    expect(listed.headers.get('trakt-api-key')).toBe('trakt-client-id');
    expect(sent).toHaveLength(5);
  });

  it('refuses what it does not pass on, without asking Trakt', async () => {
    const sent = fakeUpstream(() => reply('{}'));
    for (const body of [
      '',
      'not json',
      '{"method":"GET","path":"/sync/watchlist"',
      JSON.stringify({ method: 'GET', path: '/users/me' }),
      JSON.stringify({ method: 'DELETE', path: '/sync/playback/123' }),
      JSON.stringify({ method: 'POST', path: '/sync/watched/movies' }),
      JSON.stringify({ method: 'GET', path: '/sync/watchlist?api_key=x' }),
      JSON.stringify({ method: 'GET', path: '/sync/watchlist', token: 'two words' }),
      JSON.stringify({ method: 'GET', path: '/sync/watchlist', token: 'x'.repeat(4097) }),
      JSON.stringify({ method: 'POST', path: '/oauth/device/token', body: {} }),
    ]) {
      const response = await call('POST', '/trakt', { body });
      expect(response.status, body).toBe(400);
      expect(response.json()).toEqual({ error: 'path' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(sent).toHaveLength(0);
  });

  it('takes a body up to 64 KB and refuses a longer one', async () => {
    const sent = fakeUpstream(() => reply('{}', 201));
    const envelope = (padding: number) =>
      JSON.stringify({
        method: 'POST',
        path: '/sync/history',
        body: { note: 'x'.repeat(padding) },
      });
    const padding = MAX_BODY_BYTES - envelope(0).length;
    expect(envelope(padding)).toHaveLength(MAX_BODY_BYTES);
    expect((await call('POST', '/trakt', { body: envelope(padding) })).json()).toEqual({
      status: 201,
      data: {},
    });
    const long = await call('POST', '/trakt', { body: envelope(padding + 1) });
    expect(long.status).toBe(400);
    expect(sent).toHaveLength(1);

    // A body sent without a length is read only until it passes the limit.
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
    });
    const request = new Request(`${ORIGIN}/trakt`, {
      method: 'POST',
      body: endless,
      duplex: 'half',
    } as RequestInit);
    const response = await worker.fetch(request, ENV, ctx);
    expect(response.status).toBe(400);
    expect(pulls).toBeLessThan(10);
    expect(sent).toHaveLength(1);
  });

  it('answers 503 without a Trakt client id, without asking Trakt', async () => {
    const sent = fakeUpstream(() => reply('{}'));
    for (const env of [
      {},
      { TRAKT_CLIENT_SECRET: 'trakt-client-secret', TMDB_API_KEY: 'tmdb-v3-key' },
      { ...ENV, TRAKT_CLIENT_ID: '' },
      { ...ENV, TRAKT_CLIENT_ID: ' ' },
    ]) {
      const response = await trakt({ method: 'GET', path: '/sync/watchlist' }, env);
      expect(response.status).toBe(503);
      expect(response.json()).toEqual({ error: 'unconfigured' });
    }
    expect(sent).toHaveLength(0);
  });

  it('answers 502 when Trakt cannot be reached, saying nothing more', async () => {
    fakeUpstream(() => {
      throw new TypeError('fetch failed for https://api.trakt.tv with viewer-token');
    });
    const response = await trakt({ method: 'GET', path: '/sync/watchlist', token: 'viewer-token' });
    expect(response.status).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream' });
  });

  it('gives up on Trakt after 30 seconds, while waiting or while reading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const aborted = (signal: AbortSignal) =>
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    let replyWith: Reply = (_, signal) => aborted(signal);
    // The clock moves only once the Worker has asked, so its timer is already set.
    let asked = () => undefined as void;
    const ask = () => new Promise<void>((resolve) => (asked = resolve));
    fakeUpstream((sent, signal) => {
      asked();
      return replyWith(sent, signal);
    });

    let wasAsked = ask();
    let settled = false;
    const waiting = trakt({ method: 'GET', path: '/sync/watchlist' }).finally(() => {
      settled = true;
    });
    await wasAsked;
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await waiting).status).toBe(502);

    // Headers at once, then a body that never ends.
    replyWith = (_, signal) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('[{"movie":'));
            signal.addEventListener('abort', () => controller.error(signal.reason));
          },
        }),
        { status: 200 },
      );
    wasAsked = ask();
    const reading = trakt({ method: 'GET', path: '/sync/watchlist' });
    await wasAsked;
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
    expect((await reading).status).toBe(502);
  });
});

describe('tmdb', () => {
  const MOVIE = '{"id":603,"title":"The Matrix","images":{"logos":[]}}';

  it('adds the key, and caches the answer for a day under an address without it', async () => {
    const cache = fakeCache();
    const sent = fakeUpstream(() => reply(MOVIE));
    const first = await call(
      'GET',
      '/tmdb/movie/603?language=en-GB&include_image_language=en,null&append_to_response=images,credits',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(
      'https://api.themoviedb.org/3/movie/603?append_to_response=images,credits&include_image_language=en,null&language=en-GB&api_key=tmdb-v3-key',
    );
    expect(sent[0]!.headers.get('Authorization')).toBeNull();
    expect(first.status).toBe(200);
    expect(first.text).toBe(MOVIE);
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(first.headers.get('Content-Type')).toBe('application/json; charset=utf-8');

    const key = `${ORIGIN}/tmdb/movie/603?append_to_response=images,credits&include_image_language=en,null&language=en-GB`;
    expect(Array.from(cache.keys())).toEqual([key]);
    expect(cache.get(key)!.headers.get('Cache-Control')).toBe('public, max-age=86400');

    // The same call with its parameters in another order comes from the cache.
    const again = await call(
      'GET',
      '/tmdb/movie/603?append_to_response=images,credits&language=en-GB&include_image_language=en,null',
    );
    expect(sent).toHaveLength(1);
    expect(again.status).toBe(200);
    expect(again.text).toBe(MOVIE);
    expect(again.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(again.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('finds a title by its IMDb id', async () => {
    fakeCache();
    const found = '{"movie_results":[{"id":603}],"tv_results":[]}';
    const sent = fakeUpstream(() => reply(found));
    const response = await call('GET', '/tmdb/find/tt0133093?external_source=imdb_id');
    expect(sent[0]!.url).toBe(
      'https://api.themoviedb.org/3/find/tt0133093?external_source=imdb_id&api_key=tmdb-v3-key',
    );
    expect(response.text).toBe(found);
  });

  it('sends a v4 read access token as a bearer token', async () => {
    const cache = fakeCache();
    const sent = fakeUpstream(() => reply('{"id":1399,"season_number":1,"episodes":[]}'));
    const env = { TMDB_API_KEY: V4_TOKEN };
    const response = await call('GET', '/tmdb/tv/1399/season/1?language=en-GB', { env });
    expect(response.status).toBe(200);
    expect(sent[0]!.url).toBe('https://api.themoviedb.org/3/tv/1399/season/1?language=en-GB');
    expect(sent[0]!.headers.get('Authorization')).toBe(`Bearer ${V4_TOKEN}`);
    expect(sent[0]!.headers.get('User-Agent')).toBe(`BannerTV/${pkg.version}`);
    expect(Array.from(cache.keys())).toEqual([`${ORIGIN}/tmdb/tv/1399/season/1?language=en-GB`]);
  });

  it("passes TMDB's errors on as they are, and does not cache them", async () => {
    const cache = fakeCache();
    const missing = '{"success":false,"status_code":34,"status_message":"Not found."}';
    const sent = fakeUpstream(() => reply(missing, 404));
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await call('GET', '/tmdb/movie/999999999');
      expect(response.status).toBe(404);
      expect(response.text).toBe(missing);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(sent).toHaveLength(2);
    expect(cache.size).toBe(0);
  });

  it('refuses paths and parameters off the list, without asking TMDB', async () => {
    fakeCache();
    const sent = fakeUpstream(() => reply('{}'));
    for (const path of [
      '/tmdb/search/movie?query=matrix',
      '/tmdb/movie/603?api_key=someone-elses',
      '/tmdb/movie/603?append_to_response=videos',
      '/tmdb/movie/603/videos',
      '/tmdb/person/6384',
      '/tmdb/find/tt0133093',
      '/tmdb/find/tt0133093?external_source=tvdb_id',
      '/tmdb/tv/1399/season/1/episode/1',
      '/tmdb/',
    ]) {
      const response = await call('GET', path);
      expect(response.status, path).toBe(400);
      expect(response.json()).toEqual({ error: 'path' });
    }
    expect(sent).toHaveLength(0);
  });

  it('answers 503 without a key, and 502 when TMDB fails or answers nonsense', async () => {
    const cache = fakeCache();
    let next: () => Response = () => reply('{}');
    const sent = fakeUpstream(() => next());

    const unconfigured = await call('GET', '/tmdb/movie/603', { env: { TMDB_API_KEY: ' ' } });
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.json()).toEqual({ error: 'unconfigured' });
    expect(sent).toHaveLength(0);

    next = () => {
      throw new TypeError(
        'fetch failed for https://api.themoviedb.org/3/movie/603?api_key=tmdb-v3-key',
      );
    };
    const unreachable = await call('GET', '/tmdb/movie/603');
    expect(unreachable.status).toBe(502);
    expect(unreachable.json()).toEqual({ error: 'upstream' });

    next = () => new Response('<html>Bad gateway</html>', { status: 200 });
    expect((await call('GET', '/tmdb/movie/603')).status).toBe(502);
    expect(cache.size).toBe(0);
  });

  it('carries on without the cache when the cache fails or is missing', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: () => Promise.reject(new Error('cache down')),
        put: () => Promise.reject(new Error('cache down')),
      },
    });
    const sent = fakeUpstream(() => reply(MOVIE));
    expect((await call('GET', '/tmdb/movie/603')).text).toBe(MOVIE);
    vi.stubGlobal('caches', undefined);
    expect((await call('GET', '/tmdb/movie/603')).text).toBe(MOVIE);
    expect(sent).toHaveLength(2);
  });
});

describe('routes', () => {
  it('answers 404 for anything else', async () => {
    const sent = fakeUpstream(() => reply('{}'));
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/trakt'],
      ['POST', '/status'],
      ['GET', '/status/'],
      ['PUT', '/status'],
      ['POST', '/tmdb/movie/603'],
      ['GET', '/tmdb'],
      ['GET', '/3/movie/603'],
    ] as const) {
      const response = await call(method, path);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.json()).toEqual({ error: 'not-found' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(sent).toHaveLength(0);
  });
});
