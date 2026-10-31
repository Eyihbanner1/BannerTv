import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { reportScreen } from '../runtime/whereabouts';

/** Tells the account's restart rule which screen is on top while this one is. */
export function useScreenName(screen: string): void {
  useFocusEffect(useCallback(() => reportScreen(screen), [screen]));
}
