import {
  createTraktAccount,
  MAIN_PROFILE_ID,
  profileKeyPrefix,
  profileKeyValueStore,
} from '@bannertv/core';
import { traktSend } from './api';
import { deletePreferences } from './preferences';
import { activeProfileId, pinGuard, removeProfile } from './profiles';
import { storage } from './storage';

/**
 * Deletes a profile and everything kept for it on this TV: its history,
 * My List, Trakt sign-in and settings. Main, and the profile in use, stay.
 */
export async function deleteProfile(id: string): Promise<void> {
  if (id === MAIN_PROFILE_ID || id === activeProfileId.get()) return;
  const prefix = profileKeyPrefix(id);
  removeProfile(id);
  deletePreferences(id);
  pinGuard.forget(id);
  try {
    // Its Trakt sign-in ends on Trakt too, not just on this TV.
    const kv = profileKeyValueStore(storage.kv, Promise.resolve(prefix));
    await createTraktAccount({ storage: kv, send: traktSend }).signOut();
  } catch {
    // The token runs out by itself.
  }
  try {
    await storage.kv.deletePrefix?.(prefix);
  } catch {
    // Left behind, the data is out of reach: ids are random, so a new
    // profile does not land on it.
  }
}
