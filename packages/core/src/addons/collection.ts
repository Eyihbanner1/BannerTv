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
  /**
   * When the manifest was fetched, in ms since 1970. 0 for a copy bundled with
   * the app. A refresh that brings back the same manifest keeps this object as
   * it is, so screens do not draw again: the collection saves the newer time
   * (see toStored) and goes by it.
   */
  fetchedAt: number;
  /**
   * Names this install while its settings change, for when the same addon is
   * installed twice. Read it with installIdOf: it is missing until the
   * address first changes.
   */
  installId?: string;
}

/** A short tag for an address, so what is saved about an install never holds the address, which can hold keys. */
export function addressTag(url: string): string {
  // FNV-1a: the same on every launch.
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index++) {
    hash = Math.imul(hash ^ url.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** A name for this install that stays when it is set up again: a tag of the address it was first installed from. */
export function installIdOf(addon: InstalledAddon): string {
  return addon.installId ?? addressTag(addon.transportUrl);
}

/**
 * Gives `addon` a name no other install in `taken` has. A copy set up again
 * keeps the tag of its first address, so a later install from that address
 * needs another.
 */
function nameApart(addon: InstalledAddon, taken: Set<string>): void {
  let id = installIdOf(addon);
  for (let count = 2; taken.has(id); count++) id = addressTag(`${addon.transportUrl}#${count}`);
  if (id !== installIdOf(addon)) addon.installId = id;
  taken.add(id);
}

/** How an addon is kept in storage: the manifest as the addon sent it, re-read at every launch. */
export interface StoredAddon {
  transportUrl: string;
  manifest: unknown;
  official: boolean;
  fetchedAt: number;
  installId?: string;
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
  /** The collection as it is saved, with every install's name (installIdOf) filled in. */
  toStored(): StoredAddon[];
  /**
   * Makes the collection match a change from the BannerTV account, with no
   * request to any addon. Each addon in `set` names its install: it replaces
   * that install, or one at the same address, or else joins the end. One
   * already here at the same address keeps its own manifest. Installs named in
   * `remove` leave, and `order` (install names) puts the rest in order, any
   * it does not name after it as they were. The change is made before
   * adopt() returns.
   */
  adopt(change: CollectionAdoption): Promise<void>;
}

/** What the BannerTV account changes in the collection. */
export interface CollectionAdoption {
  set?: readonly StoredAddon[];
  remove?: readonly string[];
  order?: readonly string[];
}

/** The scheme and host of an address normalizeManifestUrl has accepted. */
function origin(url: string): string {
  return (/^https?:\/\/[^/?#]+/i.exec(url)?.[0] ?? url).toLowerCase();
}

/** An addon id without a trailing settings hash, e.g. `org.example.0123456789ab` → `org.example`. */
function idStem(id: string): string {
  return id.replace(/[.:|-][0-9a-f]{8,}$/i, '');
}

function readStored(value: StoredAddon): InstalledAddon | undefined {
  try {
    const addon: InstalledAddon = {
      transportUrl: value.transportUrl,
      manifest: parseManifest(value.manifest),
      official: value.official === true,
      fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
    };
    if (typeof value.installId === 'string' && value.installId !== '') {
      addon.installId = value.installId;
    }
    return addon;
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
  // When a refresh last found an addon's manifest unchanged. The addon keeps its
  // object, so this time is saved and checked in place of its own fetchedAt.
  const checkedAt = new WeakMap<InstalledAddon, number>();
  const fetchedAtOf = (addon: InstalledAddon) => checkedAt.get(addon) ?? addon.fetchedAt;

  function readAll(list: readonly StoredAddon[]): InstalledAddon[] {
    const addons: InstalledAddon[] = [];
    const names = new Set<string>();
    for (const item of list) {
      const addon = item && typeof item.transportUrl === 'string' ? readStored(item) : undefined;
      if (addon && !addons.some((a) => a.transportUrl === addon.transportUrl)) {
        raw.set(addon.transportUrl, item.manifest);
        nameApart(addon, names);
        addons.push(addon);
      }
    }
    return addons;
  }

  function stored(addons: readonly InstalledAddon[]): StoredAddon[] {
    return addons.map((addon) => ({
      transportUrl: addon.transportUrl,
      manifest: raw.get(addon.transportUrl),
      official: addon.official,
      fetchedAt: fetchedAtOf(addon),
      installId: installIdOf(addon),
    }));
  }

  function save(addons: readonly InstalledAddon[]) {
    const stored: StoredAddon[] = addons.map((addon) => {
      const item: StoredAddon = {
        transportUrl: addon.transportUrl,
        manifest: raw.get(addon.transportUrl),
        official: addon.official,
        fetchedAt: fetchedAtOf(addon),
      };
      // Only an install whose address changed needs its name kept.
      const id = installIdOf(addon);
      if (id !== addressTag(addon.transportUrl)) item.installId = id;
      return item;
    });
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
      // New settings must be for the same addon, or a wrong link would quietly
      // swap it out. Some addons put a hash of their settings at the end of the
      // id, and may take the name from the settings too, so on the same server
      // the same name or the same id before the hash also counts. One server
      // can host several addons, so the server alone does not.
      const target = current.find((a) => a.transportUrl === options.replaces);
      const sameAddon =
        !target ||
        url === target.transportUrl ||
        target.manifest.id === manifest.id ||
        (origin(target.transportUrl) === origin(url) &&
          (target.manifest.name === manifest.name ||
            idStem(target.manifest.id) === idStem(manifest.id)));
      if (!sameAddon) {
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
      // Set up again on its settings page, it is the same install: Home rows keep its settings.
      if (existing?.installId) addon.installId = existing.installId;
      else if (!existing && replaced) addon.installId = installIdOf(replaced);
      else if (!existing) {
        nameApart(addon, new Set(current.map(installIdOf)));
      }
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
      const due = state.get().addons.filter((a) => now() - fetchedAtOf(a) >= maxAgeMs);
      const fetched = await Promise.all(
        due.map((addon) =>
          fetchManifest(addon.transportUrl).then(
            (result) => ({ url: addon.transportUrl, ...result }),
            () => undefined,
          ),
        ),
      );
      const fresh = new Map<string, Manifest>();
      const same = new Set<string>();
      for (const result of fetched) {
        if (!result) continue;
        // Most days nothing changed. Keeping the addon and its raw manifest then means
        // Home, sports and sync see the same objects and have nothing to do again.
        if (JSON.stringify(result.json) === JSON.stringify(raw.get(result.url))) {
          same.add(result.url);
          continue;
        }
        raw.set(result.url, result.json);
        fresh.set(result.url, result.manifest);
      }
      if (fresh.size === 0 && same.size === 0) return;
      // The user may have changed the collection while the manifests were loading.
      const fetchedAt = now();
      let changed = false;
      const addons = state.get().addons.map((addon) => {
        if (same.has(addon.transportUrl)) checkedAt.set(addon, fetchedAt);
        const manifest = fresh.get(addon.transportUrl);
        if (!manifest) return addon;
        changed = true;
        return { ...addon, manifest, fetchedAt };
      });
      // When only the times changed they are saved, but no screen reads them.
      if (changed) update(addons);
      else save(addons);
    },

    toStored: () => stored(state.get().addons),

    async adopt(change) {
      // Before the saved collection is read, this would save over it.
      if (!state.get().ready) return;
      let list = stored(state.get().addons);
      const before = JSON.stringify(list.map((item) => [item.installId, item.transportUrl]));
      const removing = new Set(change.remove ?? []);
      list = list.filter((item) => !removing.has(item.installId!));
      for (const incoming of change.set ?? []) {
        if (!incoming || typeof incoming.transportUrl !== 'string' || !incoming.installId) continue;
        const at = list.findIndex(
          (item) =>
            item.installId === incoming.installId || item.transportUrl === incoming.transportUrl,
        );
        const old = at === -1 ? undefined : list[at]!;
        // The same address: what this screen fetched is as good, and maybe fresher.
        const item: StoredAddon =
          old && old.transportUrl === incoming.transportUrl
            ? { ...old, official: incoming.official === true, installId: incoming.installId }
            : {
                transportUrl: incoming.transportUrl,
                manifest: incoming.manifest,
                official: incoming.official === true,
                fetchedAt: 0,
                installId: incoming.installId,
              };
        // Another install of this screen's at the same address leaves, as one install per address is kept.
        list = list.filter(
          (other, index) => index === at || other.transportUrl !== incoming.transportUrl,
        );
        const place = old ? list.indexOf(old) : -1;
        if (place === -1) list.push(item);
        else list[place] = item;
      }
      if (change.order) {
        const rank = new Map(change.order.map((id, index) => [id, index]));
        list = list
          .map((item, index) => ({ item, index, rank: rank.get(item.installId!) }))
          .sort((a, b) => {
            if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
            if (a.rank !== undefined) return -1;
            if (b.rank !== undefined) return 1;
            return a.index - b.index;
          })
          .map(({ item }) => item);
      }
      const after = JSON.stringify(list.map((item) => [item.installId, item.transportUrl]));
      const official = (items: StoredAddon[]) => items.map((item) => item.official).join();
      if (after === before && official(list) === official(stored(state.get().addons))) return;
      const addons = readAll(list);
      // Addresses that left take their manifests with them.
      const kept = new Set(addons.map((addon) => addon.transportUrl));
      Array.from(raw.keys()).forEach((url) => {
        if (!kept.has(url)) raw.delete(url);
      });
      update(addons);
    },
  };
}
