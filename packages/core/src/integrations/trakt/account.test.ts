import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../../storage';
import { createTraktAccount, TRAKT_REFRESH_BEFORE_MS } from './account';
import { TraktError, type TraktRequest, type TraktResponse, type TraktSend } from './transport';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Trakt's token answer, as /oauth/device/token and /oauth/token give it. */
function tokenAnswer(n: number, expiresIn = 86400) {
  return {
    access_token: `access-${n}`,
    token_type: 'bearer',
    expires_in: expiresIn,
    refresh_token: `refresh-${n}`,
    scope: 'public',
    created_at: Math.floor(NOW / 1000),
  };
}

const SETTINGS = {
  user: {
    username: 'sean',
    private: false,
    name: 'Sean Rudford',
    vip: false,
    vip_ep: false,
    ids: { slug: 'sean', uuid: 'b6589fc6ab0dc82cf12099d1c2d40ab994e8410c' },
    joined_at: '2010-09-25T17:49:25.000Z',
  },
  account: { timezone: 'Europe/London', date_format: 'dmy', time_24hr: true },
  connections: { facebook: false, twitter: false, google: false },
  sharing_text: { watching: "I'm watching [item]", watched: 'I just watched [item]' },
};

type Handler = (request: TraktRequest) => TraktResponse | Promise<TraktResponse>;

const ok = (data: unknown, status = 200): TraktResponse => ({ status, data });

/**
 * A transport to a fake Trakt that records every request. The username
 * lookup that follows a sign-in goes to `settings`.
 */
function fakeTrakt(handler: Handler, settings: Handler = () => ok(SETTINGS)) {
  const requests: TraktRequest[] = [];
  const send: TraktSend = (request) => {
    requests.push(request);
    return Promise.resolve().then(() =>
      request.path === '/users/settings' ? settings(request) : handler(request),
    );
  };
  return { send, requests };
}

/** Answers token refreshes with access-2, access-3 and so on, and everything else with `rest`. */
function refreshingTrakt(rest: Handler = () => ok({})) {
  let next = 2;
  return fakeTrakt((request) =>
    request.path === '/oauth/token' ? ok(tokenAnswer(next++)) : rest(request),
  );
}

const SEAN = { status: 'signedIn', username: 'sean' };

function setup(trakt: { send: TraktSend }, storage = memoryKeyValueStore()) {
  const clock = { now: NOW };
  const account = createTraktAccount({ storage, send: trakt.send, now: () => clock.now });
  return { account, storage, clock };
}

async function signedIn(trakt: { send: TraktSend }, expiresIn?: number) {
  const parts = setup(trakt);
  await parts.account.signIn(tokenAnswer(1, expiresIn));
  return parts;
}

function paths(requests: readonly TraktRequest[]) {
  return requests.map((request) => `${request.method} ${request.path} ${request.token ?? '-'}`);
}

async function failure(promise: Promise<unknown>): Promise<TraktError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TraktError) return error;
    throw error;
  }
  throw new Error('did not reject');
}

describe('createTraktAccount', () => {
  it('is loading until the saved sign-in is read, then signed out when there is none', async () => {
    const { account } = setup(fakeTrakt(() => ok({})));
    expect(account.get()).toEqual({ status: 'loading' });
    const seen: unknown[] = [];
    account.subscribe(() => seen.push(account.get()));
    await account.load();
    expect(account.get()).toEqual({ status: 'signedOut' });
    // Screens hear that loading is over even though nothing was saved.
    expect(seen).toEqual([{ status: 'signedOut' }]);
  });

  it('keeps the tokens from a sign-in, then asks Trakt for the username', async () => {
    const trakt = fakeTrakt(() => ok({}));
    const { account, storage } = setup(trakt);
    await account.load();
    const seen: unknown[] = [];
    account.subscribe(() => seen.push(account.get()));

    await account.signIn(tokenAnswer(1));

    expect(account.get()).toEqual(SEAN);
    expect(seen).toEqual([{ status: 'signedIn' }, SEAN]);
    expect(paths(trakt.requests)).toEqual(['GET /users/settings access-1']);
    expect(await storage.get('trakt')).toEqual({
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: NOW + DAY },
      username: 'sean',
    });
  });

  it('stays signed in without a username when Trakt cannot say it', async () => {
    const offline = () => Promise.reject(new TraktError('network', 'offline'));
    expect((await signedIn(fakeTrakt(offline, offline))).account.get()).toEqual({
      status: 'signedIn',
    });
    const refused = () => ok({ error: 'forbidden' }, 403);
    expect((await signedIn(fakeTrakt(refused, refused))).account.get()).toEqual({
      status: 'signedIn',
    });
    const odd = () => ok({ user: { username: 42 } });
    expect((await signedIn(fakeTrakt(odd, odd))).account.get()).toEqual({ status: 'signedIn' });
  });

  it('turns down a token answer it cannot read', async () => {
    const trakt = fakeTrakt(() => ok({}));
    const { account } = setup(trakt);
    await account.load();
    for (const answer of [
      null,
      { access_token: 'access-1', expires_in: 86400 },
      { ...tokenAnswer(1), expires_in: '86400' },
      { ...tokenAnswer(1), access_token: '' },
    ]) {
      expect((await failure(account.signIn(answer))).kind).toBe('other');
    }
    expect(account.get()).toEqual({ status: 'signedOut' });
    expect(trakt.requests).toEqual([]);
  });

  it('reads a saved sign-in back, and leaves out one it cannot use', async () => {
    const trakt = fakeTrakt(() => ok({}));
    const { storage } = await signedIn(trakt);
    const again = setup(trakt, storage).account;
    await again.load();
    expect(again.get()).toEqual(SEAN);

    await storage.set('trakt', {
      tokens: { accessToken: 'access-1', expiresAt: NOW },
      username: 'x',
    });
    const broken = setup(trakt, storage).account;
    await broken.load();
    expect(broken.get()).toEqual({ status: 'signedOut' });
  });

  it("calls with the profile's token and passes Trakt's answer on", async () => {
    const trakt = fakeTrakt((request) =>
      request.path === '/sync/last_activities' ? ok({ all: '2026-10-27T20:15:04.000Z' }) : ok({}),
    );
    const { account } = await signedIn(trakt);
    trakt.requests.length = 0;

    expect(await account.call('GET', '/sync/last_activities')).toEqual({
      status: 200,
      data: { all: '2026-10-27T20:15:04.000Z' },
    });
    await account.call('POST', '/scrobble/start', { progress: 1 });
    expect(trakt.requests).toEqual([
      { method: 'GET', path: '/sync/last_activities', token: 'access-1' },
      { method: 'POST', path: '/scrobble/start', token: 'access-1', body: { progress: 1 } },
    ]);
  });

  it('refreshes first when the token runs out within the hour', async () => {
    const trakt = refreshingTrakt();
    const { account, clock, storage } = await signedIn(trakt);
    trakt.requests.length = 0;
    clock.now = NOW + DAY - TRAKT_REFRESH_BEFORE_MS + 1;

    await account.call('GET', '/sync/playback?extended=full');

    expect(trakt.requests).toEqual([
      { method: 'POST', path: '/oauth/token', body: { refresh_token: 'refresh-1' } },
      { method: 'GET', path: '/sync/playback?extended=full', token: 'access-2' },
    ]);
    expect(await storage.get('trakt')).toEqual({
      tokens: { accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: clock.now + DAY },
      username: 'sean',
    });
    expect(account.get()).toEqual(SEAN);
  });

  it('does not refresh a token with more than an hour left', async () => {
    const trakt = refreshingTrakt();
    const { account, clock } = await signedIn(trakt);
    trakt.requests.length = 0;
    clock.now = NOW + DAY - TRAKT_REFRESH_BEFORE_MS - 1;
    await account.call('GET', '/sync/last_activities');
    expect(paths(trakt.requests)).toEqual(['GET /sync/last_activities access-1']);
  });

  it('shares one refresh between calls made at once', async () => {
    const refreshed = deferred<TraktResponse>();
    const trakt = fakeTrakt((request) =>
      request.path === '/oauth/token' ? refreshed.promise : ok({}),
    );
    const { account, clock } = await signedIn(trakt);
    trakt.requests.length = 0;
    clock.now = NOW + DAY - 60 * 1000;

    const calls = [
      account.call('GET', '/sync/watched/movies'),
      account.call('GET', '/sync/watched/shows?extended=full'),
      account.call('POST', '/scrobble/pause', { progress: 50 }),
    ];
    await Promise.resolve();
    refreshed.resolve(ok(tokenAnswer(2)));
    await Promise.all(calls);

    expect(paths(trakt.requests)).toEqual([
      'POST /oauth/token -',
      'GET /sync/watched/movies access-2',
      'GET /sync/watched/shows?extended=full access-2',
      'POST /scrobble/pause access-2',
    ]);
  });

  it('refreshes once after a 401 and asks again', async () => {
    const trakt = refreshingTrakt((request) =>
      request.token === 'access-1' ? ok({ error: 'invalid_token' }, 401) : ok([]),
    );
    const { account } = await signedIn(trakt);
    trakt.requests.length = 0;

    expect(await account.call('GET', '/sync/watchlist/movies')).toEqual({ status: 200, data: [] });
    expect(paths(trakt.requests)).toEqual([
      'GET /sync/watchlist/movies access-1',
      'POST /oauth/token -',
      'GET /sync/watchlist/movies access-2',
    ]);
  });

  it('passes a second 401 on rather than refreshing again', async () => {
    const trakt = refreshingTrakt(() => ok(null, 401));
    const { account } = await signedIn(trakt);
    trakt.requests.length = 0;

    expect((await account.call('GET', '/sync/watchlist/shows')).status).toBe(401);
    expect(paths(trakt.requests)).toEqual([
      'GET /sync/watchlist/shows access-1',
      'POST /oauth/token -',
      'GET /sync/watchlist/shows access-2',
    ]);
  });

  it('shares one refresh between calls that met a 401 together', async () => {
    const trakt = refreshingTrakt((request) =>
      request.token === 'access-1' ? ok(null, 401) : ok({}),
    );
    const { account } = await signedIn(trakt);
    trakt.requests.length = 0;

    await Promise.all([
      account.call('GET', '/sync/watched/movies'),
      account.call('GET', '/sync/watched/shows?extended=full'),
    ]);
    expect(trakt.requests.filter((request) => request.path === '/oauth/token')).toHaveLength(1);
    expect(paths(trakt.requests).slice(-2)).toEqual([
      'GET /sync/watched/movies access-2',
      'GET /sync/watched/shows?extended=full access-2',
    ]);
  });

  it('asks again with tokens another call refreshed meanwhile, without refreshing', async () => {
    const first = deferred<TraktResponse>();
    let refreshes = 0;
    const trakt = fakeTrakt((request) => {
      if (request.path === '/oauth/token') return ok(tokenAnswer(2 + refreshes++));
      if (request.path === '/slow' && request.token === 'access-1') return first.promise;
      return request.token === 'access-1' ? ok(null, 401) : ok({});
    });
    const { account } = await signedIn(trakt);

    const slow = account.call('GET', '/slow');
    await account.call('GET', '/fast');
    first.resolve(ok(null, 401));
    await slow;

    expect(refreshes).toBe(1);
    expect(paths(trakt.requests).slice(-1)).toEqual(['GET /slow access-2']);
  });

  it.each([400, 401])(
    'signs out with a note when Trakt answers a refresh with %i',
    async (status) => {
      const trakt = fakeTrakt((request) =>
        request.path === '/oauth/token' ? ok({ error: 'invalid_grant' }, status) : ok(null, 401),
      );
      const { account, storage } = await signedIn(trakt);

      const error = await failure(account.call('GET', '/sync/last_activities'));
      expect(error.kind).toBe('signedOut');
      expect(error.message).not.toMatch(/access-|refresh-/);
      expect(account.get()).toEqual({ status: 'signedOut', expired: true });

      const again = setup(trakt, storage).account;
      await again.load();
      expect(again.get()).toEqual({ status: 'signedOut', expired: true });

      trakt.requests.length = 0;
      expect((await failure(account.call('GET', '/sync/last_activities'))).kind).toBe('signedOut');
      expect(trakt.requests).toEqual([]);
    },
  );

  it('carries on with a token that has time left when no refresh can be had', async () => {
    const trakt = fakeTrakt((request) =>
      request.path === '/oauth/token'
        ? Promise.reject(new TraktError('network', 'offline'))
        : ok({}),
    );
    const { account, clock } = await signedIn(trakt);
    trakt.requests.length = 0;
    clock.now = NOW + DAY - 30 * 60 * 1000;

    expect(await account.call('GET', '/sync/last_activities')).toEqual({ status: 200, data: {} });
    expect(paths(trakt.requests)).toEqual([
      'POST /oauth/token -',
      'GET /sync/last_activities access-1',
    ]);
  });

  it('fails a call when the token has run out and no refresh can be had, and stays signed in', async () => {
    let refresh: () => Promise<TraktResponse> = () =>
      Promise.reject(new TraktError('network', 'offline'));
    const trakt = fakeTrakt((request) => (request.path === '/oauth/token' ? refresh() : ok({})));
    const { account, clock } = await signedIn(trakt);
    clock.now = NOW + DAY + 1;

    expect((await failure(account.call('GET', '/sync/last_activities'))).kind).toBe('network');
    refresh = () => Promise.resolve(ok({ error: 'server_error' }, 503));
    const error = await failure(account.call('GET', '/sync/last_activities'));
    expect(error.kind).toBe('other');
    expect(account.get()).toEqual(SEAN);
  });

  it('turns calls down while signed out', async () => {
    const trakt = fakeTrakt(() => ok({}));
    const { account } = setup(trakt);
    expect((await failure(account.call('GET', '/sync/last_activities'))).kind).toBe('signedOut');
    expect(trakt.requests).toEqual([]);
  });

  it('signs out at once and revokes the token without waiting for Trakt', async () => {
    const never = new Promise<TraktResponse>(() => undefined);
    const trakt = fakeTrakt((request) => (request.path === '/oauth/revoke' ? never : ok({})));
    const { account, storage } = await signedIn(trakt);
    trakt.requests.length = 0;

    await account.signOut();

    expect(trakt.requests).toEqual([
      { method: 'POST', path: '/oauth/revoke', body: { token: 'access-1' } },
    ]);
    expect(account.get()).toEqual({ status: 'signedOut' });
    expect(await storage.get('trakt')).toEqual({});
    const again = setup(trakt, storage).account;
    await again.load();
    expect(again.get()).toEqual({ status: 'signedOut' });
  });

  it('signs out even when the revoke cannot be sent', async () => {
    const send: TraktSend = (request) => {
      if (request.path === '/oauth/revoke') throw new TraktError('network', 'offline');
      return Promise.resolve(ok({}));
    };
    const { account } = await signedIn({ send });
    await account.signOut();
    expect(account.get()).toEqual({ status: 'signedOut' });
  });

  it('signing out or in again clears the note about a sign-in that ran out', async () => {
    const trakt = fakeTrakt((request) =>
      request.path === '/oauth/token' ? ok({ error: 'invalid_grant' }, 401) : ok(null, 401),
    );
    const { account } = await signedIn(trakt);
    await failure(account.call('GET', '/sync/last_activities'));
    expect(account.get()).toEqual({ status: 'signedOut', expired: true });
    await account.signOut();
    expect(account.get()).toEqual({ status: 'signedOut' });

    await account.signIn(tokenAnswer(5));
    await failure(account.call('GET', '/sync/last_activities'));
    expect(account.get()).toEqual({ status: 'signedOut', expired: true });
    await account.signIn(tokenAnswer(6));
    expect(account.get()).toEqual(SEAN);
  });

  it('keeps no tokens refreshed after signing out, and revokes them', async () => {
    const refreshed = deferred<TraktResponse>();
    const trakt = fakeTrakt((request) =>
      request.path === '/oauth/token' ? refreshed.promise : ok({}),
    );
    const { account, clock, storage } = await signedIn(trakt);
    clock.now = NOW + DAY + 1;

    const call = account.call('GET', '/sync/last_activities');
    await Promise.resolve();
    await account.signOut();
    refreshed.resolve(ok(tokenAnswer(2)));

    expect((await failure(call)).kind).toBe('signedOut');
    expect(account.get()).toEqual({ status: 'signedOut' });
    expect(await storage.get('trakt')).toEqual({});
    const revoked = trakt.requests
      .filter((request) => request.path === '/oauth/revoke')
      .map((request) => request.body);
    expect(revoked).toEqual([{ token: 'access-1' }, { token: 'access-2' }]);
  });

  it('refreshes a new sign-in with its own token, not one still running for the old', async () => {
    const old = deferred<TraktResponse>();
    const trakt = fakeTrakt((request) => {
      if (request.path !== '/oauth/token') return ok({});
      const body = request.body as { refresh_token: string };
      return body.refresh_token === 'refresh-1' ? old.promise : ok(tokenAnswer(8));
    });
    const { account, clock } = await signedIn(trakt);
    clock.now = NOW + DAY + 1;

    const first = account.call('GET', '/sync/last_activities');
    await Promise.resolve();
    await account.signIn(tokenAnswer(7, 60));
    const second = account.call('GET', '/sync/playback?extended=full');
    await second;
    old.resolve(ok(tokenAnswer(2)));
    await first;

    const refreshes = trakt.requests
      .filter((request) => request.path === '/oauth/token')
      .map((request) => request.body);
    expect(refreshes).toEqual([{ refresh_token: 'refresh-1' }, { refresh_token: 'refresh-7' }]);
    expect(paths(trakt.requests)).toContain('GET /sync/playback?extended=full access-8');
  });

  it('does not sign out a new sign-in when an older refresh is refused', async () => {
    const refreshed = deferred<TraktResponse>();
    const trakt = fakeTrakt((request) =>
      request.path === '/oauth/token' ? refreshed.promise : ok({}),
    );
    const { account, clock } = await signedIn(trakt);
    clock.now = NOW + DAY + 1;

    const call = account.call('GET', '/sync/last_activities');
    await Promise.resolve();
    await account.signIn(tokenAnswer(7));
    refreshed.resolve(ok({ error: 'invalid_grant' }, 401));

    await call;
    expect(account.get()).toEqual(SEAN);
    expect(paths(trakt.requests).slice(-1)).toEqual(['GET /sync/last_activities access-7']);
  });
});
