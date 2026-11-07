import {
  type CacheRecord,
  type CacheStore,
  type KeyValueStore,
  memoryCacheStore,
  memoryKeyValueStore,
} from '@bannertv/core';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { decodeClone, encodeClone } from './codec';

/**
 * The phone's stand-in for the LG app's platform/idb.ts (Metro swaps it in, see metro.config.js):
 * the same `kv` and `cache` stores, kept in SQLite instead of IndexedDB. Same exports, same
 * promises: the shared data modules cannot tell the difference.
 */

/** As on the TV: catalog pages run 20 to 150 KB, so this keeps the cache near 50 MB. */
export const MAX_CACHE_ENTRIES = 400;
const PRUNE_EVERY_WRITES = 50;

export interface Storage {
  kv: KeyValueStore;
  cache: CacheStore;
  /** False once the database failed to open and everything lives in memory for this run. */
  persistent: Promise<boolean>;
}

async function openDatabase(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync('bannertv.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY NOT NULL,
      stored_at REAL NOT NULL,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cache_by_stored_at ON cache (stored_at);
  `);
  return db;
}

async function prune(db: SQLiteDatabase, max: number): Promise<void> {
  await db.runAsync(
    `DELETE FROM cache WHERE key IN (
       SELECT key FROM cache ORDER BY stored_at DESC LIMIT -1 OFFSET ?
     )`,
    max,
  );
}

/** A value read back, or undefined (nothing stored) when it cannot be read. */
function decoded(row: { value: string } | null): unknown {
  if (!row) return undefined;
  try {
    return decodeClone(row.value);
  } catch {
    return undefined;
  }
}

export function createStorage(): Storage {
  const fallbackKv = memoryKeyValueStore();
  const fallbackCache = memoryCacheStore();
  const db: Promise<SQLiteDatabase | null> = openDatabase().catch((error: unknown) => {
    console.warn('[BannerTV] storage is in memory only:', String(error));
    return null;
  });
  let writes = 0;

  void db.then((database) => {
    if (database) prune(database, MAX_CACHE_ENTRIES).catch(() => undefined);
  });

  return {
    persistent: db.then((database) => database !== null),
    kv: {
      async get(key) {
        const database = await db;
        if (!database) return fallbackKv.get(key);
        return decoded(
          await database.getFirstAsync<{ value: string }>(
            'SELECT value FROM kv WHERE key = ?',
            key,
          ),
        );
      },
      async set(key, value) {
        const database = await db;
        if (!database) return fallbackKv.set(key, value);
        await database.runAsync(
          'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
          key,
          encodeClone(value),
        );
      },
      async delete(key) {
        const database = await db;
        if (!database) return fallbackKv.delete(key);
        await database.runAsync('DELETE FROM kv WHERE key = ?', key);
      },
      async deletePrefix(prefix) {
        const database = await db;
        if (!database) return fallbackKv.deletePrefix(prefix);
        await database.runAsync(
          'DELETE FROM kv WHERE substr(key, 1, ?) = ?',
          prefix.length,
          prefix,
        );
      },
    },
    cache: {
      async read(key) {
        const database = await db;
        if (!database) return fallbackCache.read(key);
        return decoded(
          await database.getFirstAsync<{ value: string }>(
            'SELECT value FROM cache WHERE key = ?',
            key,
          ),
        ) as CacheRecord | undefined;
      },
      async write(key, record) {
        const database = await db;
        if (!database) return fallbackCache.write(key, record);
        await database.runAsync(
          'INSERT OR REPLACE INTO cache (key, stored_at, value) VALUES (?, ?, ?)',
          key,
          record.storedAt,
          encodeClone(record),
        );
        if (++writes % PRUNE_EVERY_WRITES === 0) await prune(database, MAX_CACHE_ENTRIES);
      },
    },
  };
}
