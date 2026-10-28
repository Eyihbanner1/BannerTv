/**
 * Storage the app provides (IndexedDB on the TV). Both interfaces may fail at
 * any time, for example when the TV is out of space; the core treats every
 * failure as "nothing stored" and carries on in memory.
 */

/** Small values such as the addon collection, stored as structured clones. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** One cached response. Durations are in milliseconds from `storedAt`. */
export interface CacheRecord {
  value: unknown;
  storedAt: number;
  /** Served without asking the addon again. */
  freshFor: number;
  /** After that, served at once while a fresh copy is fetched. */
  revalidateFor: number;
  /** After that, served only when the addon fails to answer. */
  errorFor: number;
}

export interface CacheStore {
  read(key: string): Promise<CacheRecord | undefined>;
  write(key: string, record: CacheRecord): Promise<void>;
}

export function memoryKeyValueStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(values.get(key)),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

export function memoryCacheStore(): CacheStore {
  const records = new Map<string, CacheRecord>();
  return {
    read: (key) => Promise.resolve(records.get(key)),
    write: (key, record) => {
      records.set(key, record);
      return Promise.resolve();
    },
  };
}
