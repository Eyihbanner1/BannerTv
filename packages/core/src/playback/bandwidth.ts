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

/**
 * Remembers how much data this TV's connection keeps up with, so auto-play
 * stops picking streams that buffer. Only a number is kept.
 */
export interface BandwidthMemory {
  /** Reads what was remembered. Safe to call more than once. */
  load(): Promise<void>;
  /** The highest average bitrate, in bits per second, expected to play without buffering. */
  maxBitrate(): number;
  /**
   * A stream of this average bitrate kept stopping to buffer. `ceiling` is
   * the limit before this stream raised it, if it did, so the raise is undone.
   */
  struggled(bitrate: number, ceiling?: number): void;
  /** A stream of this average bitrate played for a long while without buffering. */
  smooth(bitrate: number): void;
  /** Called whenever the limit changes. */
  subscribe(listener: Listener): () => void;
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

export function createBandwidthMemory(options: {
  storage: KeyValueStore;
  now?: () => number;
}): BandwidthMemory {
  const { storage, now = Date.now } = options;
  const state = createStore(DEFAULT_MAX_BITRATE);
  // What happened before the stored value was read, applied on top of it.
  const early: Array<(value: number) => number> = [];
  let loaded = false;
  let loading: Promise<void> | undefined;

  function save() {
    void Promise.resolve()
      .then(() => storage.set(STORAGE_KEY, { maxBitrate: state.get(), updatedAt: now() }))
      .catch(() => undefined);
  }

  function load(): Promise<void> {
    if (!loading) {
      // The limit as storage gives it, before any early change.
      let base = DEFAULT_MAX_BITRATE;
      loading = storage
        .get(STORAGE_KEY)
        .then((stored) => {
          const saved = stored as { maxBitrate?: unknown; updatedAt?: unknown } | null | undefined;
          const value = saved?.maxBitrate;
          if (typeof value !== 'number' || !isFinite(value)) return;
          base = recovered(clamp(value), saved?.updatedAt, now());
          let next = base;
          for (const change of early) next = change(next);
          state.set(next);
        })
        .catch(() => undefined)
        .then(() => {
          loaded = true;
          const moved = early.length > 0 && state.get() !== base;
          early.length = 0;
          if (moved) save();
        });
    }
    return loading;
  }

  function change(update: (value: number) => number) {
    const before = state.get();
    state.set(update(before));
    if (!loaded) {
      // Saved once loading has applied it to the stored limit.
      early.push(update);
      void load();
      return;
    }
    if (state.get() !== before) save();
  }

  return {
    load,
    maxBitrate: state.get,
    struggled(bitrate, ceiling) {
      const top = usable(ceiling) ? ceiling : Infinity;
      if (usable(bitrate)) change((current) => lowered(current, bitrate, top));
    },
    smooth(bitrate) {
      if (usable(bitrate)) change((current) => raised(current, bitrate));
    },
    subscribe: state.subscribe,
  };
}
