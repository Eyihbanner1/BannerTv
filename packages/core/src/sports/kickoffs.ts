import type { KeyValueStore } from '../storage';
import type { Timers } from '../timers';
import type { KickOff } from './types';

const STORAGE_KEY = 'sports.kickoffs';
const DAY = 24 * 60 * 60 * 1000;
/** Kept this long after kick-off (or after first seen, with no kick-off). */
export const KICKOFF_MEMORY_MS = 2 * DAY;
/** At most this many items, newest first, so storage stays small. */
export const KICKOFF_MEMORY_MAX = 4000;
const SAVE_DELAY_MS = 2000;

interface Entry {
  at?: number;
  date?: string;
  sure: boolean;
  /** When BannerTV first saw the item. */
  seen: number;
}

/** As stored: [key, at or 0, date or '', sure, seen]. */
type StoredEntry = [string, number, string, boolean, number];

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
  /** Everything, for "Clear data" in Settings. */
  clear(): void;
  /** Writes now instead of after the usual pause. */
  flush(): Promise<void>;
}

function keyOf(addonId: string, id: string): string {
  return `${addonId}\n${id}`;
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

  function prune() {
    const limit = now() - KICKOFF_MEMORY_MS;
    entries.forEach((entry, key) => {
      const date = entry.date ? Date.parse(`${entry.date}T23:59:59Z`) : undefined;
      if ((entry.at ?? date ?? entry.seen) < limit && entry.seen < limit) entries.delete(key);
    });
    if (entries.size <= KICKOFF_MEMORY_MAX) return;
    const newest = Array.from(entries.entries()).sort((a, b) => b[1].seen - a[1].seen);
    entries.clear();
    for (const [key, entry] of newest.slice(0, KICKOFF_MEMORY_MAX)) entries.set(key, entry);
  }

  async function save() {
    cancelSave = undefined;
    if (!dirty || !store) return;
    dirty = false;
    prune();
    const stored: StoredEntry[] = [];
    entries.forEach((entry, key) => {
      stored.push([key, entry.at ?? 0, entry.date ?? '', entry.sure, entry.seen]);
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
          if (!Array.isArray(value)) return;
          for (const row of value) {
            if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[4] !== 'number') {
              continue;
            }
            // What this launch already saw wins over what an earlier one did.
            if (entries.has(row[0])) continue;
            const entry: Entry = { sure: row[3] === true, seen: row[4] };
            if (typeof row[1] === 'number' && row[1] > 0) entry.at = row[1];
            if (typeof row[2] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row[2]))
              entry.date = row[2];
            entries.set(row[0], entry);
          }
          prune();
        })();
      }
      return loading;
    },

    note(addonId, id, kickOff) {
      const key = keyOf(addonId, id);
      const entry = entries.get(key);
      const own =
        kickOff && kickOff.source !== 'estimated' && kickOff.source !== 'remembered'
          ? kickOff
          : undefined;
      if (!entry) {
        const fresh: Entry = { sure: own?.sure ?? false, seen: now() };
        if (own?.at !== undefined) fresh.at = own.at;
        else if (own?.date !== undefined) fresh.date = own.date;
        entries.set(key, fresh);
        changed();
        return;
      }
      if (!own) return;
      // A time beats a date; a sure time beats an unsure one; otherwise the latest wins.
      if (own.at !== undefined) {
        if (entry.at === own.at && entry.sure === own.sure) return;
        if (entry.at !== undefined && entry.sure && !own.sure) return;
        entry.at = own.at;
        entry.sure = own.sure;
        delete entry.date;
        changed();
      } else if (own.date !== undefined && entry.at === undefined && entry.date !== own.date) {
        entry.date = own.date;
        changed();
      }
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
      const prefix = `${addonId}\n`;
      entries.forEach((_, key) => {
        if (key.indexOf(prefix) === 0) entries.delete(key);
      });
      changed();
    },

    clear() {
      entries.clear();
      changed();
    },

    async flush() {
      cancelSave?.();
      await save();
    },
  };
}
