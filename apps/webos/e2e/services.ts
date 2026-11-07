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
  /** Every Search route asked for, with its query: "discover?type=movie&keywords=9716". */
  searches: string[];
}

export interface ServicesOptions {
  trakt?: boolean;
  tmdb?: boolean;
  /** The service has Search's TMDB routes too. Needs `tmdb`. */
  search?: boolean;
  /** The UK rating TMDB gives every film. Default U. */
  certificate?: string;
  /** A UK rating TMDB also gives every film's home release, if any. */
  homeCertificate?: string;
  /** When TMDB says every film comes out to watch at home in the UK. None by default. */
  homeRelease?: string;
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
function tmdbMovie(
  id: number,
  certificate: string,
  homeCertificate?: string,
  homeRelease?: string,
) {
  const releases: { certification: string; type: number; release_date?: string }[] = [
    { certification: certificate, type: 3 },
  ];
  if (homeCertificate) releases.push({ certification: homeCertificate, type: 5 });
  if (homeRelease) releases.push({ certification: '', type: 4, release_date: homeRelease });
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
      results: [{ iso_3166_1: 'GB', release_dates: releases }],
    },
  };
}

const title = (id: string, type: 'movie' | 'series', name: string, extra = {}) => ({
  id,
  type,
  name,
  year: '2023',
  poster: `/${id}.jpg`,
  genres: [],
  ...extra,
});

/** Search's routes as the service answers them: titles by IMDb id, with UK ratings when asked. */
function searchAnswer(route: string): { status: number; data: unknown } {
  const url = new URL(`https://service.test/${route}`);
  const query = url.searchParams;
  switch (url.pathname.slice(1)) {
    case 'discover': {
      const type = query.get('type') === 'series' ? 'series' : 'movie';
      if (query.get('keywords') === '9716,356038,362573') {
        return {
          status: 200,
          data: {
            titles:
              type === 'movie'
                ? [
                    title('tt9100001', 'movie', 'Laugh Out Loud: Live', { genres: ['Comedy'] }),
                    title('tt9100002', 'movie', 'One Mic Night', { genres: ['Comedy'] }),
                  ]
                : [title('tt9100003', 'series', 'Open Mic Tuesdays', { genres: ['Comedy'] })],
          },
        };
      }
      if (query.get('certification')) {
        // A kids profile's row: TMDB says each title's UK rating.
        return {
          status: 200,
          data: {
            titles: [
              title('tt9300001', type, 'Puddle Jumpers', {
                genres: ['Family', 'Comedy'],
                certificates: { GB: ['U'] },
              }),
              title('tt9300002', type, 'Too Old For This', {
                genres: ['Family', 'Comedy'],
                certificates: { GB: ['15'] },
              }),
            ],
          },
        };
      }
      return { status: 200, data: { titles: [] } };
    }
    case 'multi': {
      const words = query.get('query') ?? '';
      if (words === 'something like summer') {
        const titles = [{ name: 'Something Like Summer', type: 'movie', year: '2017' }];
        return { status: 200, data: { people: [], titles } };
      }
      if (words.indexOf('tom') !== 0) return { status: 200, data: { people: [], titles: [] } };
      return {
        status: 200,
        data: {
          people: [
            { id: 31, name: 'Tom Hanks', department: 'Acting', knownFor: ['Big'] },
            { id: 2524, name: 'Tom Hardy', department: 'Acting', knownFor: [] },
          ],
          titles: [{ name: 'Tomb Raider', type: 'movie', year: '2018' }],
        },
      };
    }
    case 'person':
      return {
        status: 200,
        data:
          query.get('id') === '31'
            ? {
                titles: [
                  title('tt9200001', 'movie', 'The Long Flight Home'),
                  title('tt9200002', 'series', 'Band of Neighbours', { year: '2001' }),
                ],
              }
            : { titles: [] },
      };
    case 'like':
      return {
        status: 200,
        data: {
          like: { name: 'The Matrix', type: 'movie', year: '1999' },
          titles: [
            title('tt9400001', 'movie', 'Wired Reality'),
            title('tt9400002', 'movie', 'Neon Code'),
          ],
        },
      };
    case 'titles':
      return {
        status: 200,
        data: {
          titles: [
            title('tt9500001', 'movie', 'Snow Friends', {
              genres: ['Family', 'Animation'],
              certificates: { GB: ['U'] },
            }),
            title('tt9500002', 'movie', 'Snow Fight Night', {
              genres: ['Family', 'Animation'],
              certificates: { GB: ['12A', '15'] },
            }),
          ],
        },
      };
    default:
      return { status: 404, data: { error: 'not found' } };
  }
}

/**
 * BannerTV's own service: /status, a fake Trakt account behind /trakt,
 * TMDB behind /tmdb with TMDB's images, and Search's routes behind
 * /search. Call after mockAddons.
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
  const tmdb: FakeTmdb = { paths: [], searches: [] };
  const search = options.tmdb === true && options.search === true;

  await page.route(`${API_SERVICE}/status`, (route) =>
    json(route, {
      trakt: options.trakt === true,
      tmdb: options.tmdb === true,
      // A service from before Search's routes says nothing of them.
      ...(options.search === undefined ? {} : { search }),
    }),
  );
  await page.route(`${API_SERVICE}/search/**`, (route) => {
    if (!search) return json(route, { error: 'not found' }, 404);
    const url = new URL(route.request().url());
    const asked = url.pathname.replace(/^\/search\//, '') + url.search;
    tmdb.searches.push(decodeURIComponent(asked));
    const answer = searchAnswer(asked);
    return json(route, answer.data, answer.status);
  });
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
    if (movie) {
      return json(
        route,
        tmdbMovie(
          Number(movie[1]),
          options.certificate ?? 'U',
          options.homeCertificate,
          options.homeRelease,
        ),
      );
    }
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
