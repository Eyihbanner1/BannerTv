import { profileSwitcher } from '@tv/data/profiles';
import { AppState } from 'react-native';
import { pictureInPicture } from '../player/phone-host';
import { whenSafe, type RestartRule, type Whereabouts } from '../runtime/safe-restart';
import { whereabouts } from '../runtime/whereabouts';

/**
 * The phone's stand-in for the LG app's data/sync-reload.ts (Metro swaps it in): the same rule,
 * read from the phone's screens instead of the TV's router and focus (runtime/safe-restart.ts).
 * App updates (runtime/app-updates.ts) restart through it too, by their own stricter rule.
 */

export { whenSafe, type Whereabouts };

const app: Whereabouts = {
  screen: () => whereabouts.get().screen,
  // A film playing in a small window over other apps is still on screen.
  hidden: () => AppState.currentState === 'background' && !pictureInPicture.get(),
  busy: () => profileSwitcher.get() || whereabouts.get().typing,
  subscribe(listener) {
    const offWhere = whereabouts.subscribe(listener);
    const offSwitcher = profileSwitcher.subscribe(listener);
    const offPicture = pictureInPicture.subscribe(listener);
    const appState = AppState.addEventListener('change', listener);
    return () => {
      offWhere();
      offSwitcher();
      offPicture();
      appState.remove();
    };
  },
};

/** A join that carried on by itself has finished: start again, once that interrupts nothing. */
export function reloadWhenSafe(run: () => void): void {
  whenSafe(app, run);
}

/**
 * A downloaded app update is ready: runs `restart`, which starts it, once that interrupts
 * nothing by `rule`. A join's reload would not do: Expo's reloadAppAsync runs the same
 * JavaScript again, and only expo-updates' own reloadAsync starts a downloaded update. Returns a
 * function that calls the restart off.
 */
export function restartWhenSafe(
  restart: () => void,
  rule: Exclude<RestartRule, 'join'> = 'update',
): () => void {
  return whenSafe(app, restart, rule);
}
