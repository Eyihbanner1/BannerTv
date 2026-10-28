import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';

const KEY = 'traktWatched';
/** Enough for a long Trakt history; ids are short. */
export const MAX_WATCHED = 50000;

/**
 * What Trakt says a profile has watched, by video id: a film's id, or an
 * episode's `{imdbId}:{season}:{episode}`. Replaced whole at each sync.
 * Videos watched on this TV are marked by their saved progress instead.
 */
export interface WatchedSet {
  load(): Promise<void>;
  has(videoId: string): boolean;
  replace(videoIds: readonly string[]): Promise<void>;
  /** Bumps on every change. */
  version(): number;
  subscribe(listener: Listener): () => void;
}

export function createWatchedSet(options: { storage: KeyValueStore }): WatchedSet {
  const state = createPersisted<readonly string[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: (saved) =>
      Array.isArray(saved)
        ? saved
            .filter((id): id is string => typeof id === 'string' && id !== '')
            .slice(0, MAX_WATCHED)
        : [],
    write: (ids) => ids.slice(),
  });
  let changes = 0;
  let set = new Set<string>();
  let setOf: readonly string[] | null = null;
  state.subscribe(() => {
    changes += 1;
  });

  return {
    load: state.load,
    has(videoId) {
      const ids = state.get();
      if (setOf !== ids) {
        set = new Set(ids);
        setOf = ids;
      }
      return set.has(videoId);
    },
    replace(videoIds) {
      return state.update((current) => {
        const next = Array.from(new Set(videoIds)).slice(0, MAX_WATCHED);
        const same =
          next.length === current.length && next.every((id, index) => id === current[index]);
        return same ? current : next;
      });
    },
    version: () => changes,
    subscribe: state.subscribe,
  };
}
