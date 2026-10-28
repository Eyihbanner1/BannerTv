import { createStore, type Store } from './store';
import type { KeyValueStore } from './storage';

export interface RecentList extends Pick<Store<readonly string[]>, 'get' | 'subscribe'> {
  /** Reads the saved list. Terms added before it finishes stay first. */
  load(): Promise<void>;
  /** Puts a term first, once, whatever its case was before. */
  add(term: string): void;
  clear(): void;
}

function merge(first: readonly string[], then: readonly string[], max: number): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of first.concat(then)) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.slice(0, max);
}

/** A short most-recent-first list, such as recent searches, kept across launches. */
export function createRecentList(options: {
  storage: KeyValueStore;
  key: string;
  max: number;
}): RecentList {
  const { storage, key, max } = options;
  const state = createStore<readonly string[]>([]);
  // Saving before the saved list is read would overwrite it.
  let loaded = false;

  function save(terms: readonly string[]) {
    state.set(terms);
    if (loaded) storage.set(key, terms.slice()).catch(() => undefined);
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    async load() {
      let saved: unknown;
      try {
        saved = await storage.get(key);
      } catch {
        saved = undefined;
      }
      const terms = Array.isArray(saved)
        ? saved.filter((term): term is string => typeof term === 'string' && term.trim() !== '')
        : [];
      const added = state.get().length > 0;
      loaded = true;
      if (added) save(merge(state.get(), terms, max));
      else state.set(merge([], terms, max));
    },
    add(term) {
      const trimmed = term.trim();
      if (trimmed === '') return;
      save(merge([trimmed], state.get(), max));
    },
    clear() {
      save([]);
    },
  };
}
