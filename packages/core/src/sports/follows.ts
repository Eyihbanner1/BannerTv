import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';
import { DOCUMENT_CAPS } from '../sync/merge';
import type { PartItem, SyncPart } from '../sync/part';
import { isDictionaryCompetition, isSport } from './events';
import type { Sport, SportEvent } from './types';

/**
 * The teams and competitions a profile follows (SP2): their matches come
 * first on Sports, in a Following row, and first in Home's Live sport row.
 * Kept per profile and synced as `follow/team/<id>` and `follow/comp/<id>`
 * in `p/<id>/settings` (ADR 0006).
 */

const KEY = 'sports.follows';
const PREFIX = 'follow/';
/** The most a profile follows, teams and competitions together; the account keeps as many. */
export const MAX_FOLLOWS = DOCUMENT_CAPS.follows;
const MAX_ID = 200;
const MAX_NAME = 120;

export type FollowKind = 'team' | 'comp';

/** A team or competition as the match page offers to follow it. */
export interface FollowTarget {
  kind: FollowKind;
  /**
   * A side's follow key ("football:arsenal:women", SportEvent.followKeys) or
   * a competition's key: a dictionary id ("eng.1") or a `text:` key.
   */
  id: string;
  /** As the match page showed it when it was followed: "Arsenal Women", "Premier League". */
  name: string;
  sport: Sport;
}

export interface Follow extends FollowTarget {
  /** When it was followed, by the account's clock while the screen has one. */
  at: number;
}

/** What the view needs to tell a followed match, a new object whenever the follows change. */
export interface FollowSet {
  /** Followed sides, by follow key. */
  teams: ReadonlySet<string>;
  /** Followed competitions, by key. */
  competitions: ReadonlySet<string>;
}

export const NO_FOLLOWS: FollowSet = { teams: new Set(), competitions: new Set() };

/** The key a follow has in the account's settings document. */
export function followDocumentKey(follow: Pick<FollowTarget, 'kind' | 'id'>): string {
  return `${PREFIX}${follow.kind}/${follow.id}`;
}

/** The follow a document key names, or undefined when it names none. */
function readDocumentKey(key: string): Pick<FollowTarget, 'kind' | 'id'> | undefined {
  if (key.indexOf(PREFIX) !== 0) return undefined;
  const rest = key.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  const kind = rest.slice(0, slash);
  const id = rest.slice(slash + 1);
  if (slash === -1 || (kind !== 'team' && kind !== 'comp') || !usableId(id)) return undefined;
  return { kind, id };
}

const usableId = (id: unknown): id is string =>
  typeof id === 'string' && id !== '' && id.length <= MAX_ID;

function cleanName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return clean === '' ? undefined : clean;
}

/**
 * The newest first; equal times by document key, as the account's own cap
 * sorts them (tidyItems), so every screen keeps the same ones.
 */
function newestFirst(follows: Follow[]): Follow[] {
  return follows
    .map((follow) => ({ follow, key: followDocumentKey(follow) }))
    .sort((a, b) => b.follow.at - a.follow.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.follow);
}

function sameTarget(a: Pick<FollowTarget, 'kind' | 'id'>, b: Pick<FollowTarget, 'kind' | 'id'>) {
  return a.kind === b.kind && a.id === b.id;
}

/** At most MAX_FOLLOWS, one per team or competition, the newest kept. */
function capped(follows: Follow[]): Follow[] {
  const out: Follow[] = [];
  for (const follow of newestFirst(follows)) {
    if (out.some((kept) => sameTarget(kept, follow))) continue;
    out.push(follow);
    if (out.length === MAX_FOLLOWS) break;
  }
  return out;
}

function readFollow(value: unknown): Follow | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = cleanName(raw.name);
  if (raw.kind !== 'team' && raw.kind !== 'comp') return undefined;
  if (!usableId(raw.id) || name === undefined || !isSport(raw.sport)) return undefined;
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at) || raw.at < 0) return undefined;
  return { kind: raw.kind, id: raw.id, name, sport: raw.sport, at: raw.at };
}

function readFollows(saved: unknown): readonly Follow[] {
  if (!Array.isArray(saved)) return [];
  const follows: Follow[] = [];
  for (const value of saved) {
    const follow = readFollow(value);
    if (follow) follows.push(follow);
  }
  return capped(follows);
}

/** What the BannerTV account changes in the follows. */
export interface FollowsAdoption {
  /** Follows to keep as given, their times included. */
  set?: readonly Follow[];
  remove?: ReadonlyArray<Pick<FollowTarget, 'kind' | 'id'>>;
}

export interface Follows {
  load(): Promise<void>;
  /** Every follow, the newest first. */
  list(): readonly Follow[];
  /** The follows as the view reads them: the same object until they change. */
  set(): FollowSet;
  has(target: Pick<FollowTarget, 'kind' | 'id'>): boolean;
  /**
   * Follows a team or competition, as of now. Resolves false, changing
   * nothing, when MAX_FOLLOWS are followed already.
   */
  follow(target: FollowTarget): Promise<boolean>;
  unfollow(target: Pick<FollowTarget, 'kind' | 'id'>): Promise<void>;
  /**
   * Makes the follows match a change from the BannerTV account, trimmed to
   * the newest MAX_FOLLOWS as the account is, before it returns: only the
   * save is waited for (SyncPart.adopt).
   */
  adopt(change: FollowsAdoption): Promise<void>;
  /** Told of every change, and once when the saved follows have been read. */
  subscribe(listener: Listener): () => void;
}

/**
 * The follows of one profile, saved under `sports.follows` in `storage`,
 * which is already the profile's own (profileKv, ADR 0004). `now` is the
 * account's clock while the screen has an account, as for My List.
 */
export function createFollows(options: { storage: KeyValueStore; now?: () => number }): Follows {
  const now = options.now ?? Date.now;
  const state = createPersisted<readonly Follow[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readFollows,
    write: (follows) => follows.slice(),
  });
  let seen: readonly Follow[] | undefined;
  let lookup = NO_FOLLOWS;

  function set(): FollowSet {
    const follows = state.get();
    if (follows !== seen) {
      seen = follows;
      const teams = new Set<string>();
      const competitions = new Set<string>();
      for (const follow of follows) (follow.kind === 'team' ? teams : competitions).add(follow.id);
      lookup = { teams, competitions };
    }
    return lookup;
  }

  return {
    load: state.load,
    list: () => state.get(),
    set,
    has: (target) => state.get().some((follow) => sameTarget(follow, target)),
    async follow(target) {
      const name = cleanName(target.name);
      if (!usableId(target.id) || name === undefined || !isSport(target.sport)) return false;
      let followed = false;
      await state.update((current) => {
        if (current.some((follow) => sameTarget(follow, target))) {
          followed = true;
          return current;
        }
        if (current.length >= MAX_FOLLOWS) return current;
        followed = true;
        const follow: Follow = {
          kind: target.kind,
          id: target.id,
          name,
          sport: target.sport,
          at: now(),
        };
        return [follow].concat(current);
      });
      return followed;
    },
    unfollow: (target) =>
      state.update((current) =>
        current.some((follow) => sameTarget(follow, target))
          ? current.filter((follow) => !sameTarget(follow, target))
          : current,
      ),
    adopt: (change) =>
      state.updateNow((current) => {
        const set = (change.set ?? []).map(readFollow).filter((f): f is Follow => !!f);
        const remove = change.remove ?? [];
        const gone = (follow: Follow) =>
          remove.some((target) => sameTarget(target, follow)) ||
          set.some((target) => sameTarget(target, follow));
        if (set.length === 0 && !current.some(gone)) return current;
        const next = capped(current.filter((follow) => !gone(follow)).concat(set));
        const same =
          next.length === current.length &&
          next.every((follow, index) => {
            const was = current[index]!;
            return sameTarget(was, follow) && was.at === follow.at && was.name === follow.name;
          });
        return same ? current : next;
      }),
    subscribe: state.subscribe,
  };
}

/**
 * The competition a match page offers to follow: its row's competition
 * when that is one competition with a key the same on every screen (a
 * dictionary id, or a `text:` key of a name an addon gave), or the one the
 * tile's note names when the row is the sport's. Never a country, group or
 * Other row.
 */
export function followableCompetition(event: SportEvent): FollowTarget | undefined {
  const competition = event.competition;
  const stable =
    isDictionaryCompetition(competition) ||
    (competition.key.indexOf('text:') === 0 &&
      competition.source !== 'country' &&
      competition.source !== 'other');
  if (stable) {
    return { kind: 'comp', id: competition.key, name: competition.name, sport: competition.sport };
  }
  if (event.note !== undefined && event.noteKey !== undefined) {
    return { kind: 'comp', id: event.noteKey, name: event.note, sport: event.sport };
  }
  return undefined;
}

/** The two sides a match page offers to follow, home first, or none outside team sports. */
export function followableTeams(event: SportEvent): [FollowTarget, FollowTarget] | undefined {
  const keys = event.followKeys;
  if (!keys || event.home === undefined || event.away === undefined) return undefined;
  return [
    { kind: 'team', id: keys[0], name: event.home, sport: event.sport },
    { kind: 'team', id: keys[1], name: event.away, sport: event.sport },
  ];
}

/** Everything a match page offers to follow: the home side, the away side, then the competition. */
export function followTargets(event: SportEvent): FollowTarget[] {
  const targets: FollowTarget[] = followableTeams(event) ?? [];
  const competition = followableCompetition(event);
  if (competition) targets.push(competition);
  return targets;
}

/** Whether `follows` holds a team or competition. */
export function followsHas(follows: FollowSet, target: Pick<FollowTarget, 'kind' | 'id'>): boolean {
  return (target.kind === 'team' ? follows.teams : follows.competitions).has(target.id);
}

/** Whether the profile follows either side of a match or its competition. */
export function isFollowed(event: SportEvent, follows: FollowSet): boolean {
  if (follows.teams.size > 0 && event.followKeys) {
    if (follows.teams.has(event.followKeys[0]) || follows.teams.has(event.followKeys[1])) {
      return true;
    }
  }
  if (follows.competitions.size === 0) return false;
  if (follows.competitions.has(event.competition.key)) {
    return followableCompetition(event)?.id === event.competition.key;
  }
  return event.noteKey !== undefined && follows.competitions.has(event.noteKey);
}

function readValue(key: string, value: unknown, at: number): Follow | undefined {
  const target = readDocumentKey(key);
  if (!target || typeof value !== 'object' || value === null) return undefined;
  const raw = value as { n?: unknown; s?: unknown };
  return readFollow({ ...target, name: raw.n, sport: raw.s, at });
}

/**
 * The follows as `follow/team/<id>` and `follow/comp/<id>` in
 * `p/<id>/settings`: `{n, s}`, the name and sport, at the time each was
 * followed. Unfollowing is a removal. A build without Sports has no such
 * part, so it leaves those keys in the account as they are.
 */
export function followsPart(profileId: string, follows: Follows): SyncPart {
  const made = new WeakMap<Follow, PartItem>();
  const itemOf = (follow: Follow): PartItem => {
    let item = made.get(follow);
    if (!item) {
      item = { v: { n: follow.name, s: follow.sport }, t: follow.at };
      made.set(follow, item);
    }
    return item;
  };
  return {
    document: `p/${profileId}/settings`,
    prefixes: [PREFIX],
    load: () => follows.load(),
    snapshot() {
      const items = new Map<string, PartItem>();
      for (const follow of follows.list()) items.set(followDocumentKey(follow), itemOf(follow));
      return items;
    },
    subscribe: (listener) => follows.subscribe(listener),
    adopt(change) {
      const set: Follow[] = [];
      change.set.forEach((item, key) => {
        const follow = readValue(key, item.v, item.t);
        if (follow) set.push(follow);
      });
      const remove: Array<Pick<FollowTarget, 'kind' | 'id'>> = [];
      for (const key of change.remove) {
        const target = readDocumentKey(key);
        if (target) remove.push(target);
      }
      return follows.adopt({ set, remove });
    },
    ownData: () => follows.list().length > 0,
  };
}
