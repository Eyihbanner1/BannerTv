import { createTmdbClient, type TmdbDetails } from '@bannertv/core';
import { useMemo, useSyncExternalStore } from 'react';
import { fetchJson } from '../platform/http';
import { queryCache, requestLimiter } from './addons';
import { API_SERVICE, serviceStatus } from './api';
import { preferences } from './preferences';
import { useQuery } from './use-query';

/** TMDB through BannerTV's service, which adds the key. */
export const tmdbClient = createTmdbClient({
  baseUrl: `${API_SERVICE}/tmdb`,
  fetchJson,
  queries: queryCache,
  limiter: requestLimiter,
});

/** Whether Details asks TMDB: the service has its key, and the profile left it on. */
export function useTmdbOn(): boolean {
  const service = useSyncExternalStore(serviceStatus.subscribe, () => serviceStatus.get().tmdb);
  const wanted = useSyncExternalStore(preferences.subscribe, () => preferences.get().tmdb);
  return service && wanted;
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
