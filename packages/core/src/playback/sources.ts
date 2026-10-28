import type { KeyValueStore } from '../storage';

const STORAGE_KEY = 'sources';
/** Counts are halved past this, so an addon that has improved (or got worse) is noticed. */
const MAX_COUNT = 20;
const MAX_ADDONS = 100;

interface Tally {
  worked: number;
  failed: number;
  updatedAt: number;
}

/**
 * Remembers which addons' streams played and which failed, so auto-play can
 * favour sources that have worked on this TV. Only addon manifest ids are
 * kept, never stream links (they can carry account keys).
 */
export interface SourceMemory {
  /** Reads what was remembered. Safe to call more than once. */
  load(): Promise<void>;
  /** A stream from this addon played for a while (true), or failed to start or stalled (false). */
  record(addonId: string, worked: boolean): void;
  /** 0 to 1: how likely this addon's streams are to work, 0.5 when nothing is known. */
  score(addonId: string): number;
}

function readTally(value: unknown): Tally | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { worked, failed, updatedAt } = value as Record<string, unknown>;
  const counts = [worked, failed, updatedAt];
  if (!counts.every((n) => typeof n === 'number' && isFinite(n) && n >= 0)) return undefined;
  return { worked: worked as number, failed: failed as number, updatedAt: updatedAt as number };
}

function add(a: Tally, b: Tally): Tally {
  return {
    worked: a.worked + b.worked,
    failed: a.failed + b.failed,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

function halve(tally: Tally): Tally {
  while (tally.worked + tally.failed > MAX_COUNT) {
    tally.worked /= 2;
    tally.failed /= 2;
  }
  return tally;
}

export function createSourceMemory(options: {
  storage: KeyValueStore;
  now?: () => number;
}): SourceMemory {
  const { storage, now = Date.now } = options;
  const tallies = new Map<string, Tally>();
  let loading: Promise<void> | undefined;
  let writing = false;
  let dirty = false;

  function load(): Promise<void> {
    if (!loading) {
      loading = storage
        .get(STORAGE_KEY)
        .then((stored) => {
          if (typeof stored !== 'object' || stored === null) return;
          const loaded = new Map<string, Tally>();
          for (const id of Object.keys(stored)) {
            const tally = readTally((stored as Record<string, unknown>)[id]);
            if (!tally) continue;
            // Results recorded while loading add to what earlier launches saw.
            const early = tallies.get(id);
            loaded.set(id, early ? halve(add(tally, early)) : tally);
          }
          // Early results stay the most recent.
          tallies.forEach((tally, id) => {
            if (!loaded.has(id)) loaded.set(id, tally);
          });
          tallies.clear();
          loaded.forEach((tally, id) => tallies.set(id, tally));
          trim();
        })
        .catch(() => undefined);
    }
    return loading;
  }

  function trim() {
    while (tallies.size > MAX_ADDONS) {
      let oldest: string | undefined;
      tallies.forEach((t, id) => {
        if (oldest === undefined || t.updatedAt < tallies.get(oldest)!.updatedAt) oldest = id;
      });
      if (oldest === undefined) return;
      tallies.delete(oldest);
    }
  }

  // Writes wait for the stored copy to be merged in, or a record made early
  // would replace everything remembered from earlier launches.
  function write() {
    if (writing) {
      dirty = true;
      return;
    }
    writing = true;
    dirty = false;
    void load()
      .then(() => {
        const value: Record<string, Tally> = {};
        tallies.forEach((tally, id) => (value[id] = { ...tally }));
        return storage.set(STORAGE_KEY, value);
      })
      .catch(() => undefined)
      .then(() => {
        writing = false;
        if (dirty) write();
      });
  }

  return {
    load,

    record(addonId, worked) {
      const tally = tallies.get(addonId) ?? { worked: 0, failed: 0, updatedAt: 0 };
      if (worked) tally.worked++;
      else tally.failed++;
      halve(tally);
      tally.updatedAt = now();
      tallies.delete(addonId);
      tallies.set(addonId, tally);
      trim();
      write();
    },

    score(addonId) {
      const tally = tallies.get(addonId);
      // Laplace's rule: one imagined success and one failure keep a single result from deciding.
      return tally ? (tally.worked + 1) / (tally.worked + tally.failed + 2) : 0.5;
    },
  };
}
