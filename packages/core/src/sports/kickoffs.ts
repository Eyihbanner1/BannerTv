import type { KeyValueStore } from '../storage';
import type { Timers } from '../timers';
import { sortStable } from './sort';
import type { KickOff } from './types';

const STORAGE_KEY = 'sports.kickoffs';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/**
 * Kept this long after kick-off (or after first seen, with no kick-off), and
 * after the addon last listed the item.
 */
export const KICKOFF_MEMORY_MS = 2 * DAY;
/** At most this many items, most recently listed first, so storage stays small. */
export const KICKOFF_MEMORY_MAX = 4000;
/** When an item was last listed moves on in steps this long, so reading a page rarely writes. */
export const LAST_SEEN_STEP_MS = HOUR;
const SAVE_DELAY_MS = 2000;

interface Entry {
  at?: number;
  date?: string;
  sure: boolean;
  /** When BannerTV first saw the item. */
  seen: number;
  /** When BannerTV last saw the addon list it, to within LAST_SEEN_STEP_MS. */
  last: number;
}

/** As stored: [key, at or 0, date or '', sure, seen, last seen]. Rows without the last are older. */
type StoredEntry = [string, number, string, boolean, number, number];

/**
 * What BannerTV saw of each sports item: when it first appeared, and its
 * kick-off while the addon still sent one, for addons that swap the time for
 * "LIVE" at kick-off. Keyed by addon id and item id; never by the addon's
 * address, which can carry a key.
 */
export interface KickoffMemory {
  /** Reads what earlier launches saw. Safe to call more than once. */
  load(): Promise<void>;
  /** Notes an item seen now, and its kick-off when it has one of its own. */
  note(addonId: string, id: string, kickOff: KickOff | undefined): void;
  /** The kick-off seen earlier, marked as remembered. */
  get(addonId: string, id: string): KickOff | undefined;
  firstSeen(addonId: string, id: string): number | undefined;
  /** Everything about one addon, for when it is removed. */
  forget(addonId: string): void;
  /**
   * Everything about one addon, under the id it came back with when it was
   * set up again (a new settings hash). For an item the new id already holds,
   * its own kick-off wins; it takes the old one only when it has none, and
   * keeps the earlier first-seen.
   */
  move(fromAddonId: string, toAddonId: string): void;
  /** Everything, for "Clear data" in Settings. */
  clear(): void;
  /** Writes now instead of after the usual pause. */
  flush(): Promise<void>;
}

function keyOf(addonId: string, id: string): string {
  return `${addonId}\n${id}`;
}

/**
 * Adds what `other` knew of the same item to `entry`: the earlier first-seen
 * and the later last-seen, and its kick-off only where `entry` has none, or
 * has a date where `other` has a time.
 */
function mergeEntry(entry: Entry, other: Entry): void {
  if (other.seen < entry.seen) entry.seen = other.seen;
  if (other.last > entry.last) entry.last = other.last;
  if (entry.at !== undefined) return;
  if (other.at !== undefined) {
    entry.at = other.at;
    entry.sure = other.sure;
    delete entry.date;
  } else if (entry.date === undefined && other.date !== undefined) {
    entry.date = other.date;
    entry.sure = other.sure;
  }
}

function forgetIn(entries: Map<string, Entry>, addonId: string): void {
  const prefix = `${addonId}\n`;
  entries.forEach((_, key) => {
    if (key.indexOf(prefix) === 0) entries.delete(key);
  });
}

function moveIn(entries: Map<string, Entry>, from: string, to: string): void {
  const prefix = `${from}\n`;
  const moving: string[] = [];
  entries.forEach((_, key) => {
    if (key.indexOf(prefix) === 0) moving.push(key);
  });
  for (const key of moving) {
    const entry = entries.get(key)!;
    entries.delete(key);
    const renamed = `${to}\n${key.slice(prefix.length)}`;
    const held = entries.get(renamed);
    if (held) mergeEntry(held, entry);
    else entries.set(renamed, entry);
  }
}

export function createKickoffMemory(options: {
  store?: KeyValueStore;
  timers: Timers;
  now?: () => number;
}): KickoffMemory {
  const { store, timers, now = Date.now } = options;
  const entries = new Map<string, Entry>();
  let loading: Promise<void> | undefined;
  let cancelSave: (() => void) | undefined;
  let dirty = false;
  /**
   * Removals, moves and clears made before the stored rows were read: done
   * to those rows too as they arrive, so a removed addon's items never come back.
   */
  let pending: Array<(rows: Map<string, Entry>) => void> | undefined = [];

  function prune() {
    const limit = now() - KICKOFF_MEMORY_MS;
    entries.forEach((entry, key) => {
      const date = entry.date ? Date.parse(`${entry.date}T23:59:59Z`) : undefined;
      // Kept while the addon still lists the item: without its first-seen an untimed item
      // would be new again, and without its kick-off a finished LIVE one live again.
      if ((entry.at ?? date ?? entry.seen) < limit && entry.last < limit) entries.delete(key);
    });
    if (entries.size <= KICKOFF_MEMORY_MAX) return;
    const newest = sortStable(Array.from(entries.entries()), (a, b) => b[1].last - a[1].last);
    entries.clear();
    for (const [key, entry] of newest.slice(0, KICKOFF_MEMORY_MAX)) entries.set(key, entry);
  }

  /** Takes a kick-off the addon sent; true when the entry changed. */
  function takeKickOff(entry: Entry, own: KickOff): boolean {
    // A time beats a date; a sure time beats an unsure one; otherwise the latest wins.
    if (own.at !== undefined) {
      if (entry.at === own.at && entry.sure === own.sure) return false;
      if (entry.at !== undefined && entry.sure && !own.sure) return false;
      entry.at = own.at;
      entry.sure = own.sure;
      delete entry.date;
      return true;
    }
    if (own.date !== undefined && entry.at === undefined && entry.date !== own.date) {
      entry.date = own.date;
      return true;
    }
    return false;
  }

  async function save() {
    cancelSave = undefined;
    if (!dirty || !store) return;
    dirty = false;
    prune();
    const stored: StoredEntry[] = [];
    entries.forEach((entry, key) => {
      stored.push([key, entry.at ?? 0, entry.date ?? '', entry.sure, entry.seen, entry.last]);
    });
    try {
      await store.set(STORAGE_KEY, stored);
    } catch {
      // Out of space: the memory carries on for this launch.
    }
  }

  function changed() {
    dirty = true;
    if (!cancelSave && store) cancelSave = timers.after(SAVE_DELAY_MS, () => void save());
  }

  return {
    load() {
      if (!loading) {
        loading = (async () => {
          let value: unknown;
          try {
            value = await store?.get(STORAGE_KEY);
          } catch {
            value = undefined;
          }
          const changes = pending ?? [];
          pending = undefined;
          if (!Array.isArray(value)) return;
          const rows = new Map<string, Entry>();
          for (const row of value) {
            if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[4] !== 'number') {
              continue;
            }
            const seen: number = row[4];
            const last = typeof row[5] === 'number' && row[5] > seen ? row[5] : seen;
            const entry: Entry = { sure: row[3] === true, seen, last };
            if (typeof row[1] === 'number' && row[1] > 0) entry.at = row[1];
            if (typeof row[2] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row[2]))
              entry.date = row[2];
            rows.set(row[0], entry);
          }
          for (const change of changes) change(rows);
          let merged = false;
          rows.forEach((entry, key) => {
            const current = entries.get(key);
            if (!current) {
              entries.set(key, entry);
              return;
            }
            // Noted before this read finished: the kick-off this launch saw wins, but the
            // item was first seen in the earlier launch, and may have lost its time since.
            merged = true;
            mergeEntry(current, entry);
          });
          // A removal or move made before this read finished is saved with the rows it changed.
          if (changes.length > 0) merged = true;
          prune();
          // A save made before this read finished held this launch's items only.
          if (merged) changed();
        })();
      }
      return loading;
    },

    note(addonId, id, kickOff) {
      const key = keyOf(addonId, id);
      const entry = entries.get(key);
      const time = now();
      const own =
        kickOff && kickOff.source !== 'estimated' && kickOff.source !== 'remembered'
          ? kickOff
          : undefined;
      if (!entry) {
        const fresh: Entry = { sure: own?.sure ?? false, seen: time, last: time };
        if (own?.at !== undefined) fresh.at = own.at;
        else if (own?.date !== undefined) fresh.date = own.date;
        entries.set(key, fresh);
        changed();
        return;
      }
      const listed = time - entry.last >= LAST_SEEN_STEP_MS;
      if (listed) entry.last = time;
      if ((own !== undefined && takeKickOff(entry, own)) || listed) changed();
    },

    get(addonId, id) {
      const entry = entries.get(keyOf(addonId, id));
      if (!entry) return undefined;
      if (entry.at !== undefined) return { at: entry.at, sure: entry.sure, source: 'remembered' };
      if (entry.date !== undefined) return { date: entry.date, sure: false, source: 'remembered' };
      return undefined;
    },

    firstSeen(addonId, id) {
      return entries.get(keyOf(addonId, id))?.seen;
    },

    forget(addonId) {
      forgetIn(entries, addonId);
      pending?.push((rows) => forgetIn(rows, addonId));
      changed();
    },

    move(from, to) {
      if (from === to) return;
      moveIn(entries, from, to);
      pending?.push((rows) => moveIn(rows, from, to));
      changed();
    },

    clear() {
      entries.clear();
      pending?.push((rows) => rows.clear());
      changed();
    },

    async flush() {
      cancelSave?.();
      await save();
    },
  };
}
