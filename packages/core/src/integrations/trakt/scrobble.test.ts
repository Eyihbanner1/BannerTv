import { describe, expect, it } from 'vitest';
import type { TraktAccountState } from './account';
import { traktTarget, type TraktTarget } from './ids';
import { createScrobbler } from './scrobble';
import { TraktError, type TraktMethod, type TraktResponse } from './transport';

const FILM = traktTarget('movie', 'tt0372784', 'tt0372784');
const EPISODE = traktTarget('series', 'tt0903747', 'tt0903747:1:2');

/** Trakt's answer to a scrobble. */
const SCROBBLED: TraktResponse = {
  status: 201,
  data: {
    id: 9832,
    action: 'start',
    progress: 12.35,
    sharing: { twitter: false, mastodon: false, tumblr: false },
    movie: {
      title: 'Batman Begins',
      year: 2005,
      ids: { trakt: 1, slug: 'batman-begins-2005', imdb: 'tt0372784', tmdb: 272 },
    },
  },
};

function fakeAccount(
  answer: () => Promise<TraktResponse> = () => Promise.resolve(SCROBBLED),
  status: TraktAccountState['status'] = 'signedIn',
) {
  const calls: { method: TraktMethod; path: string; body: unknown }[] = [];
  const state = { status } as TraktAccountState;
  const account = {
    get: () => state,
    call(method: TraktMethod, path: string, body?: unknown) {
      calls.push({ method, path, body });
      return answer();
    },
  };
  return { account, calls };
}

function scrobbler(target: TraktTarget | undefined, account = fakeAccount()) {
  return { scrobble: createScrobbler({ account: account.account, target }), calls: account.calls };
}

describe('createScrobbler', () => {
  it('tells Trakt about a film with the percentage watched, to two decimals', async () => {
    const { scrobble, calls } = scrobbler(FILM);
    await scrobble.start(12.3456);
    await scrobble.pause(40.004);
    await scrobble.start(40);
    await scrobble.stop(91.5);
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/scrobble/start',
        body: { movie: { ids: { imdb: 'tt0372784' } }, progress: 12.35 },
      },
      {
        method: 'POST',
        path: '/scrobble/pause',
        body: { movie: { ids: { imdb: 'tt0372784' } }, progress: 40 },
      },
      {
        method: 'POST',
        path: '/scrobble/start',
        body: { movie: { ids: { imdb: 'tt0372784' } }, progress: 40 },
      },
      {
        method: 'POST',
        path: '/scrobble/stop',
        body: { movie: { ids: { imdb: 'tt0372784' } }, progress: 91.5 },
      },
    ]);
  });

  it('names an episode by its show, season and number', async () => {
    const { scrobble, calls } = scrobbler(EPISODE);
    await scrobble.start(0);
    expect(calls[0]!.body).toEqual({
      show: { ids: { imdb: 'tt0903747' } },
      episode: { season: 1, number: 2 },
      progress: 0,
    });
  });

  it('keeps the percentage between 0 and 100, and sends nothing without one', async () => {
    const { scrobble, calls } = scrobbler(FILM);
    await scrobble.start(-3);
    await scrobble.stop(100.4);
    await scrobble.start(Number.NaN);
    await scrobble.pause(Number.POSITIVE_INFINITY);
    expect(calls.map((call) => (call.body as { progress: number }).progress)).toEqual([0, 100]);
  });

  it('sends nothing for a title Trakt cannot identify', async () => {
    const { scrobble, calls } = scrobbler(traktTarget('series', 'kitsu:1376', 'kitsu:1376:1'));
    await scrobble.start(1);
    await scrobble.pause(2);
    await scrobble.stop(90);
    expect(calls).toEqual([]);
  });

  it('sends nothing while signed out', async () => {
    const { scrobble, calls } = scrobbler(FILM, fakeAccount(undefined, 'signedOut'));
    await scrobble.start(1);
    await scrobble.stop(90);
    expect(calls).toEqual([]);
  });

  it('leaves a sign-in still being read to the account', async () => {
    const { scrobble, calls } = scrobbler(FILM, fakeAccount(undefined, 'loading'));
    await scrobble.start(1);
    expect(calls).toHaveLength(1);
  });

  it('sends no pause or stop before a start, no second pause, and one stop', async () => {
    const { scrobble, calls } = scrobbler(FILM);
    await scrobble.pause(1);
    await scrobble.stop(2);
    await scrobble.start(3);
    await scrobble.pause(4);
    await scrobble.pause(5);
    await scrobble.stop(6);
    await scrobble.stop(7);
    await scrobble.pause(8);
    await scrobble.start(9);
    await scrobble.stop(95);
    expect(
      calls.map((call) => `${call.path} ${(call.body as { progress: number }).progress}`),
    ).toEqual([
      '/scrobble/start 3',
      '/scrobble/pause 4',
      '/scrobble/stop 6',
      '/scrobble/start 9',
      '/scrobble/stop 95',
    ]);
  });

  it('drops failures and carries on', async () => {
    const answers: Array<() => Promise<TraktResponse>> = [
      () => Promise.reject(new TraktError('network', 'offline')),
      () => Promise.reject(new TraktError('signedOut', 'Not signed in to Trakt')),
      () => Promise.resolve({ status: 409, data: { watched_at: '2026-10-28T11:00:00.000Z' } }),
      () => Promise.resolve({ status: 500, data: null }),
    ];
    let n = 0;
    const { scrobble, calls } = scrobbler(
      FILM,
      fakeAccount(() => answers[n++]!()),
    );
    await expect(scrobble.start(1)).resolves.toBeUndefined();
    await expect(scrobble.pause(2)).resolves.toBeUndefined();
    await expect(scrobble.start(3)).resolves.toBeUndefined();
    await expect(scrobble.stop(90)).resolves.toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it('sends one request at a time, in order', async () => {
    const pending: Array<(response: TraktResponse) => void> = [];
    const { scrobble, calls } = scrobbler(
      FILM,
      fakeAccount(() => new Promise<TraktResponse>((resolve) => pending.push(resolve))),
    );
    const started = scrobble.start(1);
    const stopped = scrobble.stop(85);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.map((call) => call.path)).toEqual(['/scrobble/start']);
    pending[0]!(SCROBBLED);
    await started;
    await Promise.resolve();
    expect(calls.map((call) => call.path)).toEqual(['/scrobble/start', '/scrobble/stop']);
    pending[1]!(SCROBBLED);
    await stopped;
  });
});
