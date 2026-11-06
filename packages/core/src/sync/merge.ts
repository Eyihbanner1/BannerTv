import { canon, type Item, type Items, isRemoval, itemAt, type LiveItem, newItems } from './items';

/**
 * The account's documents (ADR 0006, decision 1): `profiles` and `addons`
 * for the whole account, and three for each profile.
 */
export type DocumentKind = 'profiles' | 'addons' | 'settings' | 'list' | 'watch';

export const ACCOUNT_DOCUMENTS: readonly string[] = ['profiles', 'addons'];

/** A profile's documents: its settings, My List and Continue Watching. */
export function profileDocuments(profileId: string): string[] {
  return [`p/${profileId}/settings`, `p/${profileId}/list`, `p/${profileId}/watch`];
}

const PROFILE_DOCUMENT = /^p\/([a-z0-9]{1,16})\/(settings|list|watch)$/;

export function documentKind(document: string): DocumentKind | undefined {
  if (document === 'profiles' || document === 'addons') return document;
  const match = PROFILE_DOCUMENT.exec(document);
  return match ? (match[2] as DocumentKind) : undefined;
}

/** The profile a document belongs to, or undefined for the account's own. */
export function documentProfile(document: string): string | undefined {
  return PROFILE_DOCUMENT.exec(document)?.[1];
}

/** Times more than this after the server stored a document are lowered to that moment. */
export const CLAMP_MS = 60 * 1000;
/** Removals older than this are forgotten, except in `profiles`. */
export const REMOVAL_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The most each document keeps, newest first (the stores' own limits). */
export const DOCUMENT_CAPS = {
  list: 1000,
  watch: 500,
  /** Continue Watching cards ride on this many of the newest watch items, as the played store keeps. */
  watchCards: 200,
  track: 300,
  offset: 300,
  /** Home row ids in `home/order` and `home/hidden`. */
  rows: 300,
  /** Followed teams and competitions, `follow/team/*` and `follow/comp/*` together. */
  follows: 100,
} as const;

/** A profile's existence item (`<id>`), as against one of its fields (`<id>/name`). */
function isExistence(key: string): boolean {
  return key.indexOf('/') === -1;
}

/**
 * Items no screen should hold: Continue Watching sends no removals (a
 * removal would undo the watched OR, and only a live stream or the store's
 * own limit takes progress away), and Main is never removed.
 */
function usable(kind: DocumentKind | undefined, key: string, item: Item | undefined): boolean {
  if (!item) return false;
  if (!isRemoval(item)) return true;
  if (kind === 'watch') return false;
  return !(kind === 'profiles' && key === 'main');
}

function watchedOf(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { watched?: unknown }).watched === true
  );
}

/**
 * When the video was last marked not watched, or 0. Watched ticks count
 * only under the newest of these, so an unwatch crosses screens while a
 * tick made after it still wins.
 */
function unmarkedAtOf(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  const at = (value as { unmarkedAt?: unknown }).unmarkedAt;
  return typeof at === 'number' && isFinite(at) && at > 0 ? at : 0;
}

/** The fields of a `watch` value joined rather than chosen. */
const JOINED: readonly string[] = ['watched', 'unmarkedAt'];

/**
 * What breaks a tie of times between two live values. In `watch`, the
 * watched mark and the time of the last unwatch are left out, since they are
 * joined rather than chosen.
 */
function tieText(kind: DocumentKind | undefined, value: unknown): string {
  if (kind === 'watch' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const rest: { [key: string]: unknown } = {};
    for (const key of Object.keys(value)) {
      if (JOINED.indexOf(key) === -1) rest[key] = (value as { [key: string]: unknown })[key];
    }
    return canon(rest);
  }
  return canon(value);
}

/** Positive when `a` wins over `b`, negative when `b` wins, 0 when neither does. */
function compare(kind: DocumentKind | undefined, key: string, a: Item, b: Item): number {
  const aGone = isRemoval(a);
  const bGone = isRemoval(b);
  // A profile's removal is final: a profile deleted anywhere stays deleted.
  if (kind === 'profiles' && isExistence(key) && aGone !== bGone) return aGone ? 1 : -1;
  if (a.t !== b.t) return a.t - b.t;
  if (aGone !== bGone) return aGone ? 1 : -1;
  if (aGone) return 0;
  const aText = tieText(kind, (a as LiveItem).v);
  const bText = tieText(kind, (b as LiveItem).v);
  return aText > bText ? 1 : aText < bText ? -1 : 0;
}

/**
 * The merge of two items under one key (ADR 0006, decision 2): the newer
 * time wins; on equal times a removal wins, then the larger canonical JSON.
 * In `watch`, the result keeps the newer `unmarkedAt` of the two, and is
 * watched if either was under that same `unmarkedAt` (none counting as 0):
 * the pair (unmarkedAt, watched) is the larger of the two, so the join stays
 * commutative and associative.
 */
export function mergeItem(
  document: string,
  key: string,
  a: Item | undefined,
  b: Item | undefined,
): Item | undefined {
  const kind = documentKind(document);
  const left = usable(kind, key, a) ? a : undefined;
  const right = usable(kind, key, b) ? b : undefined;
  if (!left) return right;
  if (!right) return left;
  const winner = compare(kind, key, left, right) >= 0 ? left : right;
  const loser = winner === left ? right : left;
  if (kind === 'watch' && !isRemoval(winner) && !isRemoval(loser)) {
    const winnerAt = unmarkedAtOf(winner.v);
    const loserAt = unmarkedAtOf(loser.v);
    const at = Math.max(winnerAt, loserAt);
    const watched =
      (winnerAt === at && watchedOf(winner.v)) || (loserAt === at && watchedOf(loser.v));
    if (winnerAt === at && watched === watchedOf(winner.v)) return winner;
    const value: { [key: string]: unknown } = { ...(winner.v as object), watched };
    if (at > 0) value.unmarkedAt = at;
    else delete value.unmarkedAt;
    return { t: winner.t, v: value };
  }
  return winner;
}

/** Two documents' items merged key by key. Commutative, associative and idempotent. */
export function mergeItems(document: string, a: Items, b: Items): Items {
  const merged = newItems();
  for (const key of Object.keys(a)) {
    const item = mergeItem(document, key, a[key], itemAt(b, key));
    if (item) merged[key] = item;
  }
  for (const key of Object.keys(b)) {
    if (itemAt(a, key)) continue;
    const item = mergeItem(document, key, undefined, b[key]);
    if (item) merged[key] = item;
  }
  return merged;
}

/** Whether merging `item` into `current` would change it: false once `current` carries it or beats it. */
export function changesItem(
  document: string,
  key: string,
  current: Item | undefined,
  item: Item,
): boolean {
  const merged = mergeItem(document, key, current, item);
  if (merged === current) return false;
  if (!merged || !current) return merged !== current;
  return canon(merged) !== canon(current);
}

/**
 * Lowers any time more than a minute after `at`, when the server stored the
 * document, to `at` (ADR 0006, decision 5): one screen with a clock in the
 * future cannot pin its titles to the top everywhere.
 */
export function clampItems(items: Items, at: number): Items {
  const clamped = newItems();
  for (const key of Object.keys(items)) {
    const item = items[key]!;
    clamped[key] = item.t > at + CLAMP_MS ? { ...item, t: at } : item;
  }
  return clamped;
}

/** Newest first; equal times by key, so every screen cuts at the same place. */
function newestFirst(entries: Array<[string, Item]>): Array<[string, Item]> {
  return entries.sort((a, b) => b[1].t - a[1].t || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Keeps the newest `cap` values and the newest `cap` removals among `keys`. */
function cap(items: Items, keys: string[], limit: number, out: Items): void {
  const live: Array<[string, Item]> = [];
  const gone: Array<[string, Item]> = [];
  for (const key of keys) {
    const item = items[key]!;
    (isRemoval(item) ? gone : live).push([key, item]);
  }
  for (const [key, item] of newestFirst(live).slice(0, limit)) out[key] = item;
  for (const [key, item] of newestFirst(gone).slice(0, limit)) out[key] = item;
}

function cutList(item: Item): Item {
  if (isRemoval(item) || !Array.isArray(item.v) || item.v.length <= DOCUMENT_CAPS.rows) return item;
  return { t: item.t, v: item.v.slice(0, DOCUMENT_CAPS.rows) };
}

function addressOf(item: Item): string | undefined {
  if (isRemoval(item) || typeof item.v !== 'object' || item.v === null) return undefined;
  const address = (item.v as { u?: unknown }).u;
  return typeof address === 'string' ? address : undefined;
}

/**
 * A document tidied after a merge, the same way on every screen (ADR 0006,
 * decision 2): caps by newest first, removals older than 400 days dropped
 * (never in `profiles`), a second addon with the same address removed. Items
 * the caps drop are not removed anywhere: the account just stops knowing them.
 */
export function tidyItems(document: string, items: Items, now: number): Items {
  const kind = documentKind(document);
  let working = newItems();
  for (const key of Object.keys(items)) {
    if (usable(kind, key, items[key])) working[key] = items[key]!;
  }
  if (kind === 'addons') working = oneInstallPerAddress(working);
  const oldest = now - REMOVAL_DAYS * DAY_MS;
  const keys: string[] = [];
  for (const key of Object.keys(working)) {
    const item = working[key]!;
    if (kind !== 'profiles' && isRemoval(item) && item.t < oldest) continue;
    keys.push(key);
  }
  const kept = newItems();
  if (kind === 'list') {
    cap(working, keys, DOCUMENT_CAPS.list, kept);
  } else if (kind === 'watch') {
    const live = keys.map((key): [string, Item] => [key, working[key]!]);
    newestFirst(live)
      .slice(0, DOCUMENT_CAPS.watch)
      .forEach(([key, item], index) => {
        const value = (item as LiveItem).v;
        // Cards past the newest few ride nowhere: the played store keeps no more.
        if (index >= DOCUMENT_CAPS.watchCards && typeof value === 'object' && value !== null) {
          if ((value as { card?: unknown }).card !== undefined) {
            const rest = { ...(value as { [key: string]: unknown }) };
            delete rest.card;
            kept[key] = { t: item.t, v: rest };
            return;
          }
        }
        kept[key] = item;
      });
  } else if (kind === 'settings') {
    const tracks: string[] = [];
    const offsets: string[] = [];
    const follows: string[] = [];
    for (const key of keys) {
      if (key.indexOf('track/') === 0) tracks.push(key);
      else if (key.indexOf('offset/') === 0) offsets.push(key);
      else if (key.indexOf('follow/') === 0) follows.push(key);
      else if (key === 'home/order' || key === 'home/hidden') kept[key] = cutList(working[key]!);
      else kept[key] = working[key]!;
    }
    cap(working, tracks, DOCUMENT_CAPS.track, kept);
    cap(working, offsets, DOCUMENT_CAPS.offset, kept);
    cap(working, follows, DOCUMENT_CAPS.follows, kept);
  } else if (kind === 'profiles') {
    for (const key of keys) {
      const slash = key.indexOf('/');
      // The fields of a deleted profile go with it.
      const owner = slash === -1 ? undefined : itemAt(working, key.substr(0, slash));
      if (owner && isRemoval(owner)) continue;
      kept[key] = working[key]!;
    }
  } else {
    for (const key of keys) kept[key] = working[key]!;
  }
  return kept;
}

/** Installed from the same address on two screens under two names: the newer install stays. */
function oneInstallPerAddress(items: Items): Items {
  const out = newItems();
  const byAddress: { [address: string]: Array<[string, Item]> } = Object.create(null);
  for (const key of Object.keys(items)) {
    const item = items[key]!;
    const address = key.indexOf('a/') === 0 ? addressOf(item) : undefined;
    if (address === undefined) out[key] = item;
    else (byAddress[address] = byAddress[address] ?? []).push([key, item]);
  }
  for (const address of Object.keys(byAddress)) {
    newestFirst(byAddress[address]!).forEach(([key, item], index) => {
      out[key] = index === 0 ? item : { t: item.t, x: 1 };
    });
  }
  return out;
}
