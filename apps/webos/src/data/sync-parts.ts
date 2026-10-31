import {
  cleanName,
  KIDS_RATINGS,
  type KidsRating,
  type LiveItem,
  MAIN_PROFILE_ID,
  MAX_PROFILES,
  type PartItem,
  type Profile,
  PROFILE_COLOURS,
  type ProfilesState,
  type Store,
  type StoredPin,
  type SyncPart,
} from '@bannertv/core';
import { DEFAULT_PREFERENCES, type Preferences, readPreferences } from './preferences';

/**
 * The app's parts of the BannerTV account's documents (ADR 0006): the
 * profiles, each profile's preferences and Sports' "Show in Sports". The
 * core has the parts for its own stores (`profileParts`, `collectionPart`).
 * Each part gets its stores passed in, so the tests can give it their own.
 */

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The profile ids that can name documents, as the core and readProfiles allow. */
const PROFILE_ID = /^[a-z0-9]{1,16}$/;
const PIN_HASH = /^[0-9a-f]{64}$/;

function readPin(value: unknown): StoredPin | undefined {
  if (!isObject(value) || typeof value.salt !== 'string' || value.salt === '') return undefined;
  return typeof value.hash === 'string' && PIN_HASH.test(value.hash)
    ? { salt: value.salt, hash: value.hash }
    : undefined;
}

/** A kids rating, null for none, or undefined when the value is neither. */
function readKids(value: unknown): KidsRating | null | undefined {
  if (value === null) return null;
  return KIDS_RATINGS.indexOf(value as KidsRating) !== -1 ? (value as KidsRating) : undefined;
}

export interface ProfilesPartOptions {
  profiles: Store<ProfilesState>;
  /** The profile in use, whose deletion and kids setting wait for the next launch. */
  activeId: () => string | null;
  /** Main's name until it is renamed. */
  mainName: string;
  /** The account deleted a profile: it goes at the next launch, its data with it. */
  holdDeletion: (id: string) => void;
  /** The account changed the kids setting of the profile in use. */
  holdKids: (id: string, kids: KidsRating | null) => void;
}

/**
 * The profiles as the `profiles` document: `<id>` for each profile (Main's
 * is `{v: 1, t: 0}`, and is never removed) and `<id>/name|colour|kids|pin`,
 * kids and pin null when there is none. Which profile was used last and
 * whether to ask at launch stay on the screen.
 *
 * The account's changes show at once, except two to the profile in use: its
 * deletion and its kids setting, which wait for the next launch, since what
 * a kids profile may see is fixed when it opens. A profile deleted here
 * leaves the list now and its data goes at the next launch, through the
 * same guarded deletion as Settings > Profiles.
 */
export function profilesPart(options: ProfilesPartOptions): SyncPart {
  const { profiles, activeId, mainName } = options;
  let seen: ProfilesState | undefined;
  let items = new Map<string, PartItem>();

  return {
    document: 'profiles',
    prefixes: [''],
    // Read from localStorage before the first paint.
    load: () => Promise.resolve(),
    snapshot() {
      const state = profiles.get();
      if (state !== seen) {
        seen = state;
        items = new Map();
        for (const profile of state.profiles) {
          const id = profile.id;
          items.set(id, id === MAIN_PROFILE_ID ? { v: 1, t: 0 } : { v: 1 });
          items.set(`${id}/name`, { v: profile.name });
          items.set(`${id}/colour`, { v: profile.colour });
          items.set(`${id}/kids`, { v: profile.kids ?? null });
          items.set(`${id}/pin`, {
            v: profile.pin ? { salt: profile.pin.salt, hash: profile.pin.hash } : null,
          });
        }
      }
      return new Map(items);
    },
    subscribe: (listener) => profiles.subscribe(listener),
    adopt(change) {
      const state = profiles.get();
      const active = activeId();
      let list: Profile[] = state.profiles.map((profile) => ({ ...profile }));
      const find = (id: string) => list.filter((profile) => profile.id === id)[0];

      // New profiles go after this screen's, the oldest first.
      const arrived: Array<[string, LiveItem]> = [];
      change.set.forEach((item, key) => {
        if (key.indexOf('/') === -1 && PROFILE_ID.test(key) && item.v === 1 && !find(key)) {
          arrived.push([key, item]);
        }
      });
      arrived.sort((a, b) => a[1].t - b[1].t);
      for (const [id] of arrived) list.push({ id, name: '', colour: 0 });

      change.set.forEach((item, key) => {
        const slash = key.indexOf('/');
        if (slash === -1) return;
        const profile = find(key.slice(0, slash));
        if (!profile) return;
        const value = item.v;
        switch (key.slice(slash + 1)) {
          case 'name':
            if (typeof value === 'string' && cleanName(value) !== '')
              profile.name = cleanName(value);
            break;
          case 'colour':
            if (typeof value === 'number' && value >= 0 && value < PROFILE_COLOURS) {
              profile.colour = Math.floor(value);
            }
            break;
          case 'kids': {
            const kids = readKids(value);
            if (kids === undefined || profile.id === MAIN_PROFILE_ID) break;
            if (profile.id === active) {
              if ((profile.kids ?? null) !== kids) options.holdKids(profile.id, kids);
              break;
            }
            if (kids === null) delete profile.kids;
            else profile.kids = kids;
            break;
          }
          case 'pin': {
            const pin = readPin(value);
            if (pin) profile.pin = pin;
            else if (value === null) delete profile.pin;
            break;
          }
        }
      });

      for (const key of change.remove) {
        const slash = key.indexOf('/');
        if (slash !== -1) {
          // A field gone with its profile, or a PIN or kids setting taken off.
          const profile = find(key.slice(0, slash));
          const field = key.slice(slash + 1);
          if (profile && field === 'pin') delete profile.pin;
          if (profile && field === 'kids' && profile.id !== MAIN_PROFILE_ID) {
            if (profile.id === active) {
              if (profile.kids !== undefined) options.holdKids(profile.id, null);
            } else delete profile.kids;
          }
          continue;
        }
        if (key === MAIN_PROFILE_ID || !find(key)) continue;
        options.holdDeletion(key);
        if (key !== active) list = list.filter((profile) => profile.id !== key);
      }

      // A profile that came without a name is left until it has one.
      list = list.filter((profile) => profile.name !== '');
      // At most six: Main, the one in use, then the rest in order.
      while (list.length > MAX_PROFILES) {
        let cut = list.length - 1;
        while (cut > 0 && (list[cut]!.id === MAIN_PROFILE_ID || list[cut]!.id === active)) cut--;
        list.splice(cut, 1);
      }
      const main = list.filter((profile) => profile.id === MAIN_PROFILE_ID)[0];
      if (main) {
        // Main set BannerTV up and is first, and never a kids profile.
        delete main.kids;
        list = [main].concat(list.filter((profile) => profile !== main));
      } else {
        list.unshift({ id: MAIN_PROFILE_ID, name: mainName, colour: 0 });
      }
      profiles.set({
        ...state,
        profiles: list,
        lastId: list.some((profile) => profile.id === state.lastId)
          ? state.lastId
          : MAIN_PROFILE_ID,
      });
      return Promise.resolve();
    },
    ownData() {
      const list = profiles.get().profiles;
      const main = list.filter((profile) => profile.id === MAIN_PROFILE_ID)[0];
      return list.length > 1 || (main !== undefined && (main.name !== mainName || !!main.pin));
    },
  };
}

type PreferenceKey =
  | 'pref/streamChoice'
  | 'pref/allStreamsOrder'
  | 'pref/audioLanguage'
  | 'pref/subtitleLanguage'
  | 'pref/tmdb'
  | 'style/size'
  | 'style/colour'
  | 'style/background'
  | 'style/position';

/**
 * Where each preference is kept. Link testing (`probing`) is not here: it
 * suits the screen it runs on, so it stays there (ADR 0006).
 */
const PREFERENCE_KEYS: ReadonlyArray<
  readonly [
    PreferenceKey,
    (prefs: Preferences) => unknown,
    (prefs: Preferences, value: unknown) => Preferences,
  ]
> = [
  ['pref/streamChoice', (p) => p.streamChoice, (p, v) => ({ ...p, streamChoice: v as never })],
  [
    'pref/allStreamsOrder',
    (p) => p.allStreamsOrder,
    (p, v) => ({ ...p, allStreamsOrder: v as never }),
  ],
  ['pref/audioLanguage', (p) => p.audioLanguage, (p, v) => ({ ...p, audioLanguage: v as never })],
  [
    'pref/subtitleLanguage',
    (p) => p.subtitleLanguage,
    (p, v) => ({ ...p, subtitleLanguage: v as never }),
  ],
  ['pref/tmdb', (p) => p.tmdb, (p, v) => ({ ...p, tmdb: v as never })],
  [
    'style/size',
    (p) => p.subtitleStyle.size,
    (p, v) => ({ ...p, subtitleStyle: { ...p.subtitleStyle, size: v as never } }),
  ],
  [
    'style/colour',
    (p) => p.subtitleStyle.colour,
    (p, v) => ({ ...p, subtitleStyle: { ...p.subtitleStyle, colour: v as never } }),
  ],
  [
    'style/background',
    (p) => p.subtitleStyle.background,
    (p, v) => ({ ...p, subtitleStyle: { ...p.subtitleStyle, background: v as never } }),
  ],
  [
    'style/position',
    (p) => p.subtitleStyle.position,
    (p, v) => ({ ...p, subtitleStyle: { ...p.subtitleStyle, position: v as never } }),
  ],
];

function samePreferences(a: Preferences, b: Preferences): boolean {
  return PREFERENCE_KEYS.every(([, read]) => read(a) === read(b)) && a.probing === b.probing;
}

/**
 * A profile's preferences as `pref/*` and `style/*` in `p/<id>/settings`.
 * A value left at its default is no item, so going back to the default is a
 * removal, and a screen that never changed one has nothing to say about it.
 */
export function preferencesPart(profileId: string, store: Store<Preferences>): SyncPart {
  let seen: Preferences | undefined;
  let items = new Map<string, PartItem>();
  return {
    document: `p/${profileId}/settings`,
    prefixes: ['pref/', 'style/'],
    // Read from localStorage when the profile was chosen.
    load: () => Promise.resolve(),
    snapshot() {
      const prefs = store.get();
      if (prefs !== seen) {
        seen = prefs;
        items = new Map();
        for (const [key, read] of PREFERENCE_KEYS) {
          const value = read(prefs);
          if (value !== read(DEFAULT_PREFERENCES)) items.set(key, { v: value });
        }
      }
      return new Map(items);
    },
    subscribe: (listener) => store.subscribe(listener),
    adopt(change) {
      const current = store.get();
      let next = current;
      for (const [key, read, write] of PREFERENCE_KEYS) {
        const item = change.set.get(key);
        if (item) next = write(next, item.v);
        else if (change.remove.indexOf(key) !== -1) next = write(next, read(DEFAULT_PREFERENCES));
      }
      // Read back as if saved, so a value this build does not know becomes the default.
      const checked = { ...readPreferences(JSON.stringify(next)), probing: current.probing };
      if (!samePreferences(checked, current)) store.set(checked);
      return Promise.resolve();
    },
  };
}

/** What the Sports part needs of data/sports.ts, so the tests can give it their own. */
export interface SportsChoices {
  load(): Promise<void>;
  get(): ReadonlyMap<string, 'yes' | 'no'>;
  subscribe(listener: () => void): () => void;
  adopt(set: ReadonlyArray<readonly [string, 'yes' | 'no']>, remove: readonly string[]): void;
}

const SPORTS = 's/';

/**
 * "Show in Sports" as `s/<manifestId>` in `addons`: yes or no, and
 * automatic is no item. A build without Sports has no such part, so it
 * leaves those keys in the account as they are.
 */
export function sportsPart(choices: SportsChoices): SyncPart {
  let seen: ReadonlyMap<string, 'yes' | 'no'> | undefined;
  let items = new Map<string, PartItem>();
  return {
    document: 'addons',
    prefixes: [SPORTS],
    load: () => choices.load(),
    snapshot() {
      const current = choices.get();
      if (current !== seen) {
        seen = current;
        items = new Map();
        current.forEach((setting, id) => items.set(SPORTS + id, { v: setting }));
      }
      return new Map(items);
    },
    subscribe: (listener) => choices.subscribe(listener),
    adopt(change) {
      const set: Array<[string, 'yes' | 'no']> = [];
      change.set.forEach((item, key) => {
        if (item.v === 'yes' || item.v === 'no') set.push([key.slice(SPORTS.length), item.v]);
      });
      const remove = change.remove.map((key) => key.slice(SPORTS.length));
      if (set.length > 0 || remove.length > 0) choices.adopt(set, remove);
      return Promise.resolve();
    },
  };
}
