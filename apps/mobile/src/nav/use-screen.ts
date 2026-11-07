import { activeProfileId } from '@tv/data/profiles';
import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { reportScreen } from '../runtime/whereabouts';

/** Tells the account's restart rule which screen is on top while this one is. */
export function useScreenName(screen: string): void {
  useFocusEffect(useCallback(() => reportScreen(screen), [screen]));
}

/**
 * The profile in use, as a key for the tabs' screens. The tabs mount under "Who's watching?"
 * before anyone is chosen, and the first choice of a run does not restart the app, so each tab
 * starts again once the profile is known instead of keeping what it read without one.
 */
export function useProfileKey(): string {
  return useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get) ?? '';
}
