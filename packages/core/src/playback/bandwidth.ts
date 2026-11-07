import type { KeyValueStore } from '../storage';
import { createStore, type Listener } from '../store';
import { DEFAULT_MAX_BITRATE } from '../streams/bitrate';

const STORAGE_KEY = 'bandwidth';
/** Never lower: small 720p and SD files play on any connection that plays video at all. */
const FLOOR = 4e6;
/** Never higher, whatever a stream once managed. */
const LIMIT = 200e6;
/** After a stream kept buffering, the limit goes this far under its bitrate. */
const STRUGGLE_SHARE = 0.75;
/**
 * A lowered limit creeps back toward the default by this much each time a
 * stream close to it plays smoothly, and again for each full day that
 * passes, so one bad evening does not stick.
 */
const RECOVER_STEP = 1.25;
/** How close to the limit a smooth stream must be to lift it. */
const NEAR_SHARE = 0.5;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A debrid service as stream facts name it ("RD", "TB", "PKP"). Anything else counts as none. */
const SERVICE = /^[A-Za-z0-9]{1,8}$/;
/** The general limit's key; never a service code, which has no underscore. */
const GENERAL = '_';

/**
 * Remembers how much data this TV's connection keeps up with, so auto-play
 * stops picking streams that buffer. Only numbers are kept: one general
 * limit, and one for each debrid service whose links played (RD, TB …).
 *
 * Each service's servers keep up with their own rates: a 70 Mbit/s remux that
 * played smoothly from Real-Debrid says nothing about TorBox, and TorBox
 * buffering says nothing about Real-Debrid. So a service's links are judged by
 * its own limit. A service with no record yet starts from the general limit,
 * never above the default: a slow home connection holds for every service,
 * a fast service does not.
 */
export interface BandwidthMemory {
  /** Reads what was remembered. Safe to call more than once. */
  load(): Promise<void>;
  /**
   * The highest average bitrate, in bits per second, expected to play without
   * buffering: for links through `service`, when given, else in general.
   */
  maxBitrate(service?: string): number;
  /**
   * A stream of this average bitrate kept stopping to buffer. `ceiling` is
   * the limit before this stream raised it, if it did, so the raise is undone.
   * `service`: the debrid service its link went through, if any.
   */
  struggled(bitrate: number, ceiling?: number, service?: string): void;
  /** A stream of this average bitrate played for a long while without buffering. */
  smooth(bitrate: number, service?: string): void;
  /** Called whenever a limit changes. */
  subscribe(listener: Listener): () => void;
}

/** The limits in use: the general one and each service's own. Replaced whole on each change. */
interface Limits {
  general: number;
  services: ReadonlyMap<string, number>;
}

/** One limit as storage holds it. */
interface Saved {
  maxBitrate: number;
  updatedAt?: number;
}

function clamp(value: number): number {
  return Math.min(LIMIT, Math.max(FLOOR, value));
}

function lowered(current: number, bitrate: number, ceiling: number): number {
  return clamp(Math.min(current, ceiling, bitrate * STRUGGLE_SHARE));
}

function raised(current: number, bitrate: number): number {
  // Proof the connection does more than expected.
  if (bitrate > current) return clamp(bitrate);
  if (current < DEFAULT_MAX_BITRATE && bitrate >= current * NEAR_SHARE) {
    return clamp(Math.min(DEFAULT_MAX_BITRATE, current * RECOVER_STEP));
  }
  return current;
}

const usable = (bitrate: number | undefined): bitrate is number =>
  typeof bitrate === 'number' && isFinite(bitrate) && bitrate > 0;

/** A lowered limit, lifted for each full day since it was saved. */
function recovered(value: number, updatedAt: unknown, now: number): number {
  if (value >= DEFAULT_MAX_BITRATE || typeof updatedAt !== 'number' || !isFinite(updatedAt)) {
    return value;
  }
  const days = Math.min(30, Math.floor((now - updatedAt) / DAY_MS));
  let next = value;
  for (let day = 0; day < days && next < DEFAULT_MAX_BITRATE; day += 1) next *= RECOVER_STEP;
  return Math.min(DEFAULT_MAX_BITRATE, next);
}

/** A stored limit, or undefined when the value is not one. */
function readSaved(value: unknown): Saved | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { maxBitrate, updatedAt } = value as { maxBitrate?: unknown; updatedAt?: unknown };
  if (typeof maxBitrate !== 'number' || !isFinite(maxBitrate)) return undefined;
  return typeof updatedAt === 'number' && isFinite(updatedAt)
    ? { maxBitrate, updatedAt }
    : { maxBitrate };
}

function keyOf(service: string | undefined): string {
  return service !== undefined && SERVICE.test(service) ? service.toUpperCase() : GENERAL;
}

function limitOf(limits: Limits, key: string): number {
  if (key === GENERAL) return limits.general;
  const own = limits.services.get(key);
  return own !== undefined ? own : Math.min(limits.general, DEFAULT_MAX_BITRATE);
}

function withLimit(limits: Limits, key: string, value: number): Limits {
  if (limitOf(limits, key) === value && (key === GENERAL || limits.services.has(key))) {
    return limits;
  }
  if (key === GENERAL) return { general: value, services: limits.services };
  const services = new Map(limits.services);
  services.set(key, value);
  return { general: limits.general, services };
}

function sameLimits(a: Limits, b: Limits): boolean {
  if (a.general !== b.general || a.services.size !== b.services.size) return false;
  let same = true;
  a.services.forEach((value, key) => {
    if (b.services.get(key) !== value) same = false;
  });
  return same;
}

interface Change {
  key: string;
  update: (value: number) => number;
}

export function createBandwidthMemory(options: {
  storage: KeyValueStore;
  now?: () => number;
}): BandwidthMemory {
  const { storage, now = Date.now } = options;
  const state = createStore<Limits>({ general: DEFAULT_MAX_BITRATE, services: new Map() });
  // Each limit as storage holds it, so one that did not change is written back exactly as it
  // was and its days keep counting from its own save.
  const saved = new Map<string, Saved>();
  // What happened before the stored values were read, applied on top of them.
  const early: Change[] = [];
  let loaded = false;
  let loading: Promise<void> | undefined;

  function save() {
    const general = saved.get(GENERAL) ?? { maxBitrate: state.get().general, updatedAt: now() };
    const record: { maxBitrate: number; updatedAt?: number; services?: Record<string, Saved> } = {
      ...general,
    };
    const services: Record<string, Saved> = {};
    let any = false;
    saved.forEach((value, key) => {
      if (key === GENERAL) return;
      services[key] = value;
      any = true;
    });
    if (any) record.services = services;
    void Promise.resolve()
      .then(() => storage.set(STORAGE_KEY, record))
      .catch(() => undefined);
  }

  /** Applies a change to the limits in `from`, noting what storage should now hold. */
  function apply(from: Limits, change: Change): Limits {
    const before = limitOf(from, change.key);
    const after = change.update(before);
    if (after === before) return from;
    saved.set(change.key, { maxBitrate: after, updatedAt: now() });
    return withLimit(from, change.key, after);
  }

  function load(): Promise<void> {
    if (!loading) {
      // The limits as storage gives them, before any early change.
      let base: Limits = { general: DEFAULT_MAX_BITRATE, services: new Map() };
      loading = storage
        .get(STORAGE_KEY)
        .then((stored) => {
          // Early changes noted what they would store against the defaults; they are applied
          // again below, against what storage holds.
          saved.clear();
          const time = now();
          const general = readSaved(stored);
          const services = new Map<string, number>();
          const savedServices = (stored as { services?: unknown } | null | undefined)?.services;
          if (savedServices && typeof savedServices === 'object') {
            for (const name of Object.keys(savedServices)) {
              const key = keyOf(name);
              const limit = readSaved((savedServices as Record<string, unknown>)[name]);
              if (key === GENERAL || !limit) continue;
              saved.set(key, limit);
              services.set(key, recovered(clamp(limit.maxBitrate), limit.updatedAt, time));
            }
          }
          if (general) saved.set(GENERAL, general);
          base = {
            general: general
              ? recovered(clamp(general.maxBitrate), general.updatedAt, time)
              : DEFAULT_MAX_BITRATE,
            services,
          };
          const next = early.reduce(apply, base);
          state.set(sameLimits(next, state.get()) ? state.get() : next);
        })
        .catch(() => {
          // Nothing could be read: the early changes stand as made, against the defaults.
          saved.clear();
          early.reduce(apply, base);
        })
        .then(() => {
          loaded = true;
          const moved = early.length > 0 && !sameLimits(state.get(), base);
          early.length = 0;
          if (moved) save();
        });
    }
    return loading;
  }

  function change(key: string, update: (value: number) => number) {
    const before = state.get();
    const next = apply(before, { key, update });
    state.set(next);
    if (!loaded) {
      // Saved once loading has applied it to the stored limits.
      early.push({ key, update });
      void load();
      return;
    }
    if (next !== before) save();
  }

  return {
    load,
    maxBitrate: (service) => limitOf(state.get(), keyOf(service)),
    struggled(bitrate, ceiling, service) {
      const top = usable(ceiling) ? ceiling : Infinity;
      if (usable(bitrate)) change(keyOf(service), (current) => lowered(current, bitrate, top));
    },
    smooth(bitrate, service) {
      if (usable(bitrate)) change(keyOf(service), (current) => raised(current, bitrate));
    },
    subscribe: state.subscribe,
  };
}
