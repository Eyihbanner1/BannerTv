import type { ContentType } from '@bannertv/protocol';
import { record } from './read';

/** The ids BannerTV can give Trakt for a title. */
export interface TraktIds {
  imdb?: string;
  tmdb?: number;
}

/** What Trakt's scrobble and sync calls take to name a film or an episode. */
export type TraktTarget =
  | { movie: { ids: TraktIds } }
  | { show: { ids: TraktIds }; episode: { season: number; number: number } };

const IMDB = /^tt\d+$/;
const TMDB = /^tmdb:(\d+)$/;

function isTmdbId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * A meta id as Trakt ids: an IMDb id, or `tmdb:<id>`. Other ids (Kitsu's,
 * for one) mean nothing to Trakt.
 */
export function traktIds(metaId: string): TraktIds | undefined {
  if (IMDB.test(metaId)) return { imdb: metaId };
  const tmdb = TMDB.exec(metaId);
  const id = tmdb ? Number(tmdb[1]) : undefined;
  return isTmdbId(id) ? { tmdb: id } : undefined;
}

/**
 * The film or episode that played, as Trakt names it. A series episode's
 * video id is `{metaId}:{season}:{episode}`; a series video without them, a
 * title Trakt cannot identify, or any other type gives undefined.
 */
export function traktTarget(
  type: ContentType,
  metaId: string,
  videoId: string,
): TraktTarget | undefined {
  if (type !== 'movie' && type !== 'series') return undefined;
  const ids = traktIds(metaId);
  if (!ids) return undefined;
  if (type === 'movie') return { movie: { ids } };
  const prefix = `${metaId}:`;
  if (!videoId.startsWith(prefix)) return undefined;
  const episode = /^(\d+):(\d+)$/.exec(videoId.slice(prefix.length));
  if (!episode) return undefined;
  return { show: { ids }, episode: { season: Number(episode[1]), number: Number(episode[2]) } };
}

/**
 * Every meta id a title Trakt lists goes by: its IMDb id, then `tmdb:<id>`.
 * Trakt sends both for most titles, and the TV may have saved either.
 */
export function metaIdsFromIds(ids: unknown): string[] {
  const raw = record(ids);
  const found: string[] = [];
  if (!raw) return found;
  if (typeof raw.imdb === 'string' && IMDB.test(raw.imdb)) found.push(raw.imdb);
  if (isTmdbId(raw.tmdb)) found.push(`tmdb:${raw.tmdb}`);
  return found;
}

/** The meta id for a title Trakt lists: its IMDb id, else `tmdb:<id>`. */
export function metaIdFromIds(ids: unknown): string | undefined {
  return metaIdsFromIds(ids)[0];
}
