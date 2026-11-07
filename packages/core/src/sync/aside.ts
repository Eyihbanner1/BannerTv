import { MAIN_PROFILE_ID } from '../profiles/profiles';
import type { AsideItem, SyncAside } from './local';
import { documentKind } from './merge';

/**
 * Reading the copy a join with Use keeps of this screen (`sync-aside`, ADR
 * 0006, decision 12), so Settings > BannerTV account can say what bringing
 * it back would bring, and the engine knows which profiles it holds.
 */

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A profile id that can name documents, as the engine allows. */
const usableProfileId = (id: string) => documentKind(`p/${id}/list`) !== undefined;

/** One of the copy's profiles. */
export interface AsideProfile {
  id: string;
  /** Its name in the copy; left out for a Main that kept no name, which the app names. */
  name?: string;
}

/** What the copy holds, as Settings says it. */
export interface AsideCopy {
  /** Its profiles, Main first, then in the order this screen listed them. */
  profiles: AsideProfile[];
  /** Titles on My List, every profile's together, Trakt's left out: Use never took those away. */
  list: number;
  /** Videos part way through, as Continue Watching shows them, every profile's together. */
  watching: number;
  /** The addons' names, from their manifests. Never their addresses, which can carry keys. */
  addons: string[];
  /** When it runs out, by this screen's clock. */
  until: number;
}

function entries(aside: SyncAside, document: string): Array<[string, AsideItem]> {
  return Object.prototype.hasOwnProperty.call(aside.documents, document)
    ? aside.documents[document]!
    : [];
}

/** The ids of the profiles the copy holds, Main first, then in the order this screen listed them. */
export function asideProfileIds(aside: SyncAside): string[] {
  const ids = [MAIN_PROFILE_ID];
  for (const [key, item] of entries(aside, 'profiles')) {
    if (key.indexOf('/') !== -1 || !usableProfileId(key) || item.v !== 1) continue;
    if (ids.indexOf(key) === -1) ids.push(key);
  }
  return ids;
}

/** What the copy holds: its profiles by name, how many titles and videos, and its addons. */
export function describeAside(aside: SyncAside): AsideCopy {
  const names = new Map<string, string>();
  for (const [key, item] of entries(aside, 'profiles')) {
    const slash = key.indexOf('/');
    if (slash !== -1 && key.slice(slash + 1) === 'name' && typeof item.v === 'string') {
      names.set(key.slice(0, slash), item.v);
    }
  }
  const profiles: AsideProfile[] = [];
  for (const id of asideProfileIds(aside)) {
    const name = names.get(id);
    // A profile that came without a name never shows, as on the profiles list.
    if (name !== undefined && name !== '') profiles.push({ id, name });
    else if (id === MAIN_PROFILE_ID) profiles.push({ id });
  }
  let list = 0;
  let watching = 0;
  for (const document of Object.keys(aside.documents)) {
    const kind = documentKind(document);
    if (kind !== 'list' && kind !== 'watch') continue;
    for (const [, item] of entries(aside, document)) {
      if (item.trakt) continue;
      if (kind === 'list') list += 1;
      else if (isObject(item.v) && item.v.watched !== true && item.v.continueRow !== false) {
        watching += 1;
      }
    }
  }
  const addons: string[] = [];
  for (const [key, item] of entries(aside, 'addons')) {
    if (key.indexOf('a/') !== 0 || !isObject(item.v) || !isObject(item.v.m)) continue;
    const name = item.v.m.name;
    if (typeof name === 'string' && name.trim() !== '') addons.push(name.trim());
  }
  return { profiles, list, watching, addons, until: aside.until };
}
