/**
 * When the phone app may start itself again (shims/sync-reload.ts runs it): the LG app's rule
 * from data/sync-reload.ts, with a stricter one for app updates. Kept free of React Native so it
 * can be tested.
 */

/** Where the app is, as far as starting it again is concerned. */
export interface Whereabouts {
  /** The screen on top, by the name it reports (runtime/whereabouts.ts). */
  screen(): string;
  /** Nothing of the app is on screen: in the background, and no film in a small window. */
  hidden(): boolean;
  /** A text box is open for typing, or "Who's watching?" is up. */
  busy(): boolean;
  /** Tells `listener` of each move: another screen, the app hidden, a text box closed. */
  subscribe(listener: () => void): () => void;
}

/**
 * Whose restart it is:
 * - `join`: a join that carried on by itself finished, as on the TV: off screen, or Home,
 *   Settings or the account screen with nothing being typed;
 * - `update`: a downloaded app update, which nobody asked for at that moment: the same, except
 *   that the player is never left, even off screen, so the person comes back to their film;
 * - `offScreen`: an update the person put off: only once the app is off screen, not from the
 *   player either.
 */
export type RestartRule = 'join' | 'update' | 'offScreen';

/** Where the app may start again under the person: Home, Settings and the account screen. */
export const SAFE_SCREENS: readonly string[] = ['home', 'settings', 'account'];

/** Whether starting the app again now loses the person nothing, by `rule`. */
export function safeMoment(where: Whereabouts, rule: RestartRule): boolean {
  const screen = where.screen();
  if (where.hidden()) return rule === 'join' || screen !== 'player';
  if (rule === 'offScreen') return false;
  return !where.busy() && SAFE_SCREENS.indexOf(screen) !== -1;
}

/**
 * Runs `run` once starting the app again loses the person nothing, at once when it already
 * does. Returns a function that calls it off, which does nothing once `run` has run.
 */
export function whenSafe(
  where: Whereabouts,
  run: () => void,
  rule: RestartRule = 'join',
): () => void {
  if (safeMoment(where, rule)) {
    run();
    return () => undefined;
  }
  let done = false;
  const off = where.subscribe(() => {
    if (done || !safeMoment(where, rule)) return;
    done = true;
    off();
    run();
  });
  return () => {
    if (done) return;
    done = true;
    off();
  };
}
