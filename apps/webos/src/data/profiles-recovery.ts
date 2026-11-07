import {
  createTraktAccount,
  loadSyncState,
  MAIN_PROFILE_ID,
  type Profile,
  profileKeyPrefix,
  profileKeyValueStore,
  readAccountCode,
} from '@bannertv/core';
import { traktSend } from './api';
import { pinGuard, profiles, setProfilePin } from './profiles';
import { browserTimers } from './sports';
import { storage } from './storage';

/**
 * A way back in when a PIN is forgotten. Each way asks for something only
 * the owner should have, so a child at the picker cannot use it to open a
 * locked profile:
 *
 * - another profile's PIN is taken off with Main's PIN, since Main set
 *   BannerTV up and its PIN guards the account (ADR 0006, decision 12);
 * - when Main has no PIN there is nothing stronger to ask for: anyone can
 *   open Main and change any unlocked profile already, so the PIN goes
 *   after a warning that says so;
 * - Main's own PIN, on a screen in a BannerTV account, goes with the
 *   account code, the one secret only the owner wrote down;
 * - Main's PIN on a screen with no account goes only by resetting
 *   BannerTV on this screen, which deletes everything a child could reach.
 *
 * In an account the PIN follows the profile, so taking it off here takes
 * it off on every screen, and resetting a screen would not help there:
 * joining again brings the PIN back.
 */
export type PinRecovery = 'main-pin' | 'warn' | 'account-code' | 'reset';

/**
 * How a forgotten PIN of `profile` can be taken off. For Main it depends on
 * whether this screen is in an account, which `accountCodeHere` finds out.
 */
export function pinRecovery(
  profile: Profile,
  list: readonly Profile[],
  inAccount: boolean,
): PinRecovery {
  if (profile.id === MAIN_PROFILE_ID) return inAccount ? 'account-code' : 'reset';
  const main = list.filter((p) => p.id === MAIN_PROFILE_ID)[0];
  return main?.pin ? 'main-pin' : 'warn';
}

/**
 * The account code this screen keeps, or undefined without an account or
 * when it cannot be read. A create still waiting for its code to be written
 * down does not count: the person may never have seen it.
 */
async function savedCode(): Promise<string | undefined> {
  try {
    const state = await loadSyncState(storage.kv, browserTimers);
    if (!state || state.phase === 'gone') return undefined;
    if (state.phase === 'creating' && state.step === undefined) return undefined;
    return state.code;
  } catch {
    return undefined;
  }
}

/** Whether this screen is in a BannerTV account whose code can prove who the owner is. */
export async function accountCodeHere(): Promise<boolean> {
  return (await savedCode()) !== undefined;
}

/** Checks a typed account code against the one this screen keeps, ignoring case, spaces and dashes. */
export async function isAccountCode(input: string): Promise<boolean> {
  const typed = readAccountCode(input);
  if (!typed) return false;
  const code = await savedCode();
  return code !== undefined && code === typed;
}

/**
 * Takes a profile's PIN off once the owner has proved who they are, and
 * forgets its wrong tries, so a pad that was waiting takes a new PIN at once.
 */
export function clearForgottenPin(id: string): void {
  setProfilePin(id, null);
  pinGuard.forget(id);
}

/** localStorage keys that describe the TV rather than anyone's data, kept by a reset. */
const DEVICE_KEYS: readonly string[] = ['bannertv.tuning'];
const SIGN_OUT_MS = 5000;

/**
 * Deletes everything BannerTV keeps on this screen, for a Main PIN that is
 * forgotten on a screen with no account: every profile and its My List,
 * Continue Watching, history and settings, the addons and their keys, and
 * the Trakt sign-ins, which end on Trakt too where it answers in time.
 * Device measurements stay. The app then starts again as new, with the
 * welcome. Never offered on a screen in an account, which would bring the
 * PIN back when it joined again.
 */
export async function resetThisScreen(): Promise<void> {
  const signOuts = profiles.get().profiles.map(async (profile) => {
    try {
      const kv = profileKeyValueStore(storage.kv, Promise.resolve(profileKeyPrefix(profile.id)));
      await createTraktAccount({ storage: kv, send: traktSend }).signOut();
    } catch {
      // The token runs out by itself.
    }
  });
  await Promise.race([
    Promise.all(signOuts),
    new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_MS)),
  ]);
  try {
    await storage.kv.deletePrefix?.('');
  } catch {
    // What is left can't be reached: the profiles that named it are going.
  }
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && key.indexOf('bannertv.') === 0 && DEVICE_KEYS.indexOf(key) === -1) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Without localStorage the profiles last only until the app closes anyway.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Nothing outlives the restart then.
  }
  window.location.hash = '';
  window.location.reload();
}
