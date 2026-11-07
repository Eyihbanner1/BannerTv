import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { AppState, Platform } from 'react-native';
import { orientationKeeper, type Stance } from './orientation-keeper';

/**
 * The player turns the phone sideways and hides the system bars; the rest of the app stands
 * upright (the rules are in orientation-keeper.ts).
 */
const SETTLE_MS = 400;

function apply(stance: Stance): void {
  const sideways = stance === 'landscape';
  // Fails only while there is no activity to ask (a start that has not reached it yet, or after
  // Android closed it): the 'active' that follows asks again. In the background it still works,
  // and Android applies it when the app is shown again.
  ScreenOrientation.lockAsync(
    sideways
      ? ScreenOrientation.OrientationLock.LANDSCAPE
      : ScreenOrientation.OrientationLock.PORTRAIT_UP,
  ).catch(() => undefined);
  NavigationBar.setVisibilityAsync(sideways ? 'hidden' : 'visible').catch(() => undefined);
}

const keeper = orientationKeeper(apply, SETTLE_MS);

/**
 * Turns the phone sideways and hides the navigation bar (the player hides the status bar itself)
 * while a player holds it; upright with the bar back a moment after the last holder lets go.
 */
export const holdLandscape = keeper.hold;

/**
 * Puts the phone the way the app wants it now, and again each time the app comes back to the
 * front. The app's frame calls it as it opens; the returned function stops it. Not on the web
 * build, which has no phone to turn.
 */
export function keepOrientation(): () => void {
  if (Platform.OS === 'web') return () => undefined;
  keeper.refresh();
  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') keeper.refresh();
  });
  return () => subscription.remove();
}
