/** A store the Library screen follows: told of each change, with a count of its changes. */
export interface Versioned {
  subscribe(listener: () => void): () => void;
  version(): number;
}

export interface Watch {
  subscribe(listener: () => void): () => void;
  /** Changes whenever one of the followed stores changes. */
  version(): string;
}

/**
 * What one view of the Library screen follows, for useSyncExternalStore. My List is drawn from
 * the list alone, so it follows the list alone: a video saving its place every 10 seconds then
 * leaves My List as it is. History also follows progress and the played cards.
 */
export function libraryWatch(
  show: 'list' | 'history',
  list: Versioned,
  history: readonly Versioned[],
): Watch {
  const stores = show === 'list' ? [list] : [list, ...history];
  return {
    subscribe(listener) {
      const undo = stores.map((store) => store.subscribe(listener));
      return () => undo.forEach((stop) => stop());
    },
    version: () => `${show}:${stores.map((store) => store.version()).join(':')}`,
  };
}
