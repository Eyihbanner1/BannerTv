import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { PartItem, SyncPart } from '../sync/part';
import {
  type AddonCollection,
  type CollectionState,
  type InstalledAddon,
  installIdOf,
} from './collection';

/** Where the switched-off installs are kept: by install name only, never by address. */
const STORAGE_KEY = 'addons.off';
/** Installs remembered at most: far more than anyone installs, so a bad save cannot grow. */
const MAX_INSTALLS = 100;
/** The switches' keys in the account's `addons` document. */
const OFF = 'off/';

const NONE: ReadonlySet<string> = new Set();

export interface SwitchesState {
  /** False until what was saved has been read. */
  ready: boolean;
  /** The installs switched off, by install name (installIdOf). */
  off: ReadonlySet<string>;
}

/**
 * Which addons are switched off: still installed, with their settings and
 * their place in the list, but asked nothing and shown nowhere. One set for
 * the whole screen, as the addons are, and the account's when there is one
 * (`addonSwitchesPart`). An install that leaves the collection takes its
 * switch with it.
 */
export interface AddonSwitches {
  /** Reads what was saved. A switch changed before that waits for it. */
  load(): Promise<void>;
  /** The same object until something changes, for useSyncExternalStore. */
  get(): SwitchesState;
  subscribe(listener: () => void): () => void;
  isOff(addon: InstalledAddon): boolean;
  /** Switches an install off, or back on. Nothing else about it changes. */
  set(installId: string, off: boolean): void;
  /**
   * The account's switches: `off` switched off, `on` back on. Once the saved
   * set has been read, the change is made before this returns, and only the
   * saving is waited for (SyncPart.adopt).
   */
  adopt(off: readonly string[], on: readonly string[]): Promise<void>;
}

function readIds(saved: unknown): ReadonlySet<string> {
  if (!Array.isArray(saved)) return NONE;
  const ids = saved
    .slice(-MAX_INSTALLS)
    .filter((id): id is string => typeof id === 'string' && id !== '');
  return ids.length > 0 ? new Set(ids) : NONE;
}

/** `ids` with `off` added and `on` taken away; `ids` itself when that changes nothing. */
function switched(
  ids: ReadonlySet<string>,
  off: readonly string[],
  on: readonly string[],
): ReadonlySet<string> {
  const next = new Set(ids);
  off.forEach((id) => next.add(id));
  on.forEach((id) => next.delete(id));
  if (next.size === ids.size && Array.from(next).every((id) => ids.has(id))) return ids;
  return next.size > 0 ? next : NONE;
}

export function createAddonSwitches(options: {
  storage: KeyValueStore;
  /** The whole collection, switched-off installs included: those that leave it lose their switch. */
  collection: Pick<AddonCollection, 'get' | 'subscribe'>;
}): AddonSwitches {
  const { collection } = options;
  const saved = createPersisted<ReadonlySet<string>>({
    storage: options.storage,
    key: STORAGE_KEY,
    initial: NONE,
    read: readIds,
    write: (ids) => Array.from(ids).slice(-MAX_INSTALLS),
  });
  let shown: SwitchesState = { ready: false, off: NONE };
  const get = () => {
    const ready = saved.loaded();
    const off = saved.get();
    if (shown.ready !== ready || shown.off !== off) shown = { ready, off };
    return shown;
  };
  // Before the saved set is read, a change waits for it (Persisted.updateNow), so a switch
  // changed at launch, or an install removed then, is laid over what was saved.
  const change = (off: readonly string[], on: readonly string[]) =>
    saved.updateNow((ids) => switched(ids, off, on)).catch(() => undefined);

  // An install removed (here, or by the account) takes its switch with it, so an addon added
  // again from its address comes back on. An addon set up again keeps its install name, and
  // so its switch.
  let installed: readonly string[] | undefined;
  const followRemovals = () => {
    const { ready, addons } = collection.get();
    if (!ready) return;
    const ids = addons.map(installIdOf);
    const gone = installed ? installed.filter((id) => ids.indexOf(id) === -1) : [];
    installed = ids;
    if (gone.length > 0) void change([], gone);
  };
  collection.subscribe(followRemovals);
  followRemovals();

  return {
    load: saved.load,
    get,
    subscribe: saved.subscribe,
    isOff: (addon) => saved.get().has(installIdOf(addon)),
    set(installId, off) {
      void (off ? change([installId], []) : change([], [installId]));
    },
    adopt: (off, on) => change(off, on),
  };
}

function sameAddons(a: readonly InstalledAddon[], b: readonly InstalledAddon[]): boolean {
  return a.length === b.length && a.every((addon, index) => addon === b[index]);
}

/**
 * The collection as the app uses it: every install but those switched off,
 * in the same order, so Home, Search, Discover, Sports, the player and the
 * addon client ask a switched-off addon nothing and show it nowhere. It is
 * not ready until the switches have been read too, so a switched-off addon
 * is never asked for a first row at launch.
 *
 * get() returns the collection's own state while nothing is switched off,
 * and otherwise the same object until what it holds changes. Adding,
 * removing, moving and refreshing are the collection's, over every install.
 * toStored() lists only what get() does, so the account's part
 * (collectionPart) must be given the whole collection, never this.
 */
export function switchedOnOnly(
  collection: AddonCollection,
  switches: Pick<AddonSwitches, 'load' | 'get' | 'subscribe'>,
): AddonCollection {
  let last: { from: CollectionState; switches: SwitchesState; view: CollectionState } | undefined;

  function get(): CollectionState {
    const from = collection.get();
    const state = switches.get();
    if (last && last.from === from && last.switches === state) return last.view;
    const ready = from.ready && state.ready;
    const addons = state.ready ? from.addons.filter((a) => !state.off.has(installIdOf(a))) : [];
    let view: CollectionState;
    if (ready === from.ready && addons.length === from.addons.length) view = from;
    else if (last && last.view.ready === ready && sameAddons(last.view.addons, addons)) {
      view = last.view;
    } else view = { ready, addons };
    last = { from, switches: state, view };
    return view;
  }

  return {
    get,
    subscribe(listener) {
      // Told only when what get() returns changes: a switched-off addon's manifest refresh is
      // no news here.
      let seen = get();
      const check = () => {
        const next = get();
        if (next === seen) return;
        seen = next;
        listener();
      };
      const offCollection = collection.subscribe(check);
      const offSwitches = switches.subscribe(check);
      return () => {
        offCollection();
        offSwitches();
      };
    },
    load: () => Promise.all([collection.load(), switches.load()]).then(() => undefined),
    install: (input, options) => collection.install(input, options),
    remove: (transportUrl) => collection.remove(transportUrl),
    move: (transportUrl, offset) => collection.move(transportUrl, offset),
    refreshManifests: (maxAgeMs) => collection.refreshManifests(maxAgeMs),
    toStored() {
      const shown = new Set(get().addons.map(installIdOf));
      return collection.toStored().filter((item) => shown.has(item.installId!));
    },
    adopt: (change) => collection.adopt(change),
  };
}

/**
 * The switches as `off/<installId>` in `addons`: 1 while the addon is off.
 * On is no item, so switching one back on is a removal. A build without
 * switches has no such part, so it leaves those keys in the account as they
 * are, and its addons all answer there.
 *
 * Only a switch the store holds counts as its own (ownData): at the first
 * launch of a build with switches, the store holds none, and the account's
 * switches are brought in rather than taken for switched back on while
 * nothing watched.
 */
export function addonSwitchesPart(switches: AddonSwitches): SyncPart {
  let seen: SwitchesState | undefined;
  let items = new Map<string, PartItem>();
  return {
    document: 'addons',
    prefixes: [OFF],
    load: () => switches.load(),
    snapshot() {
      const state = switches.get();
      if (state !== seen) {
        seen = state;
        items = new Map();
        state.off.forEach((id) => items.set(OFF + id, { v: 1 }));
      }
      return new Map(items);
    },
    subscribe: (listener) => switches.subscribe(listener),
    adopt(change) {
      // 1 is off. A value this build does not know leaves the switch as it is.
      const off: string[] = [];
      change.set.forEach((item, key) => {
        if (item.v === 1) off.push(key.slice(OFF.length));
      });
      const on = change.remove.map((key) => key.slice(OFF.length));
      if (off.length === 0 && on.length === 0) return Promise.resolve();
      return switches.adopt(off, on);
    },
    ownData: () => switches.get().off.size > 0,
  };
}
