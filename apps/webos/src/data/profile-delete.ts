import { MAIN_PROFILE_ID, profileKeyPrefix } from '@bannertv/core';
import { deletePreferences } from './preferences';
import { activeProfileId, removeProfile } from './profiles';
import { storage } from './storage';

/**
 * Deletes a profile and everything kept for it on this TV: its history,
 * My List, Trakt sign-in and settings. Main, and the profile in use, stay.
 */
export async function deleteProfile(id: string): Promise<void> {
  if (id === MAIN_PROFILE_ID || id === activeProfileId.get()) return;
  removeProfile(id);
  deletePreferences(id);
  try {
    await storage.kv.deletePrefix?.(profileKeyPrefix(id));
  } catch {
    // Left behind, the data is out of reach: ids are random, so a new
    // profile does not land on it.
  }
}
