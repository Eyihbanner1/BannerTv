export type Listener = () => void;
export type Updater<S> = S | ((prev: S) => S);

/**
 * A minimal observable value. Screens read core state through
 * `useSyncExternalStore(store.subscribe, store.get)`, so `get` must return the
 * same reference until the state changes.
 */
export interface Store<S> {
  get(): S;
  set(next: Updater<S>): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: S) => S)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
