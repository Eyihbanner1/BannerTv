import { type Manifest, normalizeManifestUrl, parseManifest } from '@bannertv/protocol';
import type { FetchJson } from '../http';
import { createStore, type Store } from '../store';
import type { KeyValueStore } from '../storage';

export const MANIFEST_TIMEOUT_MS = 10000;
const STORAGE_KEY = 'addons';

export interface InstalledAddon {
  /** The manifest URL. Configured addons keep API keys in it: never log it. */
  transportUrl: string;
  manifest: Manifest;
  official: boolean;
  /** When the manifest was fetched, in ms since 1970. 0 for a copy bundled with the app. */
  fetchedAt: number;
}

/** How an addon is kept in storage: the manifest as the addon sent it, re-read at every launch. */
export interface StoredAddon {
  transportUrl: string;
  manifest: unknown;
  official: boolean;
  fetchedAt: number;
}

export interface CollectionState {
  /** False until storage has been read. */
  ready: boolean;
  /** In priority order: it decides which addon answers meta and the order of Home rows. */
  addons: readonly InstalledAddon[];
}

export type InstallErrorKind = 'invalid-url' | 'unreachable' | 'not-an-addon' | 'different-addon';

export class InstallError extends Error {
  readonly kind: InstallErrorKind;

  constructor(kind: InstallErrorKind, message: string) {
    super(message);
    this.name = 'InstallError';
    this.kind = kind;
  }
}

export interface InstallOptions {
  /**
   * The addon this one replaces, for an addon set up again on its settings
   * page: the new address takes the old one's place in the list.
   */
  replaces?: string;
}

export interface AddonCollection extends Pick<Store<CollectionState>, 'get' | 'subscribe'> {
  /** Reads the saved collection, or installs the defaults on first launch. */
  load(): Promise<void>;
  /** Installs from a typed or scanned URL. Reinstalling an addon updates it in place. */
  install(input: string, options?: InstallOptions): Promise<InstalledAddon>;
  remove(transportUrl: string): void;
  /** Moves an addon up (negative) or down (positive) in priority. */
  move(transportUrl: string, offset: number): void;
  /** Fetches manifests older than `maxAgeMs` again. Failures keep the old manifest. */
  refreshManifests(maxAgeMs: number): Promise<void>;
}

function readStored(value: StoredAddon): InstalledAddon | undefined {
  try {
    return {
      transportUrl: value.transportUrl,
      manifest: parseManifest(value.manifest),
      official: value.official === true,
      fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
    };
  } catch {
    return undefined;
  }
}

export function createAddonCollection(options: {
  storage: KeyValueStore;
  fetchJson: FetchJson;
  defaults: readonly StoredAddon[];
  now?: () => number;
}): AddonCollection {
  const { storage, fetchJson, defaults, now = Date.now } = options;
  const state = createStore<CollectionState>({ ready: false, addons: [] });
  // Raw manifests, kept so storage holds exactly what the addon sent.
  const raw = new Map<string, unknown>();

  function readAll(list: readonly StoredAddon[]): InstalledAddon[] {
    const addons: InstalledAddon[] = [];
    for (const item of list) {
      const addon = item && typeof item.transportUrl === 'string' ? readStored(item) : undefined;
      if (addon && !addons.some((a) => a.transportUrl === addon.transportUrl)) {
        raw.set(addon.transportUrl, item.manifest);
        addons.push(addon);
      }
    }
    return addons;
  }

  function save(addons: readonly InstalledAddon[]) {
    const stored: StoredAddon[] = addons.map((addon) => ({
      transportUrl: addon.transportUrl,
      manifest: raw.get(addon.transportUrl),
      official: addon.official,
      fetchedAt: addon.fetchedAt,
    }));
    storage.set(STORAGE_KEY, stored).catch(() => undefined);
  }

  function update(addons: InstalledAddon[]) {
    state.set({ ready: true, addons });
    save(addons);
  }

  async function fetchManifest(url: string): Promise<{ manifest: Manifest; json: unknown }> {
    let json: unknown;
    try {
      json = await fetchJson(url, { timeoutMs: MANIFEST_TIMEOUT_MS });
    } catch (error) {
      throw new InstallError('unreachable', error instanceof Error ? error.message : String(error));
    }
    try {
      return { manifest: parseManifest(json), json };
    } catch (error) {
      throw new InstallError(
        'not-an-addon',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    get: state.get,
    subscribe: state.subscribe,

    async load() {
      let saved: unknown;
      try {
        saved = await storage.get(STORAGE_KEY);
      } catch {
        saved = undefined;
      }
      // An empty saved list means the user removed everything; only a missing one gets defaults.
      const list = Array.isArray(saved) ? (saved as StoredAddon[]) : defaults;
      const addons = readAll(list);
      state.set({ ready: true, addons });
      if (!Array.isArray(saved)) save(addons);
    },

    async install(input, options = {}) {
      const url = normalizeManifestUrl(input);
      if (url === undefined) throw new InstallError('invalid-url', 'This is not an addon address');
      const { manifest, json } = await fetchManifest(url);
      const current = state.get().addons;
      // New settings must be for the same addon, or a wrong link would quietly swap it out.
      const target = current.find((a) => a.transportUrl === options.replaces);
      if (target && target.manifest.id !== manifest.id) {
        throw new InstallError('different-addon', 'That link is for a different addon');
      }
      raw.set(url, json);
      const existing = current.find((a) => a.transportUrl === url);
      const addon: InstalledAddon = {
        transportUrl: url,
        manifest,
        official: existing?.official ?? false,
        fetchedAt: now(),
      };
      const replaced = current.find((a) => a !== existing && a.transportUrl === options.replaces);
      let next: InstalledAddon[];
      if (existing) {
        next = current.map((a) => (a === existing ? addon : a)).filter((a) => a !== replaced);
      } else if (replaced) {
        next = current.map((a) => (a === replaced ? addon : a));
      } else {
        next = current.concat(addon);
      }
      if (replaced) raw.delete(replaced.transportUrl);
      update(next);
      return addon;
    },

    remove(transportUrl) {
      const current = state.get().addons;
      if (!current.some((a) => a.transportUrl === transportUrl)) return;
      raw.delete(transportUrl);
      update(current.filter((a) => a.transportUrl !== transportUrl));
    },

    move(transportUrl, offset) {
      const addons = state.get().addons.slice();
      const from = addons.findIndex((a) => a.transportUrl === transportUrl);
      if (from === -1) return;
      const to = Math.max(0, Math.min(addons.length - 1, from + offset));
      if (to === from) return;
      const [addon] = addons.splice(from, 1);
      addons.splice(to, 0, addon!);
      update(addons);
    },

    async refreshManifests(maxAgeMs) {
      const due = state.get().addons.filter((a) => now() - a.fetchedAt >= maxAgeMs);
      const fetched = await Promise.all(
        due.map((addon) =>
          fetchManifest(addon.transportUrl).then(
            (result) => ({ url: addon.transportUrl, ...result }),
            () => undefined,
          ),
        ),
      );
      const fresh = new Map<string, Manifest>();
      for (const result of fetched) {
        if (!result) continue;
        raw.set(result.url, result.json);
        fresh.set(result.url, result.manifest);
      }
      if (fresh.size === 0) return;
      // The user may have changed the collection while the manifests were loading.
      const fetchedAt = now();
      update(
        state.get().addons.map((addon) => {
          const manifest = fresh.get(addon.transportUrl);
          return manifest ? { ...addon, manifest, fetchedAt } : addon;
        }),
      );
    },
  };
}
