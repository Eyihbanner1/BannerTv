import { createStore, type Listener } from './store';
import type { KeyValueStore } from './storage';

/**
 * One value kept under one key of the key-value store: read once, saved
 * after every change.
 */
export interface Persisted<T> {
  /** Reads the saved value. Safe to call more than once. */
  load(): Promise<void>;
  /** Whether the saved value has been read (or found missing or unreadable). */
  loaded(): boolean;
  get(): T;
  /**
   * Changes the value once the saved one has been read, then saves it.
   * Changing it first would lose what was saved, so an update made earlier
   * waits for the read and starts it if needed.
   */
  update(change: (value: T) => T): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export interface PersistedOptions<T> {
  storage: KeyValueStore;
  key: string;
  /** The value before anything is read, and when nothing usable was saved. */
  initial: T;
  /** The saved value, checked field by field; anything unusable becomes `initial`. */
  read: (saved: unknown) => T;
  /** What is saved. Defaults to the value itself. */
  write?: (value: T) => unknown;
}

/**
 * A value in the key-value store. Saves are serialised, and changes that land
 * during a save are carried by the next one, so storage always ends with the
 * newest value. A failed save (a full disk) leaves the value in memory, and
 * the next change tries again.
 */
export function createPersisted<T>(options: PersistedOptions<T>): Persisted<T> {
  const { storage, key, initial, read, write = (value: T) => value } = options;
  const state = createStore<T>(initial);
  let loading: Promise<void> | undefined;
  let isLoaded = false;
  let saving = false;
  let dirty = false;

  async function readSaved() {
    let saved: unknown;
    try {
      saved = await storage.get(key);
    } catch {
      saved = undefined;
    }
    let value: T;
    try {
      value = saved === undefined || saved === null ? initial : read(saved);
    } catch {
      value = initial;
    }
    isLoaded = true;
    state.set(value);
  }

  function load() {
    if (!loading) loading = readSaved();
    return loading;
  }

  async function saveLatest() {
    try {
      while (dirty) {
        dirty = false;
        try {
          await storage.set(key, write(state.get()));
        } catch {
          // The value lives on in memory; the next change saves it again.
        }
      }
    } finally {
      saving = false;
    }
  }

  return {
    load,
    loaded: () => isLoaded,
    get: state.get,
    async update(change) {
      await load();
      const before = state.get();
      state.set(change(before));
      if (state.get() === before) return;
      dirty = true;
      if (saving) return;
      saving = true;
      await saveLatest();
    },
    subscribe: state.subscribe,
  };
}
