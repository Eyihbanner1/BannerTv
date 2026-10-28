import {
  cleanName,
  createPinGuard,
  createStore,
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

// Read before the first paint to decide between the picker and Home, so localStorage.
const KEY = 'bannertv.profiles';
// The profile chosen in this run of the app. A switch reloads the app, and
// sessionStorage outlives the reload but not the app closing.
const SESSION_KEY = 'bannertv.profile';
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

export const profiles = createStore<ProfilesState>(readSaved());
profiles.subscribe(() => save(profiles.get()));

/**
 * Who is watching, or null while the picker waits for an answer. With one
 * profile it is always Main; otherwise the profile chosen earlier in this run
 * (before a switch reloaded the app), or, with the picker turned off, the
 * last profile used unless a PIN guards it.
 */
function initialChoice(state: ProfilesState): string | null {
  if (state.profiles.length === 1) return MAIN_PROFILE_ID;
  let session: string | null = null;
  try {
    session = sessionStorage.getItem(SESSION_KEY);
  } catch {
    session = null;
  }
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

function reloadApp(): void {
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
  if (activeProfileId.get() !== id) reloadApp();
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
  const id = newProfileId(
    state.profiles.map((p) => p.id),
    Math.random,
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
      else next.pin = makePin(digits, Math.random);
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

/** Open while "Who's watching?" is up over the app, from the rail. */
export const profileSwitcher = createStore<boolean>(false);
