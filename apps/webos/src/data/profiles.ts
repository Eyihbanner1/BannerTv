import {
  cleanName,
  createPinGuard,
  createStore,
  isRemoval,
  itemAt,
  type Items,
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

/** A value in localStorage as it is written, or null when there is none or it cannot be read. */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // The account's next pull, or the next launch, tries again.
  }
}

function readSaved(raw: string | null): ProfilesState {
  try {
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

/**
 * A kids setting held for the profile in use: its id, the account's setting,
 * and the profile's own, which an older build did not keep.
 */
type HeldKids = [string, KidsRating | null, (KidsRating | null)?];

interface HeldChanges {
  /** Profiles the account deleted: gone from the list at launch, their data deleted once started. */
  deleted: string[];
  /**
   * Profiles that joining with Use took away while in use: gone from the
   * list at launch, their data kept, as with the rest of what Use sets aside.
   */
  aside: string[];
  /** Kids settings of the profile in use, for the next launch to apply, until the account confirms them. */
  kids: HeldKids[];
}

const isRating = (value: unknown): value is KidsRating | null =>
  value === null || KIDS_RATINGS.indexOf(value as KidsRating) !== -1;

function readHeld(raw: string | null = readRaw(HELD_KEY)): HeldChanges {
  const held: HeldChanges = { deleted: [], aside: [], kids: [] };
  try {
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value !== 'object' || value === null) return held;
    const { deleted, aside, kids } = value as Record<string, unknown>;
    const ids = (list: unknown) =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
    held.deleted = ids(deleted);
    held.aside = ids(aside);
    if (Array.isArray(kids)) {
      for (const entry of kids) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isRating(entry[1])) continue;
        const own: unknown = entry[2];
        held.kids.push(isRating(own) ? [entry[0], entry[1], own] : [entry[0], entry[1]]);
      }
    }
  } catch {
    // Nothing held, then: the account sends the change again at its next pull.
  }
  return held;
}

function saveHeld(held: HeldChanges): void {
  const empty = held.deleted.length === 0 && held.aside.length === 0 && held.kids.length === 0;
  writeRaw(HELD_KEY, empty ? null : JSON.stringify(held));
}

/** The saved profiles with what the account held back applied, before anyone is chosen. */
function withHeld(state: ProfilesState, held: HeldChanges): ProfilesState {
  if (held.deleted.length === 0 && held.aside.length === 0 && held.kids.length === 0) return state;
  const gone = held.deleted.concat(held.aside);
  const list = state.profiles
    .filter((p) => p.id === MAIN_PROFILE_ID || gone.indexOf(p.id) === -1)
    .map((profile) => {
      const kids = held.kids.filter(([id]) => id === profile.id)[0];
      return kids && profile.id !== MAIN_PROFILE_ID ? withKids(profile, kids[1]) : profile;
    });
  return {
    ...state,
    profiles: list,
    lastId: list.some((p) => p.id === state.lastId) ? state.lastId : MAIN_PROFILE_ID,
  };
}

function withKids(profile: Profile, kids: KidsRating | null): Profile {
  const next: Profile = { ...profile };
  if (kids === null) delete next.kids;
  else next.kids = kids;
  return next;
}

/** The profiles and the changes held for them, as localStorage has them written. */
export interface SavedProfiles {
  profiles: string | null;
  held: string | null;
}

/**
 * What this launch read before the first paint, for a join's check that
 * its reload lost nothing (sync-joined.ts).
 */
export const launchSaved: Readonly<SavedProfiles> = {
  profiles: readRaw(KEY),
  held: readRaw(HELD_KEY),
};

const heldAtLaunch = readHeld(launchSaved.held);

export const profiles = createStore<ProfilesState>(
  withHeld(readSaved(launchSaved.profiles), heldAtLaunch),
);
profiles.subscribe(() => save(profiles.get()));
if (
  heldAtLaunch.deleted.length > 0 ||
  heldAtLaunch.aside.length > 0 ||
  heldAtLaunch.kids.length > 0
) {
  save(profiles.get());
  // Profiles set aside are off the list now. Deletions wait for their data to go
  // (deleteHeldProfiles), and kids settings for the account to confirm them (confirmHeldKids).
  if (heldAtLaunch.aside.length > 0) saveHeld({ ...heldAtLaunch, aside: [] });
}

/** The profiles and held changes as saved now, for a join to keep before its reload. */
export function savedProfiles(): SavedProfiles {
  return { profiles: readRaw(KEY), held: readRaw(HELD_KEY) };
}

/**
 * Writes back what a join saved, where this launch read an older copy
 * (sync-joined.ts). With `now`, the profiles change at once, as the next
 * launch would read them, the profile in use staying until then; without,
 * only localStorage changes, for the app to start again at once.
 */
export function restoreSaved(saved: SavedProfiles, now: boolean): void {
  writeRaw(HELD_KEY, saved.held);
  if (!now) {
    writeRaw(KEY, saved.profiles);
    return;
  }
  const next = withHeld(readSaved(saved.profiles), readHeld(saved.held));
  const inUse = activeProfile();
  if (inUse && !next.profiles.some((p) => p.id === inUse.id)) {
    next.profiles = next.profiles.concat(inUse);
  }
  profiles.set(next);
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

/** Joining with Use took away the profile in use: it leaves the list at the next launch, its data kept. */
export function holdProfileAside(id: string): void {
  if (id === MAIN_PROFILE_ID) return;
  const held = readHeld();
  if (held.aside.indexOf(id) !== -1) return;
  held.aside.push(id);
  saveHeld(held);
}

/**
 * The account changed the kids setting of the profile in use: it takes
 * effect at the next launch. Undefined drops what was held, as when the
 * account goes back to the profile's own setting.
 */
export function holdKidsChange(id: string, kids: KidsRating | null | undefined): void {
  if (id === MAIN_PROFILE_ID) return;
  const held = readHeld();
  const others = held.kids.filter(([other]) => other !== id);
  if (kids === undefined) {
    if (others.length === held.kids.length) return;
    held.kids = others;
  } else {
    const profile = profiles.get().profiles.filter((p) => p.id === id)[0];
    held.kids = others.concat([[id, kids, profile?.kids ?? null]]);
  }
  saveHeld(held);
}

/** The kids setting held for a profile until the next launch, or undefined when none is. */
export function heldKidsChange(id: string): KidsRating | null | undefined {
  const held = readHeld().kids.filter(([other]) => other === id)[0];
  return held ? held[1] : undefined;
}

/** Whether this launch applied kids settings the account held for it, which confirmHeldKids checks. */
export function kidsHeldAtLaunch(): boolean {
  return heldAtLaunch.kids.length > 0;
}

/**
 * Checks the kids settings this launch applied against the account's
 * profiles document as the engine last saved it (ADR 0006, decision 6), or
 * undefined when it could not be read. A setting the account has changed
 * back since is taken back, so a profile never opens with one the account
 * no longer has. Returns whether that was the profile in use, for the app
 * to start again with the setting it should have.
 */
export function confirmHeldKids(account: Items | undefined): boolean {
  if (heldAtLaunch.kids.length === 0) return false;
  let restart = false;
  let state = profiles.get();
  for (const [id, kids, own] of heldAtLaunch.kids) {
    const item = account && itemAt(account, `${id}/kids`);
    // Nothing there to go by: the setting stays.
    if (!item || id === MAIN_PROFILE_ID) continue;
    const now = isRemoval(item) ? null : item.v;
    if (!isRating(now) || now === kids) continue;
    // Held by an older build, the profile's own setting is the one it was saved with.
    const back =
      own !== undefined
        ? own
        : (readSaved(launchSaved.profiles).profiles.filter((p) => p.id === id)[0]?.kids ?? null);
    state = {
      ...state,
      profiles: state.profiles.map((p) => (p.id === id ? withKids(p, back) : p)),
    };
    if (id === activeProfileId.get()) restart = true;
  }
  if (state !== profiles.get()) profiles.set(state);
  // Held for this launch only: what the account changes from now on is held anew.
  const held = readHeld();
  saveHeld({
    ...held,
    kids: held.kids.filter((entry) => !heldAtLaunch.kids.some((done) => done[0] === entry[0])),
  });
  return restart;
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
  saveHeld({ ...held, deleted });
}

/**
 * How many of the account's profiles this screen does not show (ADR 0006,
 * decision 7): it shows six at most, Main, the one in use and then the
 * oldest in the account. Counted again whenever the account's profiles
 * reach this screen, the first pull of each launch included; 0 until then.
 * Deleting a profile makes room for one of them.
 */
export const hiddenProfiles = createStore<number>(0);

/** Sets how many of the account's profiles this screen leaves off. */
export function setHiddenProfiles(count: number): void {
  if (hiddenProfiles.get() !== count) hiddenProfiles.set(count);
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
