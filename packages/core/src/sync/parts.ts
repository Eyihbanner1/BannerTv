import { addressTag, type AddonCollection, type StoredAddon } from '../addons/collection';
import { DEFAULT_ADDONS } from '../addons/defaults';
import { createHomeLayout, type HomeLayout, type HomeLayoutStore } from '../addons/layout';
import { createLibrary, type Library, type LibraryItem } from '../library/library';
import { createPlayedVideos, type PlayedVideo, type PlayedVideos } from '../playback/continue';
import { createSubtitleDrifts, type DriftChoice, type SubtitleDrifts } from '../playback/drifts';
import { createSubtitleOffsets, type SubtitleOffsets } from '../playback/offsets';
import { createProgressStore, type ProgressEntry, type ProgressStore } from '../playback/progress';
import { createTrackMemory, type TrackChoice, type TrackMemory } from '../playback/tracks';
import type { KeyValueStore } from '../storage';
import type { LiveItem } from './items';
import { DOCUMENT_CAPS } from './merge';
import type { PartChange, PartItem, SyncPart } from './part';

/** A card's description is cut to this many characters before it rides along. */
export const CARD_DESCRIPTION_LENGTH = 300;

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Times in milliseconds that are whole seconds: Trakt's always are, BannerTV's about once in a thousand. */
const wholeSecond = (time: number) => time % 1000 === 0;

/** The account's items with the oldest first, so the store takes the newest as its most recent. */
function oldestFirst(set: Map<string, LiveItem>): Array<[string, LiveItem]> {
  return Array.from(set.entries()).sort((a, b) => a[1].t - b[1].t);
}

function copyFields(from: Fields, fields: readonly string[]): Fields {
  const out: Fields = {};
  for (const field of fields) if (from[field] !== undefined) out[field] = from[field];
  return out;
}

const TILE_FIELDS = [
  'type',
  'name',
  'poster',
  'background',
  'logo',
  'releaseInfo',
  'imdbRating',
  'genres',
] as const;

/**
 * My List as `p/<id>/list`: one item per title, at the time it was added.
 * Only the type and that time are compared, so new artwork is not an edit.
 */
export function libraryPart(profileId: string, library: Library): SyncPart {
  const made = new WeakMap<LibraryItem, PartItem>();
  const itemOf = (item: LibraryItem): PartItem => {
    let part = made.get(item);
    if (!part) {
      part = { v: copyFields(item as unknown as Fields, TILE_FIELDS), t: item.addedAt };
      if (item.from === 'trakt') part.trakt = true;
      made.set(item, part);
    }
    return part;
  };
  const tileOf = (id: string, item: LiveItem): LibraryItem | undefined => {
    if (!isObject(item.v)) return undefined;
    return { ...(copyFields(item.v, TILE_FIELDS) as object), id, addedAt: item.t } as LibraryItem;
  };
  return {
    document: `p/${profileId}/list`,
    prefixes: [''],
    load: () => library.load(),
    snapshot() {
      const items = new Map<string, PartItem>();
      for (const item of library.items()) items.set(item.id, itemOf(item));
      return items;
    },
    compare: (key, value) => ({ type: isObject(value) ? value.type : undefined }),
    subscribe: (listener) => library.subscribe(listener),
    adopt(change) {
      const set: LibraryItem[] = [];
      change.set.forEach((item, id) => {
        const tile = tileOf(id, item);
        if (tile) set.push(tile);
      });
      return library.adopt({ set, remove: change.remove, onlyHere: change.reset === true });
    },
    markTrakt(keys) {
      const set: LibraryItem[] = [];
      for (const id of keys) {
        const item = library.get(id);
        if (item) set.push({ ...item, from: 'trakt' });
      }
      return library.adopt({ set });
    },
    ownData: () => library.items().some((item) => !item.from && !wholeSecond(item.addedAt)),
  };
}

/** The card fields that ride along with progress: everything but the ids, the time and `filled`. */
const CARD_FIELDS = [
  'name',
  'poster',
  'background',
  'logo',
  'releaseInfo',
  'runtime',
  'imdbRating',
  'description',
  'genres',
  'season',
  'episode',
  'episodeName',
  'next',
] as const;

/** A description cut at a word to at most CARD_DESCRIPTION_LENGTH characters. */
function shortDescription(text: string): string {
  if (text.length <= CARD_DESCRIPTION_LENGTH) return text;
  const cut = text.slice(0, CARD_DESCRIPTION_LENGTH - 1);
  const space = cut.lastIndexOf(' ');
  const words = space > CARD_DESCRIPTION_LENGTH / 2 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s,.;:]+$/, '')}…`;
}

function cardValue(card: PlayedVideo): Fields {
  const value = copyFields(card as unknown as Fields, CARD_FIELDS);
  if (typeof value.description === 'string')
    value.description = shortDescription(value.description);
  return value;
}

/** A time a video was marked not watched, as the merge counts one (sync/merge.ts). */
function isUnmarkTime(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value > 0;
}

/**
 * Continue Watching as `p/<id>/watch`: one item per video, at the time its
 * progress was saved, with the card that played beside it. The card is not
 * compared, beyond whether there is one; a card this screen filled in from
 * the meta addon never rides along. `unmarkedAt` (when the viewer last marked
 * the video not watched) rides along so the merge can let that unwatch beat
 * older watched ticks from other screens.
 */
export function watchPart(
  profileId: string,
  progress: ProgressStore,
  played: PlayedVideos,
): SyncPart {
  const made = new WeakMap<ProgressEntry, { card: PlayedVideo | undefined; part: PartItem }>();
  const itemOf = (entry: ProgressEntry): PartItem => {
    const card = played.get(entry.videoId);
    const known = made.get(entry);
    if (known && known.card === card) return known.part;
    const value: Fields = {
      metaId: entry.metaId,
      type: entry.type,
      position: entry.position,
      duration: entry.duration,
      watched: entry.watched,
    };
    if (entry.continueRow === false) value.continueRow = false;
    if (isUnmarkTime(entry.unmarkedAt)) value.unmarkedAt = entry.unmarkedAt;
    if (card && !card.filled) value.card = cardValue(card);
    const part: PartItem = { v: value, t: entry.updatedAt };
    if (entry.from === 'trakt') part.trakt = true;
    made.set(entry, { card, part });
    return part;
  };
  return {
    document: `p/${profileId}/watch`,
    prefixes: [''],
    load: () => Promise.all([progress.load(), played.load()]).then(() => undefined),
    snapshot() {
      const items = new Map<string, PartItem>();
      for (const entry of progress.recent()) items.set(entry.videoId, itemOf(entry));
      return items;
    },
    compare(key, value) {
      if (!isObject(value)) return value;
      const compared = copyFields(value, [
        'metaId',
        'type',
        'position',
        'duration',
        'watched',
        'continueRow',
        'unmarkedAt',
      ]);
      compared.card = value.card !== undefined;
      return compared;
    },
    subscribe(listener) {
      const offProgress = progress.subscribe(listener);
      const offPlayed = played.subscribe(listener);
      return () => {
        offProgress();
        offPlayed();
      };
    },
    adopt(change: PartChange) {
      const entries: ProgressEntry[] = [];
      const cards: PlayedVideo[] = [];
      for (const [videoId, item] of oldestFirst(change.set)) {
        const value = item.v;
        if (!isObject(value)) continue;
        const entry = {
          metaId: value.metaId,
          type: value.type,
          videoId,
          position: value.position,
          duration: value.duration,
          updatedAt: item.t,
          watched: value.watched === true,
        } as ProgressEntry;
        if (value.continueRow === false) entry.continueRow = false;
        if (isUnmarkTime(value.unmarkedAt)) entry.unmarkedAt = value.unmarkedAt;
        entries.push(entry);
        if (isObject(value.card)) {
          cards.push({
            ...(copyFields(value.card, CARD_FIELDS) as object),
            videoId,
            metaId: entry.metaId,
            type: entry.type,
            updatedAt: item.t,
          } as PlayedVideo);
        }
      }
      // Both stores change before either is waited for (SyncPart.adopt).
      const saved = [progress.adopt({ set: entries, remove: change.remove })];
      // Only a join with Use takes progress away; its cards go with it.
      if (cards.length > 0 || change.remove.length > 0) {
        saved.push(played.adopt({ set: cards, remove: change.remove }));
      }
      return Promise.all(saved).then(() => undefined);
    },
    markTrakt(keys) {
      const set: ProgressEntry[] = [];
      for (const videoId of keys) {
        const entry = progress.get(videoId);
        if (entry) set.push({ ...entry, from: 'trakt' });
      }
      return progress.adopt({ set });
    },
    ownData: () => progress.recent().some((entry) => !entry.from && !wholeSecond(entry.updatedAt)),
  };
}

const ORDER = 'home/order';
const HIDDEN = 'home/hidden';

function rowIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id === 'string' && id !== '' && ids.indexOf(id) === -1) ids.push(id);
  }
  return ids.slice(0, DOCUMENT_CAPS.rows);
}

/**
 * The account's row order with this screen's own rows kept: each row only
 * `local` has goes right after the nearest row before it in `local` that the
 * account has, or first when there is none. A screen orders only the rows on
 * its own board (another addon, or catalogs its Sports took off Home), so
 * taking the account's order whole would lose where its other rows go.
 */
export function mergeRowOrder(account: readonly string[], local: readonly string[]): string[] {
  const order = rowIds(account);
  const placed = new Set(order);
  let after: string | undefined;
  for (const id of local) {
    if (placed.has(id)) {
      after = id;
      continue;
    }
    order.splice(after === undefined ? 0 : order.indexOf(after) + 1, 0, id);
    placed.add(id);
    after = id;
  }
  return order.slice(0, DOCUMENT_CAPS.rows);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Home's row order and hidden rows as `home/order` and `home/hidden` in
 * `p/<id>/settings`. An empty list is no item: a screen that never arranged
 * Home has nothing to say about it, and going back to none is a removal.
 */
export function homeLayoutPart(profileId: string, layout: HomeLayoutStore): SyncPart {
  let seen: HomeLayout | undefined;
  let items = new Map<string, PartItem>();
  return {
    document: `p/${profileId}/settings`,
    prefixes: [ORDER, HIDDEN],
    load: () => layout.load(),
    snapshot() {
      const current = layout.get();
      if (current !== seen) {
        seen = current;
        items = new Map();
        if (current.order.length > 0) items.set(ORDER, { v: current.order.slice() });
        if (current.hidden.length > 0) items.set(HIDDEN, { v: current.hidden.slice() });
      }
      return new Map(items);
    },
    subscribe: (listener) => layout.subscribe(listener),
    adopt(change) {
      return layout.updateNow((current) => {
        const order = change.set.get(ORDER);
        const hidden = change.set.get(HIDDEN);
        const next: HomeLayout = {
          order: order
            ? mergeRowOrder(rowIds(order.v), current.order)
            : change.remove.indexOf(ORDER) !== -1
              ? []
              : current.order,
          hidden: hidden
            ? rowIds(hidden.v)
            : change.remove.indexOf(HIDDEN) !== -1
              ? []
              : current.hidden,
        };
        return sameIds(next.order, current.order) && sameIds(next.hidden, current.hidden)
          ? current
          : next;
      });
    },
  };
}

const TRACK = 'track/';

/** Audio and subtitle languages per title as `track/<metaId>`: `{a?, s?}`, `s` null for off. */
export function trackMemoryPart(profileId: string, memory: TrackMemory): SyncPart {
  const made = new WeakMap<TrackChoice, PartItem>();
  return {
    document: `p/${profileId}/settings`,
    prefixes: [TRACK],
    load: () => memory.load(),
    snapshot() {
      const items = new Map<string, PartItem>();
      for (const choice of memory.choices()) {
        let part = made.get(choice);
        if (!part) {
          const value: Fields = {};
          if (choice.audio !== undefined) value.a = choice.audio;
          if (choice.subtitle !== undefined) value.s = choice.subtitle;
          part = { v: value };
          made.set(choice, part);
        }
        items.set(TRACK + choice.metaId, part);
      }
      return items;
    },
    subscribe: (listener) => memory.subscribe(listener),
    adopt(change) {
      const set: TrackChoice[] = [];
      for (const [key, item] of oldestFirst(change.set)) {
        if (!isObject(item.v)) continue;
        const choice: TrackChoice = { metaId: key.slice(TRACK.length) };
        if (typeof item.v.a === 'string') choice.audio = item.v.a;
        if (typeof item.v.s === 'string' || item.v.s === null) choice.subtitle = item.v.s;
        set.push(choice);
      }
      return memory.adopt({ set, remove: change.remove.map((key) => key.slice(TRACK.length)) });
    },
  };
}

const OFFSET = 'offset/';

/** Subtitle timings as `offset/<fileKey>`: seconds. A timing put back to 0 leaves, which is a removal. */
export function subtitleOffsetsPart(profileId: string, offsets: SubtitleOffsets): SyncPart {
  return {
    document: `p/${profileId}/settings`,
    prefixes: [OFFSET],
    load: () => offsets.load(),
    snapshot() {
      const items = new Map<string, PartItem>();
      for (const saved of offsets.offsets()) items.set(OFFSET + saved.key, { v: saved.offset });
      return items;
    },
    subscribe: (listener) => offsets.subscribe(listener),
    adopt(change) {
      const set = oldestFirst(change.set)
        .filter(([, item]) => typeof item.v === 'number')
        .map(([key, item]) => ({ key: key.slice(OFFSET.length), offset: item.v as number }));
      return offsets.adopt({ set, remove: change.remove.map((key) => key.slice(OFFSET.length)) });
    },
  };
}

const DRIFT = 'drift/';
/** The drift choices the account carries, as agreed with the sync format (ADR 0006). */
const DRIFT_WORDS: readonly string[] = ['ahead', 'behind', 'none', 'auto', 'aligned'];

/**
 * Subtitle drift fixes as `drift/<fileKey>`, beside the timings they were
 * tuned with: 'ahead', 'behind', 'none' (the player's own fix taken off),
 * 'auto' (the player's own fix, worked out again for each stream, kept with
 * the viewer's timing) or 'aligned' (the same, for timing set on lines the
 * player lined up itself, which adds to its move). No choice is a removal.
 * The key is the same hash as the timing's, never a link.
 */
export function subtitleDriftsPart(profileId: string, drifts: SubtitleDrifts): SyncPart {
  return {
    document: `p/${profileId}/settings`,
    prefixes: [DRIFT],
    load: () => drifts.load(),
    snapshot() {
      const items = new Map<string, PartItem>();
      for (const saved of drifts.drifts()) items.set(DRIFT + saved.key, { v: saved.drift });
      return items;
    },
    subscribe: (listener) => drifts.subscribe(listener),
    adopt(change) {
      const set = oldestFirst(change.set)
        .filter(([, item]) => typeof item.v === 'string' && DRIFT_WORDS.indexOf(item.v) !== -1)
        .map(([key, item]) => ({ key: key.slice(DRIFT.length), drift: item.v as DriftChoice }));
      return drifts.adopt({ set, remove: change.remove.map((key) => key.slice(DRIFT.length)) });
    },
  };
}

const ADDON = 'a/';

/**
 * The addon collection as `a/<installId>` (`{u, o, m}`) and `order` in
 * `addons`. Only the address and `official` are compared: the manifest
 * rides along, so the daily manifest refresh is not an edit.
 */
export function collectionPart(
  collection: AddonCollection,
  options: { defaults?: readonly StoredAddon[] } = {},
): SyncPart {
  const defaults = options.defaults ?? DEFAULT_ADDONS;
  const made = new WeakMap<object, PartItem>();
  return {
    document: 'addons',
    prefixes: [ADDON, 'order'],
    load() {
      // The app loads the collection at launch; loading it again would read and save it twice.
      return new Promise<void>((resolve) => {
        if (collection.get().ready) return resolve();
        const off = collection.subscribe(() => {
          if (!collection.get().ready) return;
          off();
          resolve();
        });
      });
    },
    snapshot() {
      const items = new Map<string, PartItem>();
      const addons = collection.get().addons;
      const stored = collection.toStored();
      const order: string[] = [];
      stored.forEach((item, index) => {
        const addon = addons[index]!;
        let part = made.get(addon);
        if (!part || (part.v as Fields).m !== item.manifest) {
          part = { v: { u: item.transportUrl, o: item.official, m: item.manifest } };
          made.set(addon, part);
        }
        items.set(ADDON + item.installId, part);
        order.push(item.installId!);
      });
      items.set('order', { v: order });
      return items;
    },
    compare: (key, value) =>
      key === 'order' || !isObject(value) ? value : { u: value.u, o: value.o === true },
    subscribe: (listener) => collection.subscribe(listener),
    adopt(change) {
      const set: StoredAddon[] = [];
      for (const [key, item] of oldestFirst(change.set)) {
        if (key === 'order' || !isObject(item.v) || typeof item.v.u !== 'string') continue;
        set.push({
          transportUrl: item.v.u,
          manifest: item.v.m,
          official: item.v.o === true,
          fetchedAt: 0,
          installId: key.slice(ADDON.length),
        });
      }
      const order = change.set.get('order');
      return collection.adopt({
        set,
        remove: change.remove
          .filter((key) => key.indexOf(ADDON) === 0)
          .map((key) => key.slice(ADDON.length)),
        order: order ? rowIds(order.v) : undefined,
      });
    },
    ownData() {
      const urls = defaults.map((addon) => addon.transportUrl);
      return collection.get().addons.some((addon) => urls.indexOf(addon.transportUrl) === -1);
    },
    removedDefaults() {
      const here = collection.get().addons.map((addon) => addon.transportUrl);
      return defaults
        .filter((addon) => here.indexOf(addon.transportUrl) === -1)
        .map((addon) => ADDON + (addon.installId ?? addressTag(addon.transportUrl)));
    },
  };
}

/** The core stores of one profile, read and written through `storage`, which is already that profile's. */
export interface ProfileStores {
  library: Library;
  progress: ProgressStore;
  played: PlayedVideos;
  homeLayout: HomeLayoutStore;
  trackMemory: TrackMemory;
  subtitleOffsets: SubtitleOffsets;
  subtitleDrifts: SubtitleDrifts;
}

/**
 * Stores for a profile not in use, so the engine can read (and, when an
 * account is created or joined, change) what it has saved. Give it
 * `profileKeyValueStore(kv, Promise.resolve(profileKeyPrefix(id)))`, as
 * deleting a profile does, and the account clock as `now`.
 */
export function createProfileStores(
  storage: KeyValueStore,
  now: () => number = Date.now,
): ProfileStores {
  return {
    library: createLibrary({ storage, now }),
    progress: createProgressStore({ storage, now }),
    played: createPlayedVideos({ storage, now }),
    homeLayout: createHomeLayout({ storage }),
    trackMemory: createTrackMemory({ storage }),
    subtitleOffsets: createSubtitleOffsets({ storage }),
    subtitleDrifts: createSubtitleDrifts({ storage }),
  };
}

/** The core's parts of one profile's documents. The app adds its preferences part to them. */
export function profileParts(profileId: string, stores: ProfileStores): SyncPart[] {
  return [
    libraryPart(profileId, stores.library),
    watchPart(profileId, stores.progress, stores.played),
    homeLayoutPart(profileId, stores.homeLayout),
    trackMemoryPart(profileId, stores.trackMemory),
    subtitleOffsetsPart(profileId, stores.subtitleOffsets),
    subtitleDriftsPart(profileId, stores.subtitleDrifts),
  ];
}
