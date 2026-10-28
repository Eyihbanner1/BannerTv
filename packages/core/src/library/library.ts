import type { ContentType, MetaPreview } from '@bannertv/protocol';
import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';

const KEY = 'library';
export const MAX_LIBRARY_ITEMS = 1000;
const IMDB = /^tt\d+$/;

/** A saved title: what a tile needs, so the Library opens without asking any addon. */
export interface LibraryItem {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
  /** Milliseconds since 1970. */
  addedAt: number;
}

/** A change made on the TV that Trakt has not been told about yet. */
export interface LibraryChange {
  op: 'add' | 'remove';
  id: string;
  type: ContentType;
}

/** A title as Trakt's watchlist lists it. */
export interface RemoteLibraryItem {
  id: string;
  /**
   * Other ids Trakt gives the same title, such as `tmdb:603` beside
   * `tt0133093`. One My List already uses is taken in place of `id`.
   */
  otherIds?: string[];
  type: ContentType;
  name: string;
  releaseInfo?: string;
  /** When it was put on the list, milliseconds since 1970. */
  addedAt: number;
}

interface LibraryState {
  /** Most recently added first. */
  items: LibraryItem[];
  /** Changes not sent to Trakt yet, oldest first, at most one per title. */
  outbox: LibraryChange[];
  /** The ids Trakt's list had at the last sync, to tell a removal there from an addition here. */
  synced: string[];
}

export interface Library {
  load(): Promise<void>;
  has(id: string): boolean;
  get(id: string): LibraryItem | undefined;
  /** Most recently added first. */
  items(): readonly LibraryItem[];
  add(item: MetaPreview): Promise<void>;
  /**
   * Takes a title out. Trakt is told only when the title is on its list as
   * far as the TV knows; otherwise any addition still waiting is dropped.
   */
  remove(id: string): Promise<void>;
  /**
   * Fills in a saved title's name and artwork from a fresh answer, for titles
   * that came from Trakt with a name only. Keeps when it was added.
   */
  refresh(item: MetaPreview): Promise<void>;
  /** Changes made on the TV that Trakt has not been told about, oldest first. */
  outbox(): readonly LibraryChange[];
  /**
   * Forgets changes Trakt now has. A title taken off here while its addition
   * was on its way gets a removal queued, since Trakt has it now.
   */
  sent(changes: readonly LibraryChange[]): Promise<void>;
  /**
   * Brings in Trakt's list: what was added there is added here, what was
   * removed there (it was in Trakt's list at the last sync and is not now)
   * is removed here, unless the TV has a newer change of its own waiting in
   * the outbox. Titles saved here that Trakt never had are queued to be sent.
   * A title goes by whichever of its ids My List already uses.
   */
  mergeRemote(remote: readonly RemoteLibraryItem[]): Promise<void>;
  /** Forgets the sync state, for signing out of Trakt. The titles stay. */
  forgetRemote(): Promise<void>;
  /** Bumps on every change, for screens that show the library. */
  version(): number;
  subscribe(listener: Listener): () => void;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function readItem(value: unknown): LibraryItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (!isText(raw.id) || !isText(raw.type) || !isText(raw.name) || !isTime(raw.addedAt)) {
    return undefined;
  }
  const item: LibraryItem = { id: raw.id, type: raw.type, name: raw.name, addedAt: raw.addedAt };
  for (const field of ['poster', 'background', 'logo', 'releaseInfo', 'imdbRating'] as const) {
    if (isText(raw[field])) item[field] = raw[field];
  }
  if (Array.isArray(raw.genres)) {
    const genres = raw.genres.filter(isText).slice(0, 6);
    if (genres.length > 0) item.genres = genres;
  }
  return item;
}

function readChange(value: unknown): LibraryChange | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { op, id, type } = value as Record<string, unknown>;
  if ((op !== 'add' && op !== 'remove') || !isText(id) || !isText(type)) return undefined;
  return { op, id, type };
}

function readState(saved: unknown): LibraryState {
  const raw = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  for (const value of Array.isArray(raw.items) ? raw.items : []) {
    const item = readItem(value);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const outbox = (Array.isArray(raw.outbox) ? raw.outbox : [])
    .map(readChange)
    .filter((change): change is LibraryChange => change !== undefined);
  const synced = (Array.isArray(raw.synced) ? raw.synced : []).filter(isText);
  return { items: newestFirst(items).slice(0, MAX_LIBRARY_ITEMS), outbox, synced };
}

/** Chromium 68 sorts unstably, so equal times keep their order by hand. */
function newestFirst(items: LibraryItem[]): LibraryItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.addedAt - a.item.addedAt || a.index - b.index)
    .map(({ item }) => item);
}

function itemFrom(preview: MetaPreview, addedAt: number): LibraryItem {
  const item: LibraryItem = { id: preview.id, type: preview.type, name: preview.name, addedAt };
  if (preview.poster) item.poster = preview.poster;
  if (preview.background) item.background = preview.background;
  if (preview.logo) item.logo = preview.logo;
  if (preview.releaseInfo) item.releaseInfo = preview.releaseInfo;
  if (preview.imdbRating) item.imdbRating = preview.imdbRating;
  if (preview.genres.length > 0) item.genres = preview.genres.slice(0, 6);
  return item;
}

/** Changes kept for Trakt at most; without a Trakt account nothing ever sends them. */
const MAX_OUTBOX = 2 * MAX_LIBRARY_ITEMS;

/** The outbox with `change` as the title's latest change, replacing any earlier one. */
function queue(outbox: readonly LibraryChange[], change: LibraryChange): LibraryChange[] {
  return outbox
    .filter((c) => c.id !== change.id)
    .concat(change)
    .slice(-MAX_OUTBOX);
}

/** "My List" for one profile, kept in the key-value store, at most MAX_LIBRARY_ITEMS titles. */
export function createLibrary(options: { storage: KeyValueStore; now?: () => number }): Library {
  const { storage, now = Date.now } = options;
  const state = createPersisted<LibraryState>({
    storage,
    key: KEY,
    initial: { items: [], outbox: [], synced: [] },
    read: readState,
  });
  let changes = 0;
  let index = new Map<string, LibraryItem>();
  let indexed: LibraryItem[] | null = null;

  function lookup(): Map<string, LibraryItem> {
    const items = state.get().items;
    if (indexed !== items) {
      index = new Map(items.map((item) => [item.id, item]));
      indexed = items;
    }
    return index;
  }

  state.subscribe(() => {
    changes += 1;
  });

  return {
    load: state.load,
    has: (id) => lookup().has(id),
    get: (id) => lookup().get(id),
    items: () => state.get().items,
    add(preview) {
      return state.update((current) => {
        const item = itemFrom(preview, now());
        const all = [item, ...current.items.filter((i) => i.id !== item.id)];
        // The oldest titles past the limit leave, and so do their additions still
        // waiting for Trakt: a title not on My List is not put on Trakt's list.
        const dropped = new Set(all.slice(MAX_LIBRARY_ITEMS).map((i) => i.id));
        const outbox = current.outbox.filter((c) => c.op !== 'add' || !dropped.has(c.id));
        return {
          ...current,
          items: all.slice(0, MAX_LIBRARY_ITEMS),
          outbox: queue(outbox, { op: 'add', id: item.id, type: item.type }),
        };
      });
    },
    remove(id) {
      return state.update((current) => {
        const item = current.items.find((i) => i.id === id);
        if (!item) return current;
        // A title Trakt's list never had has nothing there to take off. Removing it
        // anyway would reach whichever account signs in next, and take theirs.
        const onTrakt = current.synced.indexOf(id) !== -1;
        return {
          ...current,
          items: current.items.filter((i) => i.id !== id),
          outbox: onTrakt
            ? queue(current.outbox, { op: 'remove', id, type: item.type })
            : current.outbox.filter((change) => change.id !== id),
        };
      });
    },
    refresh(preview) {
      return state.update((current) => {
        const at = current.items.findIndex((i) => i.id === preview.id);
        if (at < 0) return current;
        const old = current.items[at]!;
        const item = itemFrom(preview, old.addedAt);
        item.type = old.type;
        const same = (Object.keys(item) as Array<keyof LibraryItem>).every(
          (field) => JSON.stringify(item[field]) === JSON.stringify(old[field]),
        );
        if (same && Object.keys(old).length === Object.keys(item).length) return current;
        const items = current.items.slice();
        items[at] = item;
        return { ...current, items };
      });
    },
    outbox: () => state.get().outbox,
    sent(sentChanges) {
      return state.update((current) => {
        const done = (change: LibraryChange) =>
          sentChanges.some((s) => s.id === change.id && s.op === change.op);
        let outbox = current.outbox.filter((change) => !done(change));
        const saved = new Set(current.items.map((item) => item.id));
        let synced = current.synced;
        for (const change of sentChanges) {
          synced = synced.filter((id) => id !== change.id);
          if (change.op !== 'add') continue;
          synced = synced.concat(change.id);
          // Taken off here while the addition was on its way: it is on Trakt's list
          // now, so the removal goes there too, or the next sync would bring it back.
          if (!saved.has(change.id) && !outbox.some((c) => c.id === change.id)) {
            outbox = queue(outbox, { op: 'remove', id: change.id, type: change.type });
          }
        }
        if (outbox.length === current.outbox.length && synced === current.synced) return current;
        return { ...current, outbox, synced };
      });
    },
    mergeRemote(remote) {
      return state.update((current) => {
        const pending = new Map(current.outbox.map((change) => [change.id, change]));
        const before = new Set(current.synced);
        const saved = new Map(current.items.map((item) => [item.id, item.type]));
        // A film and a show can share a TMDB number, so an id the TV knows is the
        // same title only when it is of the same type. The ids synced keep no
        // type, so of those only an IMDb id, which names one title, counts.
        const known = (id: string, type: ContentType) => {
          const local = saved.get(id) ?? pending.get(id)?.type;
          if (local !== undefined) return local === type;
          return before.has(id) && IMDB.test(id);
        };
        // Trakt names a title by every id it has; here it goes by the one the TV used.
        const remoteIds = new Set<string>();
        const listed: RemoteLibraryItem[] = [];
        for (const entry of remote) {
          const local = [entry.id]
            .concat(entry.otherIds ?? [])
            .filter((id) => known(id, entry.type));
          if (local.length === 0) local.push(entry.id);
          local.forEach((id) => remoteIds.add(id));
          listed.push({ ...entry, id: local[0] ?? entry.id });
        }
        let outbox = current.outbox;
        const items: LibraryItem[] = [];
        for (const item of current.items) {
          if (remoteIds.has(item.id)) {
            items.push(item);
            continue;
          }
          // Removed on Trakt since the last sync, and not added again here since.
          if (before.has(item.id) && pending.get(item.id)?.op !== 'add') continue;
          items.push(item);
          if (!pending.has(item.id)) {
            outbox = queue(outbox, { op: 'add', id: item.id, type: item.type });
          }
        }
        const have = new Set(items.map((item) => item.id));
        for (const entry of listed) {
          if (have.has(entry.id)) continue;
          // Removed here and not sent yet: the removal goes to Trakt instead.
          if (pending.get(entry.id)?.op === 'remove') continue;
          const item: LibraryItem = {
            id: entry.id,
            type: entry.type,
            name: entry.name,
            addedAt: entry.addedAt,
          };
          if (entry.releaseInfo) item.releaseInfo = entry.releaseInfo;
          items.push(item);
          have.add(entry.id);
        }
        const kept = newestFirst(items).slice(0, MAX_LIBRARY_ITEMS);
        // A title that does not fit is not sent to Trakt only to be dropped here.
        const fits = new Set(kept.map((item) => item.id));
        return {
          items: kept,
          outbox: outbox.filter((change) => change.op !== 'add' || fits.has(change.id)),
          synced: Array.from(remoteIds),
        };
      });
    },
    forgetRemote() {
      return state.update((current) =>
        current.outbox.length === 0 && current.synced.length === 0
          ? current
          : { ...current, outbox: [], synced: [] },
      );
    },
    version: () => changes,
    subscribe: state.subscribe,
  };
}
