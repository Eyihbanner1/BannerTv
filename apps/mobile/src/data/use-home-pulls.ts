import { browserTimers } from '@tv/data/sports';
import { accountPullMinutes, accountState, refreshAccount } from '@tv/data/sync';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';
import { createHomePulls } from './home-pulls';

// As the browser stand-ins have it (runtime/web-globals.ts): only the background is hidden.
const foreground = (state: string | null | undefined) => state !== 'background';

// One for the whole run, so the 30 seconds hold when Home starts again for the profile chosen.
const homePulls = createHomePulls({
  pull: () => void refreshAccount(),
  now: Date.now,
  timers: browserTimers,
  lastPull: () => accountState.get().status.lastPull,
  pullMinutes: accountPullMinutes,
  active: foreground(AppState.currentState),
});

AppState.addEventListener('change', (next) => homePulls.setActive(foreground(next)));

/**
 * Home asks the account what other screens changed as it comes into focus, and every 2 minutes
 * while it stays there with the app open: a film paused on the TV shows in Continue watching
 * without pulling to refresh. Nothing happens on a phone without an account.
 */
export function useHomePulls(): void {
  useFocusEffect(
    useCallback(() => {
      homePulls.focus();
      return () => homePulls.blur();
    }, []),
  );
}
