import { createPersisted } from '../../persisted';
import type { KeyValueStore } from '../../storage';

/**
 * How much this screen asked of SubDL today, and whether it is resting
 * because SubDL asked it to slow down or keeps failing. Kept for the whole
 * screen, not per profile: SubDL's limit on downloads without a key is per
 * address, and a slow-down or failures are about the screen's connection.
 * A daily limit SubDL answers a search with is the key's own, so it rests
 * that key only: kept by a short fingerprint of the key, never the key.
 */

/** A safety stop well under the free key's 2,000: one search per play never reaches it. */
export const SUBDL_SEARCHES_PER_DAY = 300;
/** Under the 300 downloads a day SubDL allows each address without a key. */
export const SUBDL_DOWNLOADS_PER_DAY = 250;

export type SubdlRestWhy = 'busy' | 'limit' | 'failing';

export interface SubdlRest {
  why: SubdlRestWhy;
  until: number;
}

export interface SubdlUsage {
  load(): Promise<void>;
  /** The rest under way for the screen, or for `key` once it reached its daily limit; or null. */
  resting(key?: string | null): SubdlRest | null;
  /** A daily limit with `key` rests that key only; without one, the whole screen. */
  rest(why: SubdlRestWhy, key?: string): void;
  /** An answer came: the failures in a row and the slow-down doubling start again. */
  succeeded(): void;
  /** A challenge, server, network, timeout or unreadable answer. */
  failed(): void;
  /** Counts a search: false once today's are used up. */
  takeSearch(): boolean;
  /** Counts a download: false once today's are used up. */
  takeDownload(): boolean;
  subscribe(listener: () => void): () => void;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FAILING_MS = 15 * MINUTE;
const LIMIT_AFTER_MIDNIGHT_MS = 5 * MINUTE;
const FAILURES_TO_REST = 3;
/** A rest longer than this means the clock went back: it ends. */
const LONGEST_REST_MS = 25 * HOUR;
/** The keys at their daily limit kept at once: a screen has a few profiles. */
const LIMITED_KEYS = 8;

interface Counts {
  day: string;
  searches: number;
  downloads: number;
}

interface StoredRest extends SubdlRest {
  /** The busy rest's length, which doubles while SubDL keeps asking; 0 once an answer came. */
  stepMs: number;
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

function readCounts(saved: unknown): Counts | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { day, searches, downloads } = saved as Partial<Record<keyof Counts, unknown>>;
  if (typeof day !== 'string') return null;
  return { day, searches: count(searches), downloads: count(downloads) };
}

function readRest(saved: unknown): StoredRest | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { why, until, stepMs } = saved as Partial<Record<keyof StoredRest, unknown>>;
  if (why !== 'busy' && why !== 'limit' && why !== 'failing') return null;
  if (typeof until !== 'number' || !Number.isFinite(until)) return null;
  return { why, until, stepMs: count(stepMs) };
}

/** A key at its daily limit, by its fingerprint. */
interface KeyLimit {
  tag: string;
  until: number;
}

function readLimits(saved: unknown): KeyLimit[] {
  if (!Array.isArray(saved)) return [];
  const out: KeyLimit[] = [];
  for (const item of saved as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { tag, until } = item as Partial<Record<keyof KeyLimit, unknown>>;
    if (typeof tag !== 'string' || typeof until !== 'number' || !Number.isFinite(until)) continue;
    out.push({ tag, until });
  }
  return out.slice(-LIMITED_KEYS);
}

/** 32 bits of FNV-1a: tells keys apart, and cannot give a key back. */
function keyTag(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** "YYYY-MM-DD" in UTC, as SubDL's day turns. */
function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function nextUtcMidnight(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function createSubdlUsage(options: {
  storage: KeyValueStore;
  now?: () => number;
}): SubdlUsage {
  const { storage, now = Date.now } = options;
  const counts = createPersisted<Counts | null>({
    storage,
    key: 'subdl/usage',
    initial: null,
    read: readCounts,
  });
  const rests = createPersisted<StoredRest | null>({
    storage,
    key: 'subdl/rest',
    initial: null,
    read: readRest,
  });
  const limits = createPersisted<KeyLimit[]>({
    storage,
    key: 'subdl/limit',
    initial: [],
    read: readLimits,
  });
  let failuresInRow = 0;

  /** A rest that has not ended, and is not so long the clock must have gone back. */
  const current = (until: number) => {
    const left = until - now();
    return left > 0 && left <= LONGEST_REST_MS;
  };

  function today(): Counts {
    const day = utcDay(now());
    const current = counts.get();
    return current && current.day === day ? current : { day, searches: 0, downloads: 0 };
  }

  function take(field: 'searches' | 'downloads', cap: number): boolean {
    const current = today();
    if (current[field] >= cap) return false;
    const next = { ...current, [field]: current[field] + 1 };
    void counts.updateNow(() => next);
    return true;
  }

  function rest(why: SubdlRestWhy, key?: string) {
    const at = now();
    if (why === 'limit' && key !== undefined) {
      const tag = keyTag(key);
      const until = nextUtcMidnight(at) + LIMIT_AFTER_MIDNIGHT_MS;
      void limits.updateNow((before) =>
        before
          .filter((limit) => limit.tag !== tag && current(limit.until))
          .concat({ tag, until })
          .slice(-LIMITED_KEYS),
      );
      return;
    }
    const before = rests.get();
    let stepMs = before?.stepMs ?? 0;
    let until: number;
    if (why === 'busy') {
      const recent =
        before !== null &&
        before.why === 'busy' &&
        before.stepMs >= HOUR &&
        at - before.until < DAY;
      stepMs = recent ? Math.min(before.stepMs * 2, DAY) : HOUR;
      until = at + stepMs;
    } else if (why === 'limit') {
      until = nextUtcMidnight(at) + LIMIT_AFTER_MIDNIGHT_MS;
    } else {
      until = at + FAILING_MS;
    }
    void rests.updateNow(() => ({ why, until, stepMs }));
  }

  return {
    load: () => Promise.all([counts.load(), rests.load(), limits.load()]).then(() => undefined),
    resting(key) {
      // The key's own limit first: it says the searches are used up, and lasts longer.
      const tag = key ? keyTag(key) : undefined;
      const limit = limits.get().find((one) => one.tag === tag && current(one.until));
      if (limit) return { why: 'limit', until: limit.until };
      const screen = rests.get();
      return screen && current(screen.until) ? { why: screen.why, until: screen.until } : null;
    },
    rest,
    succeeded() {
      failuresInRow = 0;
      const current = rests.get();
      if (current && current.stepMs !== 0) void rests.updateNow(() => ({ ...current, stepMs: 0 }));
    },
    failed() {
      failuresInRow++;
      if (failuresInRow >= FAILURES_TO_REST) {
        failuresInRow = 0;
        rest('failing');
      }
    },
    takeSearch: () => take('searches', SUBDL_SEARCHES_PER_DAY),
    takeDownload: () => take('downloads', SUBDL_DOWNLOADS_PER_DAY),
    subscribe(listener) {
      const undo = [
        counts.subscribe(listener),
        rests.subscribe(listener),
        limits.subscribe(listener),
      ];
      return () => undo.forEach((stop) => stop());
    },
  };
}
