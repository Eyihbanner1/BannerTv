import { type FetchJson, HttpError } from '../../http';
import type { Limiter } from '../../limiter';
import { type EpisodeMarks, readEpisodeMarks } from '../../playback/skips';
import type { CachePolicy, Query, QueryCache, QueryState } from '../../query';

/**
 * IntroDB (https://introdb.app): where viewers mark the intro, recap and end
 * credits of TV episodes, by IMDb id, season and episode. Reading it needs no
 * key and no account, but its answers name only its own website as an origin
 * that may read them, so a browser, the TV's included, throws them away. The
 * TV asks through BannerTV's service instead (`proxyUrl`), which passes the
 * same answer on. BannerTV only reads; it never sends timings.
 */
export const INTRODB_URL = 'https://api.introdb.app';

/** The TV is slow to connect at times; the skip is a nicety, not worth a long wait. */
export const INTRODB_TIMEOUT_MS = 8000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Timings are added and corrected now and then: a day fresh, then used while
 * a newer copy is asked for. A failure is asked again after an hour.
 */
export const INTRODB_POLICY: CachePolicy = {
  freshFor: DAY,
  revalidateFor: 13 * DAY,
  errorFor: HOUR,
};

// Kept as read, not as IntroDB sent them, so the keys carry a version:
// 2 added the end credits.
const KEY = 'introdb:2';

export interface IntroDbClientOptions {
  /** IntroDB's address; INTRODB_URL unless a test says otherwise. */
  baseUrl?: string;
  /**
   * An address that answers as IntroDB does (BannerTV's service), asked
   * first. IntroDB itself is asked when it has no answer: a service from
   * before its IntroDB route, or one that is down. A phone reads IntroDB as
   * well as the service; a browser cannot.
   */
  proxyUrl?: string;
  fetchJson: FetchJson;
  queries: QueryCache;
  limiter?: Limiter;
}

export interface IntroDbClient {
  /**
   * The intro and recap of a series episode, in the order they play, and its
   * end credits. Only episodes with Stremio's IMDb ids (tt123:2:5) are looked
   * up; anything else, films included, has none without a request.
   */
  marks(type: string, videoId: string): Query<EpisodeMarks>;
}

/** The IMDb id, season and episode in a Stremio series video id, such as tt0903747:2:5. */
export function episodeOf(
  videoId: string,
): { imdbId: string; season: number; episode: number } | null {
  const match = /^(tt\d{1,10}):(\d{1,4}):(\d{1,5})$/.exec(videoId);
  if (!match) return null;
  const season = Number(match[2]);
  const episode = Number(match[3]);
  // Season 0 holds specials, which IntroDB does not time.
  if (season < 1 || episode < 1) return null;
  return { imdbId: match[1]!, season, episode };
}

const NONE: EpisodeMarks = Object.freeze({ segments: Object.freeze([]) });
const NO_MARKS: Query<EpisodeMarks> = (() => {
  const state: QueryState<EpisodeMarks> = { status: 'success', data: NONE, stale: false };
  return {
    get: () => state,
    subscribe: () => () => undefined,
    load: () => undefined,
    retry: () => undefined,
  };
})();

/** IntroDB's 404: it has no timings for the episode. An answer to keep, not a failure. */
function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.kind === 'status' && error.status === 404;
}

export function createIntroDbClient(options: IntroDbClientOptions): IntroDbClient {
  const { fetchJson, queries, limiter } = options;
  const base = (options.baseUrl ?? INTRODB_URL).replace(/\/+$/, '');
  const proxy = options.proxyUrl?.replace(/\/+$/, '');

  async function ask(from: string, query: string): Promise<EpisodeMarks> {
    const request = () => fetchJson(`${from}/segments?${query}`, { timeoutMs: INTRODB_TIMEOUT_MS });
    return readEpisodeMarks(await (limiter ? limiter.run(request) : request()));
  }

  async function lookUp(imdbId: string, season: number, episode: number) {
    const query = `imdb_id=${imdbId}&season=${season}&episode=${episode}`;
    if (proxy) {
      try {
        return await ask(proxy, query);
      } catch {
        // IntroDB itself, below.
      }
    }
    try {
      return await ask(base, query);
    } catch (error) {
      if (isNotFound(error)) return NONE;
      throw error;
    }
  }

  return {
    marks(type, videoId) {
      const found = type === 'series' ? episodeOf(videoId) : null;
      if (!found) return NO_MARKS;
      const { imdbId, season, episode } = found;
      return queries.query(`${KEY}:${imdbId}:${season}:${episode}`, {
        policy: INTRODB_POLICY,
        persist: true,
        fetch: async () => ({ value: await lookUp(imdbId, season, episode), hints: {} }),
      });
    },
  };
}
