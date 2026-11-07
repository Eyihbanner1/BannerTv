import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * The player turns the phone sideways and hides the system bars; the rest of the app stands
 * upright. Going from one episode to the next swaps one player for another, so letting go waits
 * a moment, and a player that takes over in that moment keeps the phone as it is.
 */
const SETTLE_MS = 400;
let holders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function holdLandscape(): () => void {
  holders += 1;
  clearTimeout(timer);
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
  NavigationBar.setVisibilityAsync('hidden').catch(() => undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (holders > 0) return;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => undefined,
      );
      NavigationBar.setVisibilityAsync('visible').catch(() => undefined);
    }, SETTLE_MS);
  };
}
