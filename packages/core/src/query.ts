import type { CacheHints } from '@bannertv/protocol';
import type { Listener } from './store';
import type { CacheRecord, CacheStore } from './storage';

const SECOND = 1000;

/** How long a response stays usable, in milliseconds. See CacheRecord. */
export interface CachePolicy {
  freshFor: number;
  revalidateFor: number;
  errorFor: number;
}

/** An addon's own cacheMaxAge, staleRevalidate and staleError win over the defaults. */
export function policyFromHints(hints: CacheHints, defaults: CachePolicy): CachePolicy {
  return {
    freshFor: hints.cacheMaxAge !== undefined ? hints.cacheMaxAge * SECOND : defaults.freshFor,
    revalidateFor:
      hints.staleRevalidate !== undefined ? hints.staleRevalidate * SECOND : defaults.revalidateFor,
    errorFor: hints.staleError !== undefined ? hints.staleError * SECOND : defaults.errorFor,
  };
}

type Phase = 'fresh' | 'revalidate' | 'error-only' | 'expired';

function phaseOf(record: CacheRecord, now: number): Phase {
  const age = now - record.storedAt;
  if (age < 0) return 'revalidate'; // the clock went back: use it, but check again
  if (age < record.freshFor) return 'fresh';
  if (age < record.freshFor + record.revalidateFor) return 'revalidate';
  if (age < record.freshFor + record.revalidateFor + record.errorFor) return 'error-only';
  return 'expired';
}

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QueryState<T> {
  status: QueryStatus;
  data?: T;
  error?: Error;
  /** The data is an older copy, shown while (or because) a fresh one could not be had. */
  stale: boolean;
}

export interface QueryResult<T> {
  value: T;
  hints: CacheHints;
}

/** One cached request. Screens read it through useSyncExternalStore and call load() when shown. */
export interface Query<T> {
  get(): QueryState<T>;
  subscribe(listener: Listener): () => void;
  /** Fetches unless a fresh copy is already here or a fetch is running. */
  load(): void;
  /** Fetches again even when the copy is fresh, for "Try again". */
  retry(): void;
}

export interface QueryOptions<T> {
  fetch: () => Promise<QueryResult<T>>;
  policy: CachePolicy;
  /** Also keep the response across launches in the CacheStore. */
  persist: boolean;
  /**
   * An answer equal to the copy on screen keeps that copy's objects, and one
   * that changed keeps those of its parts that did not (keepEqual), so what
   * draws it has nothing to do again. When that leaves the state as it was,
   * subscribers are not told. Off for readers that take a new data object as
   * news that an answer came, as the sports feed and the sports readings of
   * Discover and Search do: they read kick-offs again as of then.
   */
  keepEqual?: boolean;
}

export interface QueryCache {
  /** The query for `key`, created on first use. Later calls with the same key share it. */
  query<T>(key: string, options: QueryOptions<T>): Query<T>;
}

interface Entry {
  query: Query<unknown>;
  listeners: Set<Listener>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function idOf(value: unknown): string | undefined {
  return isPlain(value) && typeof value.id === 'string' ? value.id : undefined;
}

function shareList(prev: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  let same = prev.length === next.length;
  let copy: unknown[] | undefined;
  let byId: Map<string, unknown> | undefined;
  for (let i = 0; i < next.length; i++) {
    const value = next[i];
    const id = idOf(value);
    let has = i < prev.length;
    let old = prev[i];
    // An item that moved is found by its id: a list with one title more keeps the rest.
    if (id !== undefined && idOf(old) !== id) {
      if (!byId) {
        byId = new Map();
        for (const item of prev) {
          const key = idOf(item);
          if (key !== undefined && !byId.has(key)) byId.set(key, item);
        }
      }
      has = byId.has(id);
      old = byId.get(id);
    }
    const kept = has ? share(old, value) : value;
    if (same && !Object.is(kept, prev[i])) same = false;
    if (!copy && !Object.is(kept, value)) copy = next.slice(0, i);
    if (copy) copy.push(kept);
  }
  return same ? prev : (copy ?? next);
}

function shareRecord(prev: Plain, next: Plain): Plain {
  const keys = Object.keys(next);
  const prevKeys = Object.keys(prev);
  let same = keys.length === prevKeys.length;
  let copy: Plain | undefined;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    // Assigning it would set the copy's prototype instead.
    if (key === '__proto__') return next;
    const value = next[key];
    const kept = Object.prototype.hasOwnProperty.call(prev, key) ? share(prev[key], value) : value;
    if (same && (prevKeys[i] !== key || !Object.is(kept, prev[key]))) same = false;
    if (!copy && !Object.is(kept, value)) {
      copy = {};
      for (let j = 0; j < i; j++) copy[keys[j]!] = next[keys[j]!];
    }
    if (copy) copy[key] = kept;
  }
  return same ? prev : (copy ?? next);
}

function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) return shareList(prev, next);
  if (isPlain(prev) && isPlain(next)) return shareRecord(prev, next);
  return next;
}

/**
 * `next`, with every part equal to the same part of `prev` swapped for prev's
 * own object, so `prev` itself when all of it is equal. Only arrays and plain
 * objects are looked into, their keys in the same order, and an array's items
 * are matched by place or else by their `id`. Anything else is equal only to
 * itself. Neither value is changed.
 */
export function keepEqual<T>(prev: unknown, next: T): T {
  return share(prev, next) as T;
}

/**
 * Two cache tiers: an in-memory LRU of queries for this session, and the
 * CacheStore (IndexedDB) across launches. The webOS engine clears its HTTP
 * cache when the app closes, so the store is what makes the second launch fast.
 */
export function createQueryCache(
  options: { store?: CacheStore; now?: () => number; maxEntries?: number } = {},
): QueryCache {
  const { store, now = Date.now, maxEntries = 200 } = options;
  const entries = new Map<string, Entry>();

  function evict() {
    if (entries.size <= maxEntries) return;
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) break;
      if (entry.listeners.size === 0) entries.delete(key);
    }
  }

  function create<T>(key: string, opts: QueryOptions<T>): Entry {
    const listeners = new Set<Listener>();
    let state: QueryState<T> = { status: 'idle', stale: false };
    let record: CacheRecord | undefined;
    let readStore = !opts.persist || store === undefined;
    let running = false;

    function set(next: QueryState<T>) {
      state = next;
      listeners.forEach((listener) => listener());
    }

    async function run(force: boolean) {
      running = true;
      try {
        if (!readStore) {
          readStore = true;
          try {
            record = await store!.read(key);
          } catch {
            record = undefined;
          }
        }
        const phase = record ? phaseOf(record, now()) : 'expired';
        if (record && !force && phase === 'fresh') {
          set({ status: 'success', data: record.value as T, stale: false });
          return;
        }
        if (record && (phase === 'fresh' || phase === 'revalidate')) {
          // Show what we have at once and refresh behind it.
          if (state.data !== record.value)
            set({ status: 'success', data: record.value as T, stale: true });
        } else {
          set({ status: 'loading', stale: false });
        }

        try {
          const result = await opts.fetch();
          const value = opts.keepEqual ? keepEqual(state.data, result.value) : result.value;
          record = {
            value,
            storedAt: now(),
            ...policyFromHints(result.hints, opts.policy),
          };
          // An equal answer kept as it was, on a copy already shown as fresh: nothing to tell.
          const shown =
            opts.keepEqual === true &&
            state.status === 'success' &&
            state.data === value &&
            !state.stale &&
            state.error === undefined;
          if (!shown) set({ status: 'success', data: value, stale: false });
          if (opts.persist && store) store.write(key, record).catch(() => undefined);
        } catch (error) {
          if (record && phaseOf(record, now()) !== 'expired') {
            set({ status: 'success', data: record.value as T, error: toError(error), stale: true });
          } else {
            set({ status: 'error', error: toError(error), stale: false });
          }
        }
      } finally {
        running = false;
      }
    }

    const query: Query<T> = {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      load() {
        if (running) return;
        if (state.status === 'success' && record && phaseOf(record, now()) === 'fresh') return;
        void run(false);
      },
      retry() {
        if (!running) void run(true);
      },
    };
    return { query: query as Query<unknown>, listeners };
  }

  return {
    query<T>(key: string, opts: QueryOptions<T>): Query<T> {
      let entry = entries.get(key);
      if (entry) {
        // Most recently used goes last.
        entries.delete(key);
      } else {
        entry = create(key, opts);
      }
      entries.set(key, entry);
      evict();
      return entry.query as Query<T>;
    },
  };
}
