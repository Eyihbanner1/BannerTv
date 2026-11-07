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
    expect(all.json()).toEqual({ trakt: true, tmdb: true, search: true });
    expect(all.headers.get('Cache-Control')).toBe('no-store');
    expect(all.headers.get('Content-Type')).toContain('application/json');

    expect((await call('GET', '/status', { env: {} })).json()).toEqual({
      trakt: false,
      tmdb: false,
      search: false,
    });
    // Trakt issues no secret to newer apps, so the client id alone is enough.
    for (const idOnly of [
      { TRAKT_CLIENT_ID: 'trakt-client-id' },
      { TRAKT_CLIENT_ID: 'trakt-client-id', TRAKT_CLIENT_SECRET: ' ' },
    ]) {
      expect((await call('GET', '/status', { env: idOnly })).json()).toEqual({
        trakt: true,
        tmdb: false,
        search: false,
      });
    }
    const secretOnly: Env = { TRAKT_CLIENT_ID: ' ', TRAKT_CLIENT_SECRET: 'trakt-client-secret' };
    expect((await call('GET', '/status', { env: secretOnly })).json()).toEqual({
      trakt: false,
      tmdb: false,
      search: false,
    });
    const tmdbOnly: Env = { TMDB_API_KEY: V4_TOKEN };
    expect((await call('GET', '/status', { env: tmdbOnly })).json()).toEqual({
      trakt: false,
      tmdb: true,
      search: true,
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

  it('removes one paused item with a DELETE that carries no body', async () => {
    // Trakt answers a removal with 204 and no body at all.
    const sent = fakeUpstream(() => new Response(null, { status: 204 }));
    const response = await trakt({
      method: 'DELETE',
      path: '/sync/playback/13',
      token: 'viewer-token',
    });
    expect(response.json()).toEqual({ status: 204, data: null });
    expect(sent).toHaveLength(1);
    const request = sent[0]!;
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe('https://api.trakt.tv/sync/playback/13');
    expect(request.headers.get('Authorization')).toBe('Bearer viewer-token');
    expect(request.body).toBeUndefined();
  });

  it('refuses what it does not pass on, without asking Trakt', async () => {
    const sent = fakeUpstream(() => reply('{}'));
    for (const body of [
      '',
      'not json',
      '{"method":"GET","path":"/sync/watchlist"',
      JSON.stringify({ method: 'GET', path: '/users/me' }),
      JSON.stringify({ method: 'DELETE', path: '/sync/playback/abc' }),
      JSON.stringify({ method: 'DELETE', path: '/sync/playback/123?limit=1' }),
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

describe('search', () => {
  /** A fake TMDB for Search: answers by path, and records each call's path and query. */
  function fakeTmdb(answers: Record<string, unknown | ((query: URLSearchParams) => unknown)>) {
    const asked: { path: string; query: URLSearchParams }[] = [];
    const sent = fakeUpstream((request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/3\//, '');
      url.searchParams.delete('api_key');
      asked.push({ path, query: url.searchParams });
      const answer = answers[path];
      if (answer === undefined) return reply('{"status_code":34}', 404);
      if (answer instanceof Response) return answer;
      const body = typeof answer === 'function' ? answer(url.searchParams) : answer;
      return reply(JSON.stringify(body));
    });
    return { asked, sent };
  }

  const tv = (id: number, name: string) => ({
    id,
    name,
    first_air_date: '2020-01-01',
    genre_ids: [16],
  });

  const listed = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    release_date: '1999-03-31',
    poster_path: `/p${id}.jpg`,
    genre_ids: [35],
    ...extra,
  });

  it('answers a discover row with titles by IMDb id, asking TMDB with the adult filter off', async () => {
    const cache = fakeCache();
    const { asked } = fakeTmdb({
      'discover/movie': {
        results: [listed(1, 'Kill Tony'), listed(2, 'No IMDb'), listed(3, 'Gone')],
      },
      'movie/1/external_ids': { id: 1, imdb_id: 'tt0000001' },
      'movie/2/external_ids': { id: 2, imdb_id: null },
    });
    const response = await call(
      'GET',
      '/search/discover?type=movie&keywords=9716,356038&genres=35&from=1990&to=1999',
    );
    expect(response.status).toBe(200);
    expect(response.json()).toEqual({
      titles: [
        {
          id: 'tt0000001',
          type: 'movie',
          name: 'Kill Tony',
          year: '1999',
          poster: '/p1.jpg',
          genres: ['Comedy'],
        },
      ],
    });
    const discover = asked[0]!;
    expect(discover.path).toBe('discover/movie');
    expect(Object.fromEntries(discover.query)).toEqual({
      include_adult: 'false',
      include_video: 'false',
      language: 'en-GB',
      page: '1',
      with_genres: '35',
      with_keywords: '9716|356038',
      'primary_release_date.gte': '1990-01-01',
      'primary_release_date.lte': '1999-12-31',
      sort_by: 'popularity.desc',
    });
    // One TMDB call a title for its IMDb id; a title TMDB has no IMDb id for is left out.
    expect(asked.map((entry) => entry.path)).toEqual([
      'discover/movie',
      'movie/1/external_ids',
      'movie/2/external_ids',
      'movie/3/external_ids',
    ]);
    // Movie 3 was not found: an answer, so the whole is cached for a day.
    expect(Array.from(cache.keys())).toEqual([
      `${ORIGIN}/search/discover?from=1990&genres=35&keywords=9716%2C356038&to=1999&type=movie`,
    ]);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('asks series by first air date, the newest first with a following, never after today', async () => {
    fakeCache();
    vi.useFakeTimers({ now: Date.parse('2026-11-06T12:00:00Z'), toFake: ['Date'] });
    const { asked } = fakeTmdb({ 'discover/tv': { results: [] } });
    const response = await call(
      'GET',
      '/search/discover?type=series&language=ko&newest=1&any=10751,10762',
    );
    expect(response.json()).toEqual({ titles: [] });
    expect(Object.fromEntries(asked[0]!.query)).toEqual({
      include_adult: 'false',
      language: 'en-GB',
      page: '1',
      with_genres: '10751|10762',
      with_original_language: 'ko',
      'first_air_date.lte': '2026-11-06',
      sort_by: 'first_air_date.desc',
      'vote_count.gte': '20',
    });
  });

  it("limits a kids profile's films by UK certificate, and reads every title's ratings", async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'discover/movie': { results: [listed(5, 'Paddington', { genre_ids: [10751, 35] })] },
      'movie/5': {
        id: 5,
        genres: [
          { id: 10751, name: 'Family' },
          { id: 35, name: 'Comedy' },
        ],
        external_ids: { imdb_id: 'tt1109624' },
        release_dates: {
          results: [
            {
              iso_3166_1: 'GB',
              release_dates: [
                { certification: 'PG', type: 3 },
                { certification: '', type: 4 },
              ],
            },
            { iso_3166_1: 'US', release_dates: [{ certification: 'PG', type: 3 }] },
            { iso_3166_1: 'FR', release_dates: [{ certification: 'U', type: 3 }] },
          ],
        },
      },
    });
    const response = await call(
      'GET',
      '/search/discover?type=movie&genres=35&any=10751&certification=PG',
    );
    expect(Object.fromEntries(asked[0]!.query)).toMatchObject({
      with_genres: '35,10751',
      certification_country: 'GB',
      'certification.lte': 'PG',
    });
    expect(asked[1]!.path).toBe('movie/5');
    expect(asked[1]!.query.get('append_to_response')).toBe('external_ids,release_dates');
    expect(response.json()).toEqual({
      titles: [
        {
          id: 'tt1109624',
          type: 'movie',
          name: 'Paddington',
          year: '1999',
          poster: '/p5.jpg',
          genres: ['Family', 'Comedy'],
          certificates: { GB: ['PG'], US: ['PG'] },
        },
      ],
    });
  });

  it("reads a series' UK and US ratings, which TMDB's discover cannot filter by", async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'discover/tv': {
        results: [{ id: 7, name: 'Bluey', first_air_date: '2018-10-01', genre_ids: [16] }],
      },
      'tv/7': {
        id: 7,
        genres: [{ id: 10762, name: 'Kids' }],
        external_ids: { imdb_id: 'tt7678620' },
        content_ratings: {
          results: [
            { iso_3166_1: 'GB', rating: 'U' },
            { iso_3166_1: 'US', rating: 'TV-Y' },
          ],
        },
      },
    });
    const response = await call(
      'GET',
      '/search/discover?type=series&any=10751,10762&certification=U',
    );
    expect(asked[0]!.query.get('certification.lte')).toBeNull();
    expect(asked[1]!.query.get('append_to_response')).toBe('external_ids,content_ratings');
    expect(response.json()).toEqual({
      titles: [
        {
          id: 'tt7678620',
          type: 'series',
          name: 'Bluey',
          year: '2018',
          genres: ['Kids'],
          certificates: { GB: ['U'], US: ['TV-Y'] },
        },
      ],
    });
  });

  it('suggests people and titles for the words, without asking anything more', async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'search/multi': {
        results: [
          {
            media_type: 'person',
            id: 31,
            name: 'Tom Hanks',
            known_for_department: 'Acting',
            profile_path: '/hanks.jpg',
            known_for: [
              { media_type: 'movie', id: 13, title: 'Forrest Gump' },
              { media_type: 'tv', id: 4613, name: 'Band of Brothers' },
            ],
          },
          { media_type: 'movie', id: 13, title: 'Forrest Gump', release_date: '1994-06-23' },
          { media_type: 'tv', id: 1, name: 'Tom and Jerry', first_air_date: '1965' },
          { media_type: 'movie', id: 99, title: 'Hidden', adult: true },
        ],
      },
    });
    const response = await call('GET', '/search/multi?query=%20Tom%20%20HANKS%20');
    expect(asked).toHaveLength(1);
    expect(Object.fromEntries(asked[0]!.query)).toEqual({
      include_adult: 'false',
      language: 'en-GB',
      page: '1',
      query: 'tom hanks',
    });
    expect(response.json()).toEqual({
      people: [
        {
          id: 31,
          name: 'Tom Hanks',
          department: 'Acting',
          photo: '/hanks.jpg',
          knownFor: ['Forrest Gump', 'Band of Brothers'],
        },
      ],
      titles: [
        { name: 'Forrest Gump', type: 'movie', year: '1994' },
        { name: 'Tom and Jerry', type: 'series', year: '1965' },
      ],
    });
  });

  it("answers a person's best-known work, without talk shows or guest spots", async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'person/525/combined_credits': {
        cast: [
          {
            media_type: 'tv',
            id: 22,
            name: 'The Tonight Show',
            genre_ids: [10767],
            vote_count: 900,
          },
          { media_type: 'movie', id: 23, title: 'Cameo', character: 'Himself', vote_count: 800 },
        ],
        crew: [
          {
            media_type: 'movie',
            id: 27205,
            title: 'Inception',
            job: 'Director',
            vote_count: 30000,
          },
          { media_type: 'movie', id: 27205, title: 'Inception', job: 'Writer', vote_count: 30000 },
          {
            media_type: 'movie',
            id: 155,
            title: 'The Dark Knight',
            job: 'Director',
            vote_count: 40000,
          },
          { media_type: 'movie', id: 1, title: 'Producing', job: 'Producer', vote_count: 50000 },
        ],
      },
      'movie/155/external_ids': { imdb_id: 'tt0468569' },
      'movie/27205/external_ids': { imdb_id: 'tt1375666' },
    });
    const response = await call('GET', '/search/person?id=525&role=directing');
    expect(asked.map((entry) => entry.path)).toEqual([
      'person/525/combined_credits',
      'movie/155/external_ids',
      'movie/27205/external_ids',
    ]);
    expect(response.json()).toEqual({
      titles: [
        { id: 'tt0468569', type: 'movie', name: 'The Dark Knight', genres: [] },
        { id: 'tt1375666', type: 'movie', name: 'Inception', genres: [] },
      ],
    });
  });

  it('answers titles like one it finds by name, saying which it found', async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'search/movie': { results: [listed(603, 'The Matrix')] },
      'movie/603/recommendations': { results: [listed(604, 'The Matrix Reloaded')] },
      'movie/604/external_ids': { imdb_id: 'tt0234215' },
    });
    const response = await call('GET', '/search/like?query=The%20Matrix&type=movie');
    expect(asked[0]!.query.get('query')).toBe('the matrix');
    expect(response.json()).toEqual({
      like: { name: 'The Matrix', type: 'movie', year: '1999' },
      titles: [
        {
          id: 'tt0234215',
          type: 'movie',
          name: 'The Matrix Reloaded',
          year: '1999',
          poster: '/p604.jpg',
          genres: ['Comedy'],
        },
      ],
    });
    // Without a type, the first film or series found by any name.
    const any = fakeTmdb({
      'search/multi': { results: [{ media_type: 'person', id: 1, name: 'Neo' }] },
    });
    expect((await call('GET', '/search/like?query=neo')).json()).toEqual({ titles: [] });
    expect(any.asked.map((entry) => entry.path)).toEqual(['search/multi']);
  });

  it('finds titles by name for a kids profile, with their ratings', async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'search/multi': {
        results: [
          { media_type: 'movie', id: 9, title: 'Frozen', release_date: '2013-11-20' },
          { media_type: 'person', id: 1, name: 'Frozen Person' },
        ],
      },
      'movie/9': {
        genres: [{ name: 'Animation' }, { name: 'Family' }],
        external_ids: { imdb_id: 'tt2294629' },
        release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ certification: 'U' }] }] },
      },
    });
    const response = await call('GET', '/search/titles?query=frozen&ratings=1');
    expect(asked.map((entry) => entry.path)).toEqual(['search/multi', 'movie/9']);
    expect(response.json()).toEqual({
      titles: [
        {
          id: 'tt2294629',
          type: 'movie',
          name: 'Frozen',
          year: '2013',
          genres: ['Animation', 'Family'],
          certificates: { GB: ['U'], US: [] },
        },
      ],
    });
  });

  it('asks for at most twenty titles, six at a time', async () => {
    fakeCache();
    let open = 0;
    let most = 0;
    const many = Array.from({ length: 25 }, (_, index) => listed(index + 1, `Title ${index + 1}`));
    const sent = fakeUpstream(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/3/discover/movie') return reply(JSON.stringify({ results: many }));
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 1));
      open -= 1;
      const id = /movie\/(\d+)\//.exec(path)![1]!;
      return reply(JSON.stringify({ imdb_id: `tt${id.padStart(7, '0')}` }));
    });
    const response = await call('GET', '/search/discover?type=movie&genres=35');
    expect(sent).toHaveLength(21);
    expect(most).toBeLessThanOrEqual(6);
    expect((response.json() as { titles: unknown[] }).titles).toHaveLength(20);
  });

  it('asks once for each of several "one of" genres beside needed ones, and merges the lists', async () => {
    fakeCache();
    const { asked } = fakeTmdb({
      'discover/tv': (query: URLSearchParams) =>
        query.get('with_genres') === '16,10751'
          ? { results: [tv(1, 'Family toon'), tv(2, 'Both')] }
          : { results: [tv(3, 'Kids toon'), tv(2, 'Both')] },
      'tv/1/external_ids': { imdb_id: 'tt0000001' },
      'tv/2/external_ids': { imdb_id: 'tt0000002' },
      'tv/3/external_ids': { imdb_id: 'tt0000003' },
    });
    const response = await call('GET', '/search/discover?type=series&genres=16&any=10751,10762');
    // Animation and Family, then Animation and Kids: TMDB cannot be asked both in one.
    expect(
      asked
        .filter((entry) => entry.path === 'discover/tv')
        .map((entry) => entry.query.get('with_genres')),
    ).toEqual(['16,10751', '16,10762']);
    // Each title once, taking from each list in turn.
    expect(
      (response.json() as { titles: { name: string }[] }).titles.map((title) => title.name),
    ).toEqual(['Family toon', 'Kids toon', 'Both']);

    // A needed genre that is one of them already: one call, as before.
    const again = fakeTmdb({ 'discover/tv': { results: [] } });
    await call('GET', '/search/discover?type=series&genres=10762&any=10751,10762');
    expect(again.asked.map((entry) => entry.query.get('with_genres'))).toEqual(['10762']);
  });

  it('keeps an answer TMDB only partly gave out of the cache, and answers 502 when it gives none', async () => {
    const cache = fakeCache();
    fakeTmdb({
      'discover/movie': { results: [listed(1, 'One'), listed(2, 'Two')] },
      'movie/1/external_ids': { imdb_id: 'tt0000001' },
      'movie/2/external_ids': reply('{"status_code":25}', 429),
    });
    const partial = await call('GET', '/search/discover?type=movie&genres=35');
    // The body says so too, as the app cannot read the header through its fetch.
    expect(partial.json()).toEqual({
      titles: [expect.objectContaining({ id: 'tt0000001' })],
      partial: true,
    });
    expect(partial.headers.get('Cache-Control')).toBe('no-store');
    expect(cache.size).toBe(0);

    fakeTmdb({ 'discover/movie': reply('{"status_code":7}', 401) });
    const failed = await call('GET', '/search/discover?type=movie&genres=35');
    expect(failed.status).toBe(502);
    expect(failed.json()).toEqual({ error: 'upstream' });
    expect(cache.size).toBe(0);
  });

  it('refuses anything it does not answer, without asking TMDB', async () => {
    fakeCache();
    const sent = fakeUpstream(() => reply('{}'));
    for (const path of [
      '/search/discover',
      '/search/discover?type=episode',
      '/search/discover?type=movie&genres=35&genres=27',
      '/search/discover?type=movie&genres=35,35',
      '/search/discover?type=movie&genres=1,2,3,4,5,6',
      '/search/discover?type=movie&genres=action',
      '/search/discover?type=movie&keywords=9716|356038',
      '/search/discover?type=movie&language=KO',
      '/search/discover?type=movie&country=gb',
      '/search/discover?type=movie&from=1899',
      '/search/discover?type=movie&from=2000&to=1990',
      '/search/discover?type=movie&newest=yes',
      '/search/discover?type=movie&certification=15',
      '/search/discover?type=movie&sort_by=revenue.desc',
      '/search/discover?type=movie&include_adult=true',
      '/search/multi',
      '/search/multi?query=',
      '/search/multi?query=%20%20',
      `/search/multi?query=${'a'.repeat(101)}`,
      '/search/multi?query=a%00b',
      '/search/multi?query=dune&include_adult=true',
      '/search/person?id=abc',
      '/search/person?id=1&role=producer',
      '/search/person?id=1&ratings=yes',
      '/search/like?type=movie',
      '/search/like?query=dune&type=anime',
      '/search/titles?query=dune&page=2',
      '/search/trending',
      '/search/',
    ]) {
      const response = await call('GET', path);
      expect(response.status, path).toBe(400);
      expect(response.json()).toEqual({ error: 'path' });
    }
    expect(sent).toHaveLength(0);
  });

  it('answers 503 without a TMDB key, and comes from the cache the second time', async () => {
    fakeCache();
    const none = await call('GET', '/search/multi?query=dune', { env: {} });
    expect(none.status).toBe(503);
    expect(none.json()).toEqual({ error: 'unconfigured' });
    const { asked } = fakeTmdb({ 'search/multi': { results: [] } });
    await call('GET', '/search/multi?query=Dune');
    const again = await call('GET', '/search/multi?query=dune');
    expect(asked).toHaveLength(1);
    expect(again.json()).toEqual({ people: [], titles: [] });
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
