import type { TraktAccount } from './account';
import { metaIdsFromIds, type TraktIds, traktIds } from './ids';
import { list, record, whole } from './read';
import { isOk, realTimers, type TraktResponse, type TraktTimers } from './transport';

/** Trakt takes one change a second; a Retry-After longer than this gives up. */
const MAX_RETRY_AFTER_S = 10;

/** A film, or a series episode by its numbers, as the viewer marked it. */
export interface TraktMark {
  metaId: string;
  type: string;
  season?: number;
  episode?: number;
  /**
   * When it was marked watched, in milliseconds: the time saved with it
   * here. Trakt keeps it as the watch time, so the history it gives back is
   * no newer than what is saved here and does not move the viewer on.
   */
  watchedAt?: number;
}

interface Watched {
  watched_at?: string;
}

interface HistoryBody {
  movies: (Watched & { ids: TraktIds })[];
  shows: {
    ids: TraktIds;
    seasons: { number: number; episodes: (Watched & { number: number })[] }[];
  }[];
}

function watchedAt(mark: TraktMark): Watched {
  return mark.watchedAt === undefined ? {} : { watched_at: new Date(mark.watchedAt).toISOString() };
}

/**
 * Marks as the body of sync/history and sync/history/remove: films by their
 * ids, episodes under their show by season and number. Titles Trakt cannot
 * identify, and series videos without numbers, are left out. Undefined when
 * nothing is left.
 */
export function historyBody(marks: readonly TraktMark[]): HistoryBody | undefined {
  const body: HistoryBody = { movies: [], shows: [] };
  const shows = new Map<string, HistoryBody['shows'][number]>();
  for (const mark of marks) {
    const ids = traktIds(mark.metaId);
    if (!ids) continue;
    if (mark.type === 'movie') {
      if (!body.movies.some((movie) => sameIds(movie.ids, ids))) {
        body.movies.push({ ids, ...watchedAt(mark) });
      }
      continue;
    }
    if (mark.type !== 'series' || mark.season === undefined || mark.episode === undefined) continue;
    let show = shows.get(mark.metaId);
    if (!show) {
      show = { ids, seasons: [] };
      shows.set(mark.metaId, show);
      body.shows.push(show);
    }
    let season = show.seasons.find((s) => s.number === mark.season);
    if (!season) {
      season = { number: mark.season, episodes: [] };
      show.seasons.push(season);
    }
    if (!season.episodes.some((e) => e.number === mark.episode)) {
      season.episodes.push({ number: mark.episode, ...watchedAt(mark) });
    }
  }
  return body.movies.length > 0 || body.shows.length > 0 ? body : undefined;
}

function sameIds(a: TraktIds, b: TraktIds): boolean {
  return a.imdb === b.imdb && a.tmdb === b.tmdb;
}

/**
 * The ids of Trakt's paused entries (sync/playback) for a title: a film's
 * own, or every paused episode of a series. `metaId` may be any id Trakt
 * gives the title.
 */
export function pausedIds(items: readonly unknown[], metaId: string, type: string): number[] {
  const ids: number[] = [];
  for (const value of items) {
    const item = record(value);
    const id = whole(item?.id);
    if (id === undefined) continue;
    const title =
      type === 'movie' && item?.type === 'movie'
        ? record(item.movie)
        : type === 'series' && item?.type === 'episode'
          ? record(item.show)
          : undefined;
    if (title && metaIdsFromIds(title.ids).indexOf(metaId) !== -1) ids.push(id);
  }
  return ids;
}

export interface TraktMarks {
  /**
   * Adds the marks to Trakt's history as watched now, or takes them out of
   * it. Resolves false when Trakt did not take them (signed out, offline, a
   * refusal); never rejects.
   */
  history(marks: readonly TraktMark[], watched: boolean): Promise<boolean>;
  /**
   * Takes a title off Trakt's paused list, so other Trakt apps stop offering
   * to continue it too. Resolves false when that could not be done; never
   * rejects.
   */
  forgetPaused(metaId: string, type: string): Promise<boolean>;
}

/** What the viewer marks on a title's page and Continue Watching, sent on to Trakt. */
export function createTraktMarks(options: {
  account: Pick<TraktAccount, 'load' | 'get' | 'call'>;
  timers?: TraktTimers;
}): TraktMarks {
  const { account, timers = realTimers } = options;

  async function signedIn(): Promise<boolean> {
    await account.load();
    return account.get().status === 'signedIn';
  }

  /** One call, again once after a short Retry-After, as sync does. */
  async function send(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<TraktResponse> {
    const response = await account.call(method, path, body);
    const retryAfter = response.retryAfter ?? 1;
    if (response.status !== 429 || retryAfter > MAX_RETRY_AFTER_S) return response;
    await new Promise<void>((resolve) => {
      timers.setTimeout(() => resolve(), retryAfter * 1000);
    });
    return account.call(method, path, body);
  }

  return {
    async history(marks, watched) {
      const body = historyBody(marks);
      if (!body) return false;
      try {
        if (!(await signedIn())) return false;
        const response = await send(
          'POST',
          watched ? '/sync/history' : '/sync/history/remove',
          body,
        );
        return isOk(response.status);
      } catch {
        return false;
      }
    },
    async forgetPaused(metaId, type) {
      if (!traktIds(metaId) || (type !== 'movie' && type !== 'series')) return false;
      try {
        if (!(await signedIn())) return false;
        const answer = await send(
          'GET',
          type === 'movie' ? '/sync/playback/movies' : '/sync/playback/episodes',
        );
        if (!isOk(answer.status)) return false;
        let done = true;
        for (const id of pausedIds(list(answer.data), metaId, type)) {
          const response = await send('DELETE', `/sync/playback/${id}`);
          if (!isOk(response.status)) done = false;
        }
        return done;
      } catch {
        return false;
      }
    },
  };
}
