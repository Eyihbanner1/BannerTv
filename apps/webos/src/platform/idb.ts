import {
  type CacheRecord,
  type CacheStore,
  type KeyValueStore,
  memoryCacheStore,
  memoryKeyValueStore,
} from '@bannertv/core';
import { bootMark } from './marks';

const DB_NAME = 'bannertv';
const DB_VERSION = 1;
const KV = 'kv';
const CACHE = 'cache';
const BY_STORED_AT = 'storedAt';
/**
 * Catalog pages run 20 to 150 KB, so this keeps the cache near the plan's
 * 50 MB. The oldest-stored entries go first; anything in use is rewritten
 * whenever it is refreshed, so it stays young.
 */
export const MAX_CACHE_ENTRIES = 400;
const PRUNE_EVERY_WRITES = 50;

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(CACHE)) {
        db.createObjectStore(CACHE).createIndex(BY_STORED_AT, 'storedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another connection'));
  });
}

/** Deletes the oldest cache entries until at most `max` are left. */
async function prune(db: IDBDatabase, max: number): Promise<void> {
  const store = db.transaction(CACHE, 'readwrite').objectStore(CACHE);
  let excess = (await done(store.count())) - max;
  if (excess <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const cursor = store.index(BY_STORED_AT).openKeyCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || excess <= 0) {
        resolve();
        return;
      }
      store.delete(current.primaryKey);
      excess--;
      current.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

export interface Storage {
  kv: KeyValueStore;
  cache: CacheStore;
  /**
   * False once the database failed to open and everything lives in memory
   * for this session. The BannerTV account stays off then: an empty store
   * would read as a screen with no account (ADR 0006, decision 13).
   */
  persistent: Promise<boolean>;
}

/**
 * IndexedDB-backed storage. If the database cannot be opened (a private
 * window, a full disk), everything falls back to memory for this session.
 */
export function createStorage(): Storage {
  const fallbackKv = memoryKeyValueStore();
  const fallbackCache = memoryCacheStore();
  const db: Promise<IDBDatabase | null> = openDatabase().catch((error: unknown) => {
    console.warn('[BannerTV] storage is in memory only:', String(error));
    return null;
  });
  let writes = 0;

  void db.then((database) => {
    if (!database) return;
    bootMark('boot:idb-open');
    prune(database, MAX_CACHE_ENTRIES).catch(() => undefined);
  });

  return {
    persistent: db.then((database) => database !== null),
    kv: {
      async get(key) {
        const database = await db;
        if (!database) return fallbackKv.get(key);
        return done(database.transaction(KV, 'readonly').objectStore(KV).get(key));
      },
      async set(key, value) {
        const database = await db;
        if (!database) return fallbackKv.set(key, value);
        await done(database.transaction(KV, 'readwrite').objectStore(KV).put(value, key));
      },
      async delete(key) {
        const database = await db;
        if (!database) return fallbackKv.delete(key);
        await done(database.transaction(KV, 'readwrite').objectStore(KV).delete(key));
      },
      async deletePrefix(prefix) {
        const database = await db;
        if (!database) return fallbackKv.deletePrefix(prefix);
        // Every string key that starts with the prefix sorts between these two.
        const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
        await done(database.transaction(KV, 'readwrite').objectStore(KV).delete(range));
      },
    },
    cache: {
      async read(key) {
        const database = await db;
        if (!database) return fallbackCache.read(key);
        const record: unknown = await done(
          database.transaction(CACHE, 'readonly').objectStore(CACHE).get(key),
        );
        return record as CacheRecord | undefined;
      },
      async write(key, record) {
        const database = await db;
        if (!database) return fallbackCache.write(key, record);
        await done(database.transaction(CACHE, 'readwrite').objectStore(CACHE).put(record, key));
        if (++writes % PRUNE_EVERY_WRITES === 0) await prune(database, MAX_CACHE_ENTRIES);
      },
    },
  };
}
