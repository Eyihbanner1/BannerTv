import type { Query, QueryState } from '@bannertv/core';
import { useEffect, useSyncExternalStore } from 'react';

const IDLE: QueryState<never> = { status: 'idle', stale: false };
const noop = () => () => undefined;

/**
 * Reads a core query and loads it while the component is mounted, or while
 * `enabled` is true (rows far from the viewport wait). Pass null for nothing.
 */
export function useQuery<T>(query: Query<T> | null, enabled = true): QueryState<T> {
  const state = useSyncExternalStore(
    query ? query.subscribe : noop,
    query ? query.get : () => IDLE as QueryState<T>,
  );
  useEffect(() => {
    if (query && enabled) query.load();
  }, [query, enabled]);
  return state;
}
