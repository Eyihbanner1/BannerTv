import { router, topRoute } from '../app/router';
import { profileSwitcher } from './profiles';

/** Where the app is, as far as starting it again is concerned. */
export interface Whereabouts {
  /** The screen on top, by its route's name. */
  screen(): string;
  /** The app is off screen. */
  hidden(): boolean;
  /** A text box is open for typing, or "Who's watching?" is up. */
  busy(): boolean;
  /** Tells `listener` of each move: another screen, the app hidden, a text box closed. */
  subscribe(listener: () => void): () => void;
}

/**
 * Where the app may start again under the person: Home and Settings, and
 * the account screen, where a join that carried on by itself was asked for.
 * Never the player.
 */
const SAFE_SCREENS: readonly string[] = ['home', 'settings', 'account'];

/**
 * Runs `run` once starting the app again loses the person nothing: the next
 * time the app is off screen, or while Home, Settings or the account screen
 * shows with no text box open. At once when it already is.
 */
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

function typing(): boolean {
  const focused = typeof document === 'undefined' ? null : document.activeElement;
  return !!focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');
}

/** The app as the router, the page and "Who's watching?" have it. */
const app: Whereabouts = {
  screen: () => topRoute().name,
  hidden: () => document.hidden,
  busy: () => profileSwitcher.get() || typing(),
  subscribe(listener) {
    // Focus has moved on only once the event is over.
    const blurred = () => setTimeout(listener, 0);
    const offRouter = router.subscribe(listener);
    const offSwitcher = profileSwitcher.subscribe(listener);
    document.addEventListener('visibilitychange', listener);
    document.addEventListener('focusout', blurred);
    return () => {
      offRouter();
      offSwitcher();
      document.removeEventListener('visibilitychange', listener);
      document.removeEventListener('focusout', blurred);
    };
  },
};

/**
 * A join that carried on by itself has finished: the app starts again as
 * the account's screen, once that throws nobody out of what they are doing.
 */
export function reloadWhenSafe(run: () => void): void {
  whenSafe(app, run);
}
