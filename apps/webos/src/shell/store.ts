/**
 * Where the loader keeps downloaded updates: an IndexedDB database of its own
 * (DB_NAME), never the app's `bannertv` one, so nothing an update does to the
 * app's data can touch the code that starts it, and the other way round.
 *
 * - `files`: each file by its SHA-256 (hex), as an ArrayBuffer. An update
 *   names its files by hash, so two updates share what they have in common.
 * - `updates`: each update's manifest by its id, exactly as signed, with the
 *   signature, so it is checked again at every start.
 * - `state`: a copy of the loader's state (state.ts), the text it keeps in
 *   localStorage, for a start that finds localStorage empty. A write here is
 *   confirmed, so the loader waits for it before it starts the page again.
 */
import { DB_NAME } from './contract';

export interface StoredUpdate {
  id: string;
  text: string;
  sig: string;
  keyId: string;
}

export interface UpdateStore {
  getFile(sha256: string): Promise<ArrayBuffer | undefined>;
  /** Which of `hashes` are stored. */
  hasFiles(hashes: string[]): Promise<Set<string>>;
  putFile(sha256: string, bytes: ArrayBuffer): Promise<void>;
  getUpdate(id: string): Promise<StoredUpdate | undefined>;
  putUpdate(update: StoredUpdate): Promise<void>;
  /** Deletes every update but those in `ids`, and every file but those in `hashes`. */
  keepOnly(ids: string[], hashes: string[]): Promise<void>;
  getState(): Promise<string | null>;
  putState(text: string): Promise<void>;
}

const FILES = 'files';
const UPDATES = 'updates';
const STATE = 'state';
const DB_VERSION = 1;

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('aborted'));
  });
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(UPDATES)) db.createObjectStore(UPDATES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

/** The store over `factory` (the page's indexedDB), opened once on first use. */
export function idbStore(factory: IDBFactory): UpdateStore {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () => {
    if (!opened) {
      opened = open(factory);
      // A failed open is tried again next time rather than remembered.
      opened.catch(() => {
        opened = undefined;
      });
    }
    return opened;
  };
  const read = async <T>(store: string, key: string) => {
    const transaction = (await db()).transaction(store, 'readonly');
    return (await done(transaction.objectStore(store).get(key))) as T | undefined;
  };
  const write = async (store: string, value: unknown, key?: string) => {
    const transaction = (await db()).transaction(store, 'readwrite');
    transaction.objectStore(store).put(value, key);
    await finished(transaction);
  };
  return {
    async getFile(sha256) {
      const value = await read<unknown>(FILES, sha256);
      return value instanceof ArrayBuffer ? value : undefined;
    },
    async hasFiles(hashes) {
      const transaction = (await db()).transaction(FILES, 'readonly');
      const keys = await done(transaction.objectStore(FILES).getAllKeys());
      const stored = new Set(keys.map(String));
      return new Set(hashes.filter((hash) => stored.has(hash)));
    },
    putFile: (sha256, bytes) => write(FILES, bytes, sha256),
    async getUpdate(id) {
      const value = await read<StoredUpdate>(UPDATES, id);
      return value && typeof value.text === 'string' ? value : undefined;
    },
    putUpdate: (update) => write(UPDATES, update),
    async keepOnly(ids, hashes) {
      const transaction = (await db()).transaction([FILES, UPDATES], 'readwrite');
      const files = transaction.objectStore(FILES);
      const updates = transaction.objectStore(UPDATES);
      const [fileKeys, updateKeys] = await Promise.all([
        done(files.getAllKeys()),
        done(updates.getAllKeys()),
      ]);
      for (const key of fileKeys) if (hashes.indexOf(String(key)) === -1) files.delete(key);
      for (const key of updateKeys) if (ids.indexOf(String(key)) === -1) updates.delete(key);
      await finished(transaction);
    },
    async getState() {
      const value = await read<unknown>(STATE, STATE);
      return typeof value === 'string' ? value : null;
    },
    putState: (text) => write(STATE, text, STATE),
  };
}

/** A store in memory, for the unit tests. */
export function memoryStore(): UpdateStore & {
  files: Map<string, ArrayBuffer>;
  updates: Map<string, StoredUpdate>;
  state: string | null;
} {
  const files = new Map<string, ArrayBuffer>();
  const updates = new Map<string, StoredUpdate>();
  const store = {
    files,
    updates,
    state: null as string | null,
    getFile: async (sha256: string) => files.get(sha256),
    hasFiles: async (hashes: string[]) => new Set(hashes.filter((hash) => files.has(hash))),
    putFile: async (sha256: string, bytes: ArrayBuffer) => {
      files.set(sha256, bytes);
    },
    getUpdate: async (id: string) => updates.get(id),
    putUpdate: async (update: StoredUpdate) => {
      updates.set(update.id, update);
    },
    keepOnly: async (ids: string[], hashes: string[]) => {
      for (const key of [...files.keys()]) if (hashes.indexOf(key) === -1) files.delete(key);
      for (const key of [...updates.keys()]) if (ids.indexOf(key) === -1) updates.delete(key);
    },
    getState: async () => store.state,
    putState: async (text: string) => {
      store.state = text;
    },
  };
  return store;
}
