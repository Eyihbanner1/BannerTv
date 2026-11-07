import {
  createSearchService,
  createTmdbClient,
  type SearchService,
  type TmdbDetails,
} from '@bannertv/core';
import { useMemo, useSyncExternalStore } from 'react';
import { isSharpDisplay } from '../components/artwork-size';
import { fetchJson } from '../platform/http';
import { queryCache, requestLimiter } from './addons';
import { API_SERVICE, serviceStatus } from './api';
import { preferences } from './preferences';
import { isKidsProfile } from './profiles';
import { useQuery } from './use-query';

/** TMDB through BannerTV's service, which adds the key. */
export const tmdbClient = createTmdbClient({
  baseUrl: `${API_SERVICE}/tmdb`,
  fetchJson,
  queries: queryCache,
  limiter: requestLimiter,
});

let search: SearchService | undefined;

/**
 * Search's rows from TMDB through BannerTV's service, which adds the key and
 * answers with titles by IMDb id. Made on first use, once the app has said
 * whether the TV is short of power, so posters are as sharp as tiles draw them.
 */
export function searchService(): SearchService {
  if (!search) {
    search = createSearchService({
      baseUrl: `${API_SERVICE}/search`,
      fetchJson,
      queries: queryCache,
      limiter: requestLimiter,
      posterSize: isSharpDisplay() ? 'w500' : 'w342',
    });
  }
  return search;
}

/**
 * Whether Details asks TMDB: the service has its key, and the profile left it
 * on. A kids profile always asks, since TMDB's rating decides what it plays,
 * and it has no setting to turn TMDB back on.
 */
export function useTmdbOn(): boolean {
  const service = useSyncExternalStore(serviceStatus.subscribe, () => serviceStatus.get().tmdb);
  const wanted = useSyncExternalStore(preferences.subscribe, () => preferences.get().tmdb);
  return service && (wanted || isKidsProfile());
}

/**
 * Whether Search asks TMDB: as Details does, once the service has Search's
 * routes. Home and Discover never ask it.
 */
export function useSearchTmdbOn(): boolean {
  const routes = useSyncExternalStore(serviceStatus.subscribe, () => serviceStatus.get().search);
  return useTmdbOn() && routes;
}

export interface TmdbAnswer {
  /** What TMDB adds, once it has answered and knows the title. */
  details?: TmdbDetails;
  /** TMDB has answered, failed, or is not asked: nothing more is coming. */
  settled: boolean;
}

/** TMDB's extras for a title on Details. */
export function useTmdbDetails(type: string, id: string): TmdbAnswer {
  const on = useTmdbOn();
  const query = useMemo(
    () => (on && (type === 'movie' || type === 'series') ? tmdbClient.details(type, id) : null),
    [on, type, id],
  );
  const state = useQuery(query);
  return {
    details: state.data ?? undefined,
    settled: query === null || state.status === 'success' || state.status === 'error',
  };
}
