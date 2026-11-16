import { HttpError } from '../../http';
import type { CachePolicy, Query, QueryCache, QueryState } from '../../query';
import type { SubdlKeyRecord } from './key';
import { classifySubdlAnswer, type SubdlFailure, type SubdlFile } from './parse';
import {
  type SubdlAsk,
  subdlAskFor,
  subdlCacheKey,
  subdlKeyCheckRequest,
  type SubdlRoute,
  subdlSearchRequest,
  type SubdlSkip,
} from './request';
import type { SubdlUsage } from './usage';

/**
 * SubDL as a second source of subtitle files, asked once per play with the
 * viewer's own key (ADR 0003, step D). Answers are kept a day, and an older
 * one stands in for a week while SubDL fails or rests. Nothing here ever
 * holds the video back: a search that has not answered in SUBDL_SEARCH_MS
 * is over for the play, and an answer after that only goes into the cache.
 */

/** How long a play waits for SubDL's answer. */
export const SUBDL_SEARCH_MS = 8000;
/** The same ask that failed is not sent again for this long in a session. */
export const SUBDL_FAILURE_MEMORY_MS = 10 * 60 * 1000;
const KEY_CHECK_MS = 10_000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A day fresh, then an older copy only while SubDL fails or rests, for a week. */
export const SUBDL_POLICY: CachePolicy = { freshFor: DAY, revalidateFor: 0, errorFor: 7 * DAY };

/** GET with headers; resolves on any status, rejects only HttpError('network' | 'timeout'). */
export type SubdlHttp = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<{ status: number; body: unknown }>;

export type SubdlOff = 'no key' | 'kids' | 'key refused' | SubdlSkip | 'resting' | 'daily limit';

export type SubdlSearchState =
  /** Not asked; `files` is an older saved answer used meanwhile. */
  | { status: 'off'; why: SubdlOff; files?: readonly SubdlFile[] }
  | { status: 'asking' }
  | { status: 'answered'; files: readonly SubdlFile[]; ms: number; saved: boolean }
  | { status: 'failed'; why: SubdlFailure; ms: number; files?: readonly SubdlFile[] };

export interface SubdlSearch {
  get(): SubdlSearchState;
  subscribe(listener: () => void): () => void;
  load(): void;
  stop(): void;
  /** The SubDL codes asked, empty when it is not asked. */
  languages: readonly string[];
}

export interface SubdlClient {
  search(type: string, videoId: string, wanted: readonly string[]): SubdlSearch;
  /** One request that counts no search: SubDL accepts the key, refuses it, or cannot be asked. */
  checkKey(key: string): Promise<'works' | 'refused' | 'unreachable'>;
}

/** Why a search was not sent. Its message is fixed text. */
export class SubdlSkipError extends Error {
  readonly why: SubdlOff;

  constructor(why: SubdlOff) {
    super(`SubDL was not asked: ${why}`);
    this.name = 'SubdlSkipError';
    this.why = why;
  }
}

/** How SubDL failed. Its message is fixed text: never a link or a key. */
export class SubdlFailureError extends Error {
  readonly failure: SubdlFailure;

  constructor(failure: SubdlFailure) {
    super(`SubDL answered: ${failure}`);
    this.name = 'SubdlFailureError';
    this.failure = failure;
  }
}

export interface SubdlClientOptions {
  http: SubdlHttp;
  queries: QueryCache;
  usage: SubdlUsage;
  key: () => SubdlKeyRecord | null;
  /** What SubDL said of a key: only for that key, never one saved since. */
  setKeyState: (key: string, state: SubdlKeyRecord['state']) => void;
  kidsOnly: () => boolean;
  /** Resolves once the key has been read; the search's fetch waits for it. */
  ready?: () => Promise<void>;
  /** Runs the request in its turn among the app's (the play's go first). */
  run?: <T>(type: string, videoId: string, task: () => Promise<T>) => Promise<T>;
  /** A clock that does not jump, for how long an answer took. */
  elapsed?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  route?: SubdlRoute;
}

// The core is typed without a platform; every engine it runs on has these.
declare const setTimeout: (callback: () => void, ms: number) => unknown;
declare const clearTimeout: (timer: unknown) => void;
declare const performance: { now(): number } | undefined;

const direct = <T>(_type: string, _videoId: string, task: () => Promise<T>) => task();

export function createSubdlClient(options: SubdlClientOptions): SubdlClient {
  const {
    http,
    queries,
    usage,
    key,
    setKeyState,
    kidsOnly,
    ready,
    run = direct,
    elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (timer) => clearTimeout(timer),
    route,
  } = options;
  // The asks that failed this session, and when, by their cache key (a refusal is the key's).
  const failures = new Map<string, { failure: SubdlFailure; at: number }>();
  // Fetches started for each cache key, and those running, to tell a saved answer.
  const started = new Map<string, number>();
  const running = new Set<string>();

  function remember(cacheKey: string, failure: SubdlFailure): SubdlFailureError {
    failures.set(cacheKey, { failure, at: elapsed() });
    return new SubdlFailureError(failure);
  }

  async function fetchAnswer(type: string, videoId: string, ask: SubdlAsk, cacheKey: string) {
    started.set(cacheKey, (started.get(cacheKey) ?? 0) + 1);
    running.add(cacheKey);
    try {
      if (ready) await ready();
      const record = key();
      if (kidsOnly()) throw new SubdlSkipError('kids');
      if (!record) throw new SubdlSkipError('no key');
      if (record.state === 'refused') throw new SubdlSkipError('key refused');
      await usage.load();
      // A rest until SubDL's day turns says so: the searches are used up.
      const rest = usage.resting();
      if (rest) throw new SubdlSkipError(rest.why === 'limit' ? 'daily limit' : 'resting');
      const failed = failures.get(cacheKey);
      if (failed && elapsed() - failed.at < SUBDL_FAILURE_MEMORY_MS) {
        throw new SubdlFailureError(failed.failure);
      }
      if (!usage.takeSearch()) throw new SubdlSkipError('daily limit');
      const request = subdlSearchRequest(ask, record.key, route);
      let answer: { status: number; body: unknown };
      try {
        answer = await run(type, videoId, () =>
          http(request.url, { headers: request.headers, timeoutMs: SUBDL_SEARCH_MS }),
        );
      } catch (error) {
        const failure: SubdlFailure =
          error instanceof HttpError && error.kind === 'timeout' ? 'timeout' : 'network';
        usage.failed();
        throw remember(cacheKey, failure);
      }
      const outcome = classifySubdlAnswer(answer.status, answer.body, ask);
      if ('files' in outcome) {
        usage.succeeded();
        failures.delete(cacheKey);
        return { value: outcome.files, hints: {} };
      }
      const failure = outcome.failure;
      // A refusal is the key's, not the ask's: the key's state stops the
      // searches, and a key saved since is asked with straight away.
      if (failure === 'refused') {
        setKeyState(record.key, 'refused');
        throw new SubdlFailureError(failure);
      }
      if (failure === 'limit') usage.rest('limit');
      else if (failure === 'busy') usage.rest('busy');
      else usage.failed();
      throw remember(cacheKey, failure);
    } finally {
      running.delete(cacheKey);
    }
  }

  function offSearch(why: SubdlOff, languages: readonly string[] = []): SubdlSearch {
    const state: SubdlSearchState = { status: 'off', why };
    return {
      get: () => state,
      subscribe: () => () => undefined,
      load: () => undefined,
      stop: () => undefined,
      languages,
    };
  }

  function search(type: string, videoId: string, wanted: readonly string[]): SubdlSearch {
    if (kidsOnly()) return offSearch('kids');
    const record = key();
    if (!record) return offSearch('no key');
    if (record.state === 'refused') return offSearch('key refused');
    const asked = subdlAskFor(type, videoId, wanted);
    if ('skip' in asked) return offSearch(asked.skip);
    const ask = asked;
    const cacheKey = subdlCacheKey(ask);
    const listeners = new Set<() => void>();
    let state: SubdlSearchState = { status: 'asking' };
    let query: Query<SubdlFile[]> | undefined;
    let unsubscribe: (() => void) | undefined;
    let timer: unknown;
    let startedAt = 0;
    let startsAtLoad = 0;
    let runningAtLoad = false;
    // Past the deadline: this search's state no longer follows the query.
    let over = false;

    function set(next: SubdlSearchState) {
      state = next;
      listeners.forEach((listener) => listener());
    }

    function stateOf(current: QueryState<SubdlFile[]>): SubdlSearchState {
      const ms = Math.round(elapsed() - startedAt);
      const error = current.error;
      if (current.status === 'success' && !error) {
        const saved = !runningAtLoad && (started.get(cacheKey) ?? 0) === startsAtLoad;
        return { status: 'answered', files: current.data ?? [], ms, saved };
      }
      if (current.status === 'success' || current.status === 'error') {
        const files = current.status === 'success' ? current.data : undefined;
        if (error instanceof SubdlSkipError) {
          return { status: 'off', why: error.why, ...(files && { files }) };
        }
        const why = error instanceof SubdlFailureError ? error.failure : 'invalid';
        return { status: 'failed', why, ms, ...(files && { files }) };
      }
      return { status: 'asking' };
    }

    function follow() {
      if (over || !query) return;
      const next = stateOf(query.get());
      if (next.status === 'asking' && state.status === 'asking') return;
      if (next.status !== 'asking') {
        over = true;
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
      }
      set(next);
    }

    return {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      load() {
        if (query) return;
        startedAt = elapsed();
        startsAtLoad = started.get(cacheKey) ?? 0;
        runningAtLoad = running.has(cacheKey);
        timer = setTimer(() => {
          timer = undefined;
          if (over) return;
          over = true;
          set({ status: 'failed', why: 'timeout', ms: SUBDL_SEARCH_MS });
        }, SUBDL_SEARCH_MS);
        query = queries.query<SubdlFile[]>(cacheKey, {
          persist: true,
          policy: SUBDL_POLICY,
          keepEqual: true,
          fetch: () => fetchAnswer(type, videoId, ask, cacheKey),
        });
        unsubscribe = query.subscribe(follow);
        query.load();
        follow();
      },
      stop() {
        unsubscribe?.();
        unsubscribe = undefined;
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        over = true;
      },
      languages: ask.languages,
    };
  }

  async function checkKey(candidate: string): Promise<'works' | 'refused' | 'unreachable'> {
    const request = subdlKeyCheckRequest(candidate);
    try {
      const { status, body } = await http(request.url, {
        headers: request.headers,
        timeoutMs: KEY_CHECK_MS,
      });
      if (status === 200) return 'works';
      if (status === 401) return 'refused';
      if (status === 403 && typeof body === 'object' && body !== null) return 'refused';
      return 'unreachable';
    } catch {
      return 'unreachable';
    }
  }

  return { search, checkKey };
}
