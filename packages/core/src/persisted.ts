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
  /**
   * As update(), except that once the saved value has been read the change
   * is made before updateNow() returns, and only the save is waited for: the
   * sync engine's parts need this (SyncPart.adopt).
   */
  updateNow(change: (value: T) => T): Promise<void>;
  /** Told of every change, and once when the saved value has been read, even if it is `initial`. */
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
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((listener) => listener());
  state.subscribe(notify);
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
    if (Object.is(value, state.get())) notify();
    else state.set(value);
  }

  function load() {
    if (!loading) loading = readSaved();
    return loading;
  }

  function change(next: (value: T) => T): Promise<void> {
    const before = state.get();
    let after: T;
    try {
      after = next(before);
    } catch (error) {
      return Promise.reject(error);
    }
    state.set(after);
    if (state.get() === before) return Promise.resolve();
    dirty = true;
    if (saving) return Promise.resolve();
    saving = true;
    return saveLatest();
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
    async update(next) {
      await load();
      await change(next);
    },
    updateNow(next) {
      if (isLoaded) return change(next);
      return load().then(() => change(next));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
