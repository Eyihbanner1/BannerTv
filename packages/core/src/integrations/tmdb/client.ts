import type { ContentType } from '@bannertv/protocol';
import { BROWSE_TIMEOUT_MS } from '../../addons/client';
import { type FetchJson, HttpError } from '../../http';
import type { Limiter } from '../../limiter';
import type { CachePolicy, Query, QueryCache, QueryState } from '../../query';
import {
  isCount,
  isImagePath,
  isTmdbId,
  readDetails,
  readFoundId,
  readSeason,
  type TmdbDetails,
  type TmdbEpisode,
} from './details';

export type { TmdbDetails, TmdbEpisode, TmdbPerson } from './details';

const DAY = 24 * 60 * 60 * 1000;

/** TMDB's facts hardly change, and Details shows the addon's own data when TMDB fails. */
export const TMDB_POLICY: CachePolicy = {
  freshFor: 7 * DAY,
  revalidateFor: 7 * DAY,
  errorFor: 30 * DAY,
};

// Answers are cached as read, not as TMDB sent them, so the keys carry a
// version: a build that reads them differently does not get the old shape.
const KEY = 'tmdb:2';

export type TmdbImageSize =
  'w92' | 'w185' | 'w300' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original';

/** The address of a TMDB image at a size, or undefined when there is no usable path. */
export function tmdbImageUrl(path: string | undefined, size: TmdbImageSize): string | undefined {
  return isImagePath(path) ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

export interface TmdbClientOptions {
  /** BannerTV's service's TMDB route, such as https://api.bannertv.workers.dev/tmdb. */
  baseUrl: string;
  fetchJson: FetchJson;
  queries: QueryCache;
  /** Queues TMDB's requests behind others; without one they go at once. */
  limiter?: Limiter;
}

export interface TmdbClient {
  /**
   * What TMDB adds to a film or series on Details, or null when TMDB does
   * not know it. Only films and series with IMDb ids (tt...) are looked up;
   * anything else is null without a request.
   */
  details(type: ContentType, imdbId: string): Query<TmdbDetails | null>;
  /** A season's episodes by episode number; empty when TMDB has no such season. */
  season(tmdbId: number, season: number): Query<Record<number, TmdbEpisode>>;
}

/** A query answered from the start, for what TMDB is never asked about. */
function answered<T>(value: T): Query<T> {
  const state: QueryState<T> = { status: 'success', data: value, stale: false };
  return {
    get: () => state,
    subscribe: () => () => undefined,
    load: () => undefined,
    retry: () => undefined,
  };
}

const NO_DETAILS = answered<TmdbDetails | null>(null);
const NO_EPISODES = answered<Record<number, TmdbEpisode>>(Object.freeze({}));

/** TMDB's 404 means it has no such title or season: an answer to keep, not a failure. */
function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.kind === 'status' && error.status === 404;
}

/**
 * TMDB through BannerTV's service, which adds the key, so nothing here is
 * secret. Answers are kept for a week in the response cache, and across
 * launches.
 */
export function createTmdbClient(options: TmdbClientOptions): TmdbClient {
  const { fetchJson, queries, limiter } = options;
  const base = options.baseUrl.replace(/\/+$/, '');

  function get(path: string): Promise<unknown> {
    const request = () => fetchJson(`${base}/${path}`, { timeoutMs: BROWSE_TIMEOUT_MS });
    return limiter ? limiter.run(request) : request();
  }

  async function lookUp(kind: TmdbDetails['kind'], imdbId: string): Promise<TmdbDetails | null> {
    try {
      const id = readFoundId(kind, await get(`find/${imdbId}?external_source=imdb_id`));
      if (id === undefined) return null;
      const append =
        kind === 'tv' ? 'images,aggregate_credits,content_ratings' : 'images,credits,release_dates';
      const answer = await get(
        `${kind}/${id}?append_to_response=${append}&include_image_language=en,null&language=en-GB`,
      );
      return readDetails(kind, id, answer);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  return {
    details(type, imdbId) {
      const kind = type === 'movie' ? 'movie' : type === 'series' ? 'tv' : undefined;
      if (!kind || !/^tt\d+$/.test(imdbId)) return NO_DETAILS;
      return queries.query(`${KEY}:details:${type}:${imdbId}`, {
        policy: TMDB_POLICY,
        persist: true,
        fetch: async () => ({ value: await lookUp(kind, imdbId), hints: {} }),
      });
    },

    season(tmdbId, season) {
      if (!isTmdbId(tmdbId) || !isCount(season)) return NO_EPISODES;
      return queries.query(`${KEY}:season:${tmdbId}:${season}`, {
        policy: TMDB_POLICY,
        persist: true,
        fetch: async () => {
          try {
            const answer = await get(`tv/${tmdbId}/season/${season}?language=en-GB`);
            return { value: readSeason(answer), hints: {} };
          } catch (error) {
            if (isNotFound(error)) return { value: {}, hints: {} };
            throw error;
          }
        },
      });
    },
  };
}
