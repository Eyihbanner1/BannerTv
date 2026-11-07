import { addonBaseUrl } from '@bannertv/protocol';
import { type FetchJson, HttpError } from '../http';
import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import { type InstalledAddon, installIdOf } from './collection';

const STORAGE_KEY = 'addon-health';
/** Installs remembered at most: far more than anyone installs, so a bad save cannot grow. */
const MAX_INSTALLS = 100;

/**
 * An answer that took more than this share of the time BannerTV gives the
 * request is slow: 5 seconds of a catalog's or a manifest's 10, 7.5 of a
 * stream list's 15. A healthy addon answers in a second or two, and one
 * that needs half its time makes Home and Play wait where people see it.
 * Measured from when the request leaves, not from when it joined the queue.
 */
export const SLOW_SHARE = 0.5;

/**
 * How an addon answered: in good time, slowly, or not at all (no answer, a
 * time-out, a server error or something that is not JSON).
 */
export type AddonHealthState = 'fine' | 'slow' | 'failed';

export interface AddonHealth {
  state: AddonHealthState;
  /**
   * When it began answering this way, in ms since 1970: for `failed`, the
   * first failure in a row, which "Not answering since 14:05" shows.
   */
  since: number;
}

/** By install name (installIdOf), never by address, which can hold keys. */
export type AddonHealthMap = ReadonlyMap<string, AddonHealth>;

/**
 * Each install's latest answer, kept on this screen only (it says how this
 * screen's network reaches the addon, so it never syncs). Only a change of
 * state is told and saved: a run of good answers writes nothing.
 */
export interface AddonHealthStore {
  /** Reads what was saved. Answers noted before it finishes are laid over it. */
  load(): Promise<void>;
  /** A new map whenever a state changes. */
  get(): AddonHealthMap;
  subscribe(listener: () => void): () => void;
  /** One answer from an install. Any answer clears a failure. */
  note(installId: string, state: AddonHealthState): void;
  /** Forgets installs that were removed. */
  forget(installIds: readonly string[]): void;
}

const STATES: readonly AddonHealthState[] = ['fine', 'slow', 'failed'];

function readHealth(saved: unknown): AddonHealthMap {
  const map = new Map<string, AddonHealth>();
  if (!Array.isArray(saved)) return map;
  for (const row of saved.slice(-MAX_INSTALLS)) {
    if (!Array.isArray(row)) continue;
    const [id, state, since] = row as unknown[];
    if (typeof id !== 'string' || id === '' || typeof since !== 'number' || !isFinite(since)) {
      continue;
    }
    if (STATES.indexOf(state as AddonHealthState) === -1) continue;
    map.set(id, { state: state as AddonHealthState, since });
  }
  return map;
}

function writeHealth(map: AddonHealthMap): Array<[string, AddonHealthState, number]> {
  const rows: Array<[string, AddonHealthState, number]> = [];
  map.forEach((health, id) => rows.push([id, health.state, health.since]));
  return rows.slice(-MAX_INSTALLS);
}

export function createAddonHealth(options: {
  storage: KeyValueStore;
  /** The wall clock, for "since". */
  now?: () => number;
}): AddonHealthStore {
  const { now = Date.now } = options;
  const saved = createPersisted<AddonHealthMap>({
    storage: options.storage,
    key: STORAGE_KEY,
    initial: new Map(),
    read: readHealth,
    write: writeHealth,
  });
  // Before the saved map is read, a change waits for it (Persisted.updateNow), so an answer
  // noted at launch is laid over what was saved, and a failure already saved keeps its time.
  const change = (edit: (map: Map<string, AddonHealth>) => boolean) => {
    void saved
      .updateNow((current) => {
        const next = new Map(current);
        return edit(next) ? next : current;
      })
      .catch(() => undefined);
  };

  return {
    load: saved.load,
    get: saved.get,
    subscribe: saved.subscribe,
    note(installId, state) {
      const at = now();
      change((map) => {
        if (map.get(installId)?.state === state) return false;
        map.set(installId, { state, since: at });
        return true;
      });
    },
    forget(installIds) {
      change((map) => {
        let changed = false;
        for (const id of installIds) changed = map.delete(id) || changed;
        return changed;
      });
    },
  };
}

/**
 * What one request says about its addon: undefined when it says nothing, as
 * an answer with a 4xx status does (an addon that does not know one title,
 * or refuses one request, is still answering).
 */
export function answerState(
  error: unknown,
  elapsedMs: number,
  timeoutMs: number,
): AddonHealthState | undefined {
  if (error === undefined) return elapsedMs > timeoutMs * SLOW_SHARE ? 'slow' : 'fine';
  if (error instanceof HttpError && error.kind === 'status') {
    return (error.status ?? 0) >= 500 ? 'failed' : undefined;
  }
  return 'failed';
}

/**
 * The install a request URL goes to: the one whose address, or whose base
 * with a path after it, the URL starts with. The longest base wins, so an
 * addon at `/a` is not taken for one at `/ab`.
 */
export function installForUrl(
  addons: readonly InstalledAddon[],
  url: string,
): InstalledAddon | undefined {
  let found: InstalledAddon | undefined;
  let length = -1;
  for (const addon of addons) {
    const base = addonBaseUrl(addon.transportUrl);
    if (base.length <= length) continue;
    if (url === addon.transportUrl || url.indexOf(`${base}/`) === 0) {
      found = addon;
      length = base.length;
    }
  }
  return found;
}

/**
 * Wraps a FetchJson so that every request to an installed addon notes how
 * the addon answered, and otherwise changes nothing: the answer, the error
 * and the timing are the request's own. The URL is only compared, never kept.
 */
export function observeAnswers(
  fetchJson: FetchJson,
  options: {
    /** The install a request goes to, or undefined for anything else (TMDB, a new addon). */
    installOf: (url: string) => string | undefined;
    note: (installId: string, state: AddonHealthState) => void;
    /** A clock that does not jump when the TV sets its time, for how long requests take. */
    elapsed?: () => number;
  },
): FetchJson {
  const { installOf, note, elapsed = Date.now } = options;
  return async (url, request) => {
    const id = installOf(url);
    if (id === undefined) return fetchJson(url, request);
    const started = elapsed();
    let value: unknown;
    try {
      value = await fetchJson(url, request);
    } catch (error) {
      const state = answerState(error, elapsed() - started, request.timeoutMs);
      if (state) note(id, state);
      throw error;
    }
    note(id, answerState(undefined, elapsed() - started, request.timeoutMs)!);
    return value;
  };
}

/** The install name observeAnswers needs, from the collection as it is now. */
export function installIdForUrl(
  addons: readonly InstalledAddon[],
  url: string,
): string | undefined {
  const addon = installForUrl(addons, url);
  return addon ? installIdOf(addon) : undefined;
}
