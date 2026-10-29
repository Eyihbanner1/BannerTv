import { sha256 } from './sha256';

/** The person who used BannerTV before profiles existed. Their data keeps its old keys. */
export const MAIN_PROFILE_ID = 'main';
export const MAX_PROFILES = 6;
export const MAX_NAME_LENGTH = 20;
/** How many colours a profile can take (brand violets, drawn by the app). */
export const PROFILE_COLOURS = 6;
export const PIN_LENGTH = 4;

/** UK age ratings a kids profile can allow, lowest first. */
export const KIDS_RATINGS = ['U', 'PG', '12'] as const;
export type KidsRating = (typeof KIDS_RATINGS)[number];

export interface StoredPin {
  salt: string;
  /** SHA-256 of the salt and the digits, as hex. */
  hash: string;
}

export interface Profile {
  /** [a-z0-9] only, safe in storage keys and focus keys. */
  id: string;
  name: string;
  /** 0 to PROFILE_COLOURS - 1. */
  colour: number;
  /** Set for a kids profile: the highest age rating it may watch. */
  kids?: KidsRating;
  pin?: StoredPin;
}

export interface ProfilesState {
  /** Never empty; Main is always first. */
  profiles: Profile[];
  /** The profile used last, opened at launch when the picker is off. */
  lastId: string;
  /** Show "Who's watching?" at launch when there is more than one profile. */
  askAtLaunch: boolean;
}

export function defaultProfiles(mainName: string): ProfilesState {
  return {
    profiles: [{ id: MAIN_PROFILE_ID, name: mainName, colour: 0 }],
    lastId: MAIN_PROFILE_ID,
    askAtLaunch: true,
  };
}

const ID = /^[a-z0-9]{1,16}$/;
const HEX = /^[0-9a-f]+$/;

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function readPin(value: unknown): StoredPin | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { salt, hash } = value as Record<string, unknown>;
  if (typeof salt !== 'string' || salt === '' || typeof hash !== 'string') return undefined;
  if (hash.length !== 64 || !HEX.test(hash)) return undefined;
  return { salt, hash };
}

function readProfile(value: unknown): Profile | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return undefined;
  const name = typeof raw.name === 'string' ? cleanName(raw.name) : '';
  if (name === '') return undefined;
  const colour =
    typeof raw.colour === 'number' && raw.colour >= 0 && raw.colour < PROFILE_COLOURS
      ? Math.floor(raw.colour)
      : 0;
  const profile: Profile = { id: raw.id, name, colour };
  if (KIDS_RATINGS.indexOf(raw.kids as KidsRating) !== -1) profile.kids = raw.kids as KidsRating;
  const pin = readPin(raw.pin);
  if (pin) profile.pin = pin;
  return profile;
}

/**
 * The saved profiles, read item by item. Main is always there and first,
 * even if what was saved lost it; a damaged profile is dropped, not the rest.
 */
export function readProfiles(saved: unknown, mainName: string): ProfilesState {
  const fallback = defaultProfiles(mainName);
  if (typeof saved !== 'object' || saved === null) return fallback;
  const raw = saved as Record<string, unknown>;
  const profiles: Profile[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.profiles) ? raw.profiles : []) {
    const profile = readProfile(item);
    if (!profile || seen.has(profile.id) || profiles.length >= MAX_PROFILES) continue;
    seen.add(profile.id);
    profiles.push(profile);
  }
  const mainIndex = profiles.findIndex((p) => p.id === MAIN_PROFILE_ID);
  if (mainIndex < 0) {
    profiles.unshift(fallback.profiles[0]!);
    if (profiles.length > MAX_PROFILES) profiles.pop();
  } else if (mainIndex > 0) {
    profiles.unshift(profiles.splice(mainIndex, 1)[0]!);
  }
  // Main is the grown-up who set BannerTV up; it can never be a kids profile.
  delete profiles[0]!.kids;
  const lastId =
    typeof raw.lastId === 'string' && seen.has(raw.lastId) ? raw.lastId : MAIN_PROFILE_ID;
  const askAtLaunch = typeof raw.askAtLaunch === 'boolean' ? raw.askAtLaunch : true;
  return { profiles, lastId, askAtLaunch };
}

/**
 * The prefix of a profile's keys in the key-value store. Main keeps the bare
 * keys it had before profiles, so nothing moves and older builds still read it.
 */
export function profileKeyPrefix(profileId: string): string {
  return profileId === MAIN_PROFILE_ID ? '' : `p/${profileId}/`;
}

/** A new id not used by any of `taken`. `random` gives numbers in [0, 1). */
export function newProfileId(taken: readonly string[], random: () => number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 6; i++) id += alphabet[Math.floor(random() * alphabet.length)];
    if (taken.indexOf(id) === -1 && id !== MAIN_PROFILE_ID) return id;
  }
}

export function isPinFormat(digits: string): boolean {
  return digits.length === PIN_LENGTH && /^[0-9]+$/.test(digits);
}

/** A PIN to store: the digits are never kept, only a salted hash. */
export function makePin(digits: string, random: () => number): StoredPin {
  let salt = '';
  for (let i = 0; i < 16; i++) salt += Math.floor(random() * 16).toString(16);
  return { salt, hash: sha256(`${salt}:${digits}`) };
}

export function checkPin(digits: string, pin: StoredPin): boolean {
  return sha256(`${pin.salt}:${digits}`) === pin.hash;
}

/** Wrong PINs allowed before the pad waits. */
export const PIN_TRIES = 5;
export const PIN_LOCK_MS = 30000;

/** Wrong PINs per profile, as the guard keeps them between launches. */
export type PinTries = Record<string, { count: number; lockedUntil: number }>;

function readTries(saved: unknown): Map<string, { count: number; lockedUntil: number }> {
  const misses = new Map<string, { count: number; lockedUntil: number }>();
  if (typeof saved !== 'object' || saved === null) return misses;
  for (const [id, value] of Object.entries(saved as Record<string, unknown>)) {
    const entry = value as { count?: unknown; lockedUntil?: unknown } | null;
    if (
      entry &&
      typeof entry.count === 'number' &&
      typeof entry.lockedUntil === 'number' &&
      Number.isFinite(entry.count) &&
      Number.isFinite(entry.lockedUntil)
    ) {
      misses.set(id, { count: entry.count, lockedUntil: entry.lockedUntil });
    }
  }
  return misses;
}

export interface PinGuardOptions {
  now?: () => number;
  /** What `save` kept last time, so closing the app does not reset the count. */
  saved?: unknown;
  save?: (tries: PinTries) => void;
}

/**
 * Counts wrong PINs per profile: after PIN_TRIES in a row the pad refuses
 * every PIN for PIN_LOCK_MS. A right PIN starts the count again. The count
 * is saved, so restarting the app does not buy more tries.
 */
export function createPinGuard(options: PinGuardOptions = {}) {
  const { now = Date.now, save } = options;
  const misses = readTries(options.saved);
  const persist = () => {
    if (!save) return;
    const tries: PinTries = {};
    misses.forEach((entry, id) => {
      tries[id] = { count: entry.count, lockedUntil: entry.lockedUntil };
    });
    save(tries);
  };
  const waitMs = (profileId: string): number => {
    const entry = misses.get(profileId);
    if (!entry) return 0;
    // A clock set back since the lock began would stretch it: start it again from now.
    if (entry.lockedUntil - now() > PIN_LOCK_MS) entry.lockedUntil = now() + PIN_LOCK_MS;
    return Math.max(0, entry.lockedUntil - now());
  };
  return {
    /** Milliseconds until the profile's pad takes PINs again; 0 when it does. */
    waitMs,
    /**
     * Checks `digits` unless the pad is waiting. The try that reaches the
     * limit answers 'locked', so the pad says to wait straight away.
     */
    attempt(profile: Profile, digits: string): 'ok' | 'wrong' | 'locked' {
      if (!profile.pin) return 'ok';
      if (waitMs(profile.id) > 0) return 'locked';
      if (checkPin(digits, profile.pin)) {
        if (misses.delete(profile.id)) persist();
        return 'ok';
      }
      const entry = misses.get(profile.id) ?? { count: 0, lockedUntil: 0 };
      entry.count += 1;
      const locked = entry.count >= PIN_TRIES;
      if (locked) {
        entry.count = 0;
        entry.lockedUntil = now() + PIN_LOCK_MS;
      }
      misses.set(profile.id, entry);
      persist();
      return locked ? 'locked' : 'wrong';
    },
    /** Forgets a deleted profile's wrong tries. */
    forget(profileId: string): void {
      if (misses.delete(profileId)) persist();
    },
  };
}

export type PinGuard = ReturnType<typeof createPinGuard>;
