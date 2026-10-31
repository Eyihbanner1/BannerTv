import {
  cleanName,
  createPinGuard,
  createStore,
  KIDS_RATINGS,
  type KidsRating,
  MAIN_PROFILE_ID,
  makePin,
  MAX_PROFILES,
  newProfileId,
  type Profile,
  profileKeyPrefix,
  type ProfilesState,
  readProfiles,
} from '@bannertv/core';
import { secureRandom } from '../platform/web-crypto';

// Read before the first paint to decide between the picker and Home, so localStorage.
const KEY = 'bannertv.profiles';
// The profile chosen in this run of the app. A switch reloads the app, and
// sessionStorage outlives the reload but not the app closing.
const SESSION_KEY = 'bannertv.profile';
// A switch also names the profile in the address it reloads: Chromium hands
// storage writes over in batches, so a write made just before a reload can
// be missing after it, and the address always arrives.
const HASH_PREFIX = '#profile=';
// A relaunch that asks who is watching again says so in the address too, as
// its removal of the session's choice can be missing after the reload.
const ASK_HASH = '#ask';

/** What a reload asked for in the address (a switch or a question), taken out of it. */
function takeReloadHash(): string {
  try {
    const { hash, pathname, search } = window.location;
    if (hash !== ASK_HASH && hash.indexOf(HASH_PREFIX) !== 0) return '';
    history.replaceState(null, '', pathname + search);
    return hash;
  } catch {
    return '';
  }
}

/** The profile a switch named in the address it reloaded. */
function switchedProfile(hash: string): string | null {
  if (hash.indexOf(HASH_PREFIX) !== 0) return null;
  try {
    return decodeURIComponent(hash.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
}

/** The profile chosen earlier in this run, or none. */
function sessionChoice(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function forgetSessionChoice(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Without sessionStorage nothing outlives the reload anyway.
  }
}

/** Main's name until it is renamed. Saved data rather than UI text, so it is not translated. */
export const MAIN_NAME = 'Main';

function readSaved(): ProfilesState {
  try {
    const raw = localStorage.getItem(KEY);
    return readProfiles(raw ? (JSON.parse(raw) as unknown) : undefined, MAIN_NAME);
  } catch {
    return readProfiles(undefined, MAIN_NAME);
  }
}

function save(state: ProfilesState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Without storage the profiles last until the app closes.
  }
}

// Changes the BannerTV account made that wait for this launch (ADR 0006, decision 6): the
// profile in use deleted on another screen, or its kids setting changed there.
const HELD_KEY = 'bannertv.syncHeld';

interface HeldChanges {
  /** Profiles the account deleted: gone from the list at launch, their data deleted once started. */
  deleted: string[];
  /** Kids settings of the profile that was in use, by id: a rating, or null for none. */
  kids: Array<[string, KidsRating | null]>;
}

function readHeld(): HeldChanges {
  const held: HeldChanges = { deleted: [], kids: [] };
  try {
    const raw = localStorage.getItem(HELD_KEY);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value !== 'object' || value === null) return held;
    const { deleted, kids } = value as Record<string, unknown>;
    if (Array.isArray(deleted)) {
      held.deleted = deleted.filter((id): id is string => typeof id === 'string');
    }
    if (Array.isArray(kids)) {
      for (const pair of kids) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue;
        const rating = pair[1] as unknown;
        if (rating === null || KIDS_RATINGS.indexOf(rating as KidsRating) !== -1) {
          held.kids.push([pair[0], rating as KidsRating | null]);
        }
      }
    }
  } catch {
    // Nothing held, then: the account sends the change again at its next pull.
  }
  return held;
}

function saveHeld(held: HeldChanges): void {
  try {
    if (held.deleted.length === 0 && held.kids.length === 0) localStorage.removeItem(HELD_KEY);
    else localStorage.setItem(HELD_KEY, JSON.stringify(held));
  } catch {
    // The account sends the change again at its next pull.
  }
}

/** The saved profiles with what the account held back applied, before anyone is chosen. */
function withHeld(state: ProfilesState, held: HeldChanges): ProfilesState {
  if (held.deleted.length === 0 && held.kids.length === 0) return state;
  const list = state.profiles
    .filter((p) => p.id === MAIN_PROFILE_ID || held.deleted.indexOf(p.id) === -1)
    .map((profile) => {
      const kids = held.kids.filter(([id]) => id === profile.id)[0];
      if (!kids || profile.id === MAIN_PROFILE_ID) return profile;
      const next: Profile = { ...profile };
      if (kids[1] === null) delete next.kids;
      else next.kids = kids[1];
      return next;
    });
  return {
    ...state,
    profiles: list,
    lastId: list.some((p) => p.id === state.lastId) ? state.lastId : MAIN_PROFILE_ID,
  };
}

const heldAtLaunch = readHeld();

export const profiles = createStore<ProfilesState>(withHeld(readSaved(), heldAtLaunch));
profiles.subscribe(() => save(profiles.get()));
if (heldAtLaunch.deleted.length > 0 || heldAtLaunch.kids.length > 0) {
  save(profiles.get());
  // Kids changes are in the list now. Deletions wait for their data to go (deleteHeldProfiles).
  saveHeld({ deleted: heldAtLaunch.deleted, kids: [] });
}

/**
 * The account deleted a profile: it leaves the list at the next launch if it
 * is in use now, and its data is deleted once that launch has started.
 */
export function holdProfileDeletion(id: string): void {
  if (id === MAIN_PROFILE_ID) return;
  const held = readHeld();
  if (held.deleted.indexOf(id) !== -1) return;
  held.deleted.push(id);
  saveHeld(held);
}

/** The account changed the kids setting of the profile in use: it takes effect at the next launch. */
export function holdKidsChange(id: string, kids: KidsRating | null): void {
  if (id === MAIN_PROFILE_ID) return;
  const held = readHeld();
  held.kids = held.kids.filter(([other]) => other !== id).concat([[id, kids]]);
  saveHeld(held);
}

/** Profiles the account deleted whose data is still on this screen. */
export function heldDeletions(): string[] {
  return readHeld().deleted;
}

/** A held deletion is done: the profile's data has gone. */
export function forgetHeldDeletion(id: string): void {
  const held = readHeld();
  const deleted = held.deleted.filter((other) => other !== id);
  if (deleted.length === held.deleted.length) return;
  saveHeld({ deleted, kids: held.kids });
}

/**
 * Who is watching, or null while the picker waits for an answer. With one
 * profile it is always Main; otherwise the profile chosen earlier in this run
 * (before a switch reloaded the app) unless a relaunch asked again, or,
 * with the picker turned off, the last profile used unless a PIN guards it.
 */
function initialChoice(state: ProfilesState): string | null {
  const hash = takeReloadHash();
  if (hash === ASK_HASH) forgetSessionChoice();
  if (state.profiles.length === 1) return MAIN_PROFILE_ID;
  let session = switchedProfile(hash);
  if (session === null && hash !== ASK_HASH) session = sessionChoice();
  if (session && state.profiles.some((p) => p.id === session)) return session;
  if (state.askAtLaunch) return null;
  const last = state.profiles.find((p) => p.id === state.lastId);
  return last && !last.pin ? last.id : null;
}

/** The id of the profile in use, or null until someone is chosen. */
export const activeProfileId = createStore<string | null>(initialChoice(profiles.get()));

let resolvePrefix: (prefix: string) => void = () => undefined;
/**
 * The key prefix of the profile in use. Per-profile stores wait on it, so
 * nothing is read or written for anyone until the picker has an answer.
 */
export const profilePrefix = new Promise<string>((resolve) => {
  resolvePrefix = resolve;
});
const initial = activeProfileId.get();
if (initial !== null) resolvePrefix(profileKeyPrefix(initial));

export function activeProfile(): Profile | undefined {
  const id = activeProfileId.get();
  return profiles.get().profiles.find((p) => p.id === id);
}

/** The profile in use is a kids profile. Fixed for the run: a switch reloads the app. */
export function isKidsProfile(): boolean {
  return activeProfile()?.kids !== undefined;
}

const TRIES_KEY = 'bannertv.pinTries';

function readTries(): unknown {
  try {
    const raw = localStorage.getItem(TRIES_KEY);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** Counts wrong PINs for every PIN pad in the app, across launches. */
export const pinGuard = createPinGuard({
  saved: readTries(),
  save: (tries) => {
    try {
      localStorage.setItem(TRIES_KEY, JSON.stringify(tries));
    } catch {
      // The count then lasts until the app closes.
    }
  },
});

function reloadApp(id: string): void {
  window.location.hash = `${HASH_PREFIX.slice(1)}${encodeURIComponent(id)}`;
  window.location.reload();
}

/**
 * Starts using a profile, whose PIN (if any) has been checked. The first
 * choice of a run opens it at once; after that the app reloads as that
 * profile, so nothing of the person before stays behind in memory.
 */
export function chooseProfile(id: string): void {
  const state = profiles.get();
  if (!state.profiles.some((p) => p.id === id)) return;
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // Without sessionStorage a switch asks again after the reload.
  }
  if (state.lastId !== id) profiles.set({ ...state, lastId: id });
  if (activeProfileId.get() === null) {
    activeProfileId.set(id);
    resolvePrefix(profileKeyPrefix(id));
    return;
  }
  if (activeProfileId.get() !== id) reloadApp(id);
}

export function canAddProfile(): boolean {
  return profiles.get().profiles.length < MAX_PROFILES;
}

export interface ProfileDraft {
  name: string;
  colour: number;
  kids?: KidsRating;
}

/** Adds a profile and returns its id, or undefined when the limit is reached or the name is empty. */
export function addProfile(draft: ProfileDraft): string | undefined {
  const state = profiles.get();
  const name = cleanName(draft.name);
  if (!canAddProfile() || name === '') return undefined;
  // Ids are the account's too (ADR 0006, decision 7), so they come from the secure source.
  const id = newProfileId(
    state.profiles.map((p) => p.id),
    secureRandom,
  );
  const profile: Profile = { id, name, colour: draft.colour };
  if (draft.kids) profile.kids = draft.kids;
  profiles.set({ ...state, profiles: state.profiles.concat(profile) });
  return id;
}

export function updateProfile(
  id: string,
  change: { name?: string; colour?: number; kids?: KidsRating | null },
): void {
  profiles.set((state) => ({
    ...state,
    profiles: state.profiles.map((profile) => {
      if (profile.id !== id) return profile;
      const next: Profile = { ...profile };
      if (change.name !== undefined) {
        const name = cleanName(change.name);
        if (name !== '') next.name = name;
      }
      if (change.colour !== undefined) next.colour = change.colour;
      // Main set BannerTV up and is never a kids profile.
      if (change.kids === null || id === MAIN_PROFILE_ID) delete next.kids;
      else if (change.kids !== undefined) next.kids = change.kids;
      return next;
    }),
  }));
}

/** Sets a four-digit PIN, or removes it with null. */
export function setProfilePin(id: string, digits: string | null): void {
  profiles.set((state) => ({
    ...state,
    profiles: state.profiles.map((profile) => {
      if (profile.id !== id) return profile;
      const next: Profile = { ...profile };
      if (digits === null) delete next.pin;
      else next.pin = makePin(digits, secureRandom);
      return next;
    }),
  }));
}

export function setAskAtLaunch(ask: boolean): void {
  profiles.set((state) => (state.askAtLaunch === ask ? state : { ...state, askAtLaunch: ask }));
}

/** Removes a profile from the list. Its data is deleted by deleteProfileData. Main stays. */
export function removeProfile(id: string): void {
  if (id === MAIN_PROFILE_ID) return;
  profiles.set((state) => ({
    ...state,
    profiles: state.profiles.filter((p) => p.id !== id),
    lastId: state.lastId === id ? MAIN_PROFILE_ID : state.lastId,
  }));
}

/**
 * Someone opened BannerTV again from the TV's launcher while it was still
 * running in the background. When it would ask who is watching at launch, or
 * the profile in use has a PIN, it starts again with the question, so whoever
 * opens it next does not walk into a locked profile.
 */
export function askAgainOnRelaunch(): void {
  const state = profiles.get();
  if (state.profiles.length < 2) return;
  if (!state.askAtLaunch && !activeProfile()?.pin) return;
  forgetSessionChoice();
  window.location.hash = ASK_HASH.slice(1);
  window.location.reload();
}

/** Open while "Who's watching?" is up over the app, from the rail. */
export const profileSwitcher = createStore<boolean>(false);
