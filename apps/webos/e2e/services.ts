import type { Page, Route } from '@playwright/test';
import { API_SERVICE } from '../src/data/api-service';
import { IMAGE } from './addons';

/** One request the TV sent to Trakt through BannerTV's service. */
export interface TraktCall {
  method: string;
  path: string;
  token?: string;
  body?: Record<string, unknown>;
}

export interface FakeTrakt {
  calls: TraktCall[];
  /** The viewer enters the code at trakt.tv, so the next poll signs the TV in. */
  approve(): void;
  /** The calls to one path, such as /scrobble/start. */
  callsTo(path: string): TraktCall[];
}

export interface FakeTmdb {
  /** Every TMDB path asked for, without the query. */
  paths: string[];
}

export interface ServicesOptions {
  trakt?: boolean;
  tmdb?: boolean;
  /** The UK rating TMDB gives every film. Default U. */
  certificate?: string;
}

/** A Trakt sign-in as the app keeps it, for a profile already signed in. */
export function traktSignIn(username = 'sam_watches') {
  return {
    tokens: { accessToken: 'seeded-access', refreshToken: 'seeded-refresh', expiresAt: 4e12 },
    username,
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

/** What the fake Trakt account holds. */
function traktAnswer(path: string, approved: boolean): { status: number; data: unknown } {
  const now = Date.now();
  switch (path.replace(/\?.*$/, '')) {
    case '/oauth/device/code':
      return {
        status: 200,
        data: {
          device_code: 'device-1',
          user_code: 'BT4K7Q2Z',
          verification_url: 'https://trakt.tv/activate',
          expires_in: 600,
          interval: 1,
        },
      };
    case '/oauth/device/token':
      return approved
        ? {
            status: 200,
            data: {
              access_token: 'fresh-access',
              refresh_token: 'fresh-refresh',
              expires_in: 86400,
            },
          }
        : { status: 400, data: null };
    case '/oauth/revoke':
      return { status: 200, data: null };
    case '/users/settings':
      return { status: 200, data: { user: { username: 'sam_watches' } } };
    case '/sync/last_activities': {
      const at = iso(now - DAY);
      return {
        status: 200,
        data: {
          all: at,
          movies: { watched_at: at, paused_at: at, watchlisted_at: at },
          episodes: { watched_at: at, paused_at: at },
          shows: { watchlisted_at: at },
          watchlist: { updated_at: at },
        },
      };
    }
    case '/sync/playback':
      return {
        status: 200,
        data: [
          {
            type: 'movie',
            progress: 40,
            paused_at: iso(now - DAY),
            movie: { title: 'Tears of Steel', ids: { imdb: 'tt2285752' }, runtime: 12 },
          },
        ],
      };
    case '/sync/watched/movies':
      return {
        status: 200,
        data: [{ movie: { title: 'Elephants Dream', ids: { imdb: 'tt0807840' } } }],
      };
    case '/sync/watched/shows':
      return {
        status: 200,
        data: [
          {
            show: { title: 'Morevna Project', ids: { imdb: 'tt8000001' }, runtime: 10 },
            seasons: [
              {
                number: 1,
                episodes: [
                  { number: 1, last_watched_at: iso(now - 3 * DAY) },
                  { number: 2, last_watched_at: iso(now - 2 * DAY) },
                ],
              },
            ],
          },
        ],
      };
    case '/sync/watchlist/movies':
      return {
        status: 200,
        data: [
          {
            listed_at: iso(now - DAY),
            movie: { title: 'Sintel', year: 2010, ids: { imdb: 'tt1727587' } },
          },
        ],
      };
    case '/sync/watchlist/shows':
      return { status: 200, data: [] };
    case '/sync/watchlist':
    case '/sync/watchlist/remove':
      return { status: 201, data: { not_found: { movies: [], shows: [] } } };
    case '/scrobble/start':
    case '/scrobble/pause':
    case '/scrobble/stop':
      return { status: 201, data: {} };
    default:
      return { status: 404, data: null };
  }
}

/** TMDB's film answer, the same for every film: a logo, a textless backdrop, cast and a rating. */
function tmdbMovie(id: number, certificate: string) {
  return {
    id,
    tagline: 'An open movie.',
    backdrop_path: '/backdrop-text.jpg',
    production_companies: [{ name: 'Blender Studio' }],
    images: {
      logos: [{ file_path: '/logo.png', iso_639_1: 'en', vote_average: 5, vote_count: 3 }],
      backdrops: [{ file_path: '/backdrop.jpg', iso_639_1: null, vote_average: 5, vote_count: 3 }],
    },
    credits: {
      cast: [
        { name: 'Cas Jansen', character: 'Proog', profile_path: '/cas.jpg', order: 0 },
        { name: 'Tygo Gernandt', character: 'Emo', profile_path: '/tygo.jpg', order: 1 },
        { name: 'No Photo', character: 'Extra', order: 2 },
      ],
    },
    release_dates: {
      results: [{ iso_3166_1: 'GB', release_dates: [{ certification: certificate, type: 3 }] }],
    },
  };
}

/**
 * BannerTV's own service: /status, a fake Trakt account behind /trakt, and
 * TMDB behind /tmdb, with TMDB's images. Call after mockAddons.
 */
export async function mockServices(
  page: Page,
  options: ServicesOptions = {},
): Promise<{ trakt: FakeTrakt; tmdb: FakeTmdb }> {
  let approved = false;
  const trakt: FakeTrakt = {
    calls: [],
    approve: () => void (approved = true),
    callsTo: (path) => trakt.calls.filter((call) => call.path.replace(/\?.*$/, '') === path),
  };
  const tmdb: FakeTmdb = { paths: [] };

  await page.route(`${API_SERVICE}/status`, (route) =>
    json(route, { trakt: options.trakt === true, tmdb: options.tmdb === true }),
  );
  await page.route(`${API_SERVICE}/trakt`, (route) => {
    if (!options.trakt) return json(route, { error: 'unconfigured' }, 503);
    const call = JSON.parse(route.request().postData() ?? '{}') as TraktCall;
    trakt.calls.push(call);
    return json(route, traktAnswer(call.path, approved));
  });
  await page.route(`${API_SERVICE}/tmdb/**`, (route) => {
    if (!options.tmdb) return json(route, { error: 'unconfigured' }, 503);
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/tmdb\//, '');
    tmdb.paths.push(path);
    const found = /^find\/(tt\d+)$/.exec(path);
    if (found) {
      // Films only: every series is unknown to this TMDB.
      const id = Number(found[1]!.slice(2));
      return json(route, { movie_results: [{ id }], tv_results: [] });
    }
    const movie = /^movie\/(\d+)$/.exec(path);
    if (movie) return json(route, tmdbMovie(Number(movie[1]), options.certificate ?? 'U'));
    return json(route, { status_message: 'not found' }, 404);
  });
  await page.route(/^https:\/\/image\.tmdb\.org\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: IMAGE,
    }),
  );
  return { trakt, tmdb };
}
