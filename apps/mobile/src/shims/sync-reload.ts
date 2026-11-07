import { profileSwitcher } from '@tv/data/profiles';
import { AppState } from 'react-native';
import { whereabouts } from '../runtime/whereabouts';

/**
 * The phone's stand-in for the LG app's data/sync-reload.ts (Metro swaps it in): the same rule,
 * read from the phone's screens instead of the TV's router and focus.
 */

/** Where the app is, as far as starting it again is concerned. */
export interface Whereabouts {
  screen(): string;
  hidden(): boolean;
  busy(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Where the app may start again under the person: Home, Settings and the account screen. */
const SAFE_SCREENS: readonly string[] = ['home', 'settings', 'account'];

/** Runs `run` once starting the app again loses the person nothing. At once when it already is. */
export function whenSafe(where: Whereabouts, run: () => void): void {
  const safe = () =>
    where.hidden() || (!where.busy() && SAFE_SCREENS.indexOf(where.screen()) !== -1);
  if (safe()) {
    run();
    return;
  }
  let done = false;
  const off = where.subscribe(() => {
    if (done || !safe()) return;
    done = true;
    off();
    run();
  });
}

const app: Whereabouts = {
  screen: () => whereabouts.get().screen,
  hidden: () => AppState.currentState === 'background',
  busy: () => profileSwitcher.get() || whereabouts.get().typing,
  subscribe(listener) {
    const offWhere = whereabouts.subscribe(listener);
    const offSwitcher = profileSwitcher.subscribe(listener);
    const appState = AppState.addEventListener('change', listener);
    return () => {
      offWhere();
      offSwitcher();
      appState.remove();
    };
  },
};

/** A join that carried on by itself has finished: start again, once that interrupts nothing. */
export function reloadWhenSafe(run: () => void): void {
  whenSafe(app, run);
}
