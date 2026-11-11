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
 * - `update`: a downloaded app update, which nobody asked for at that moment: only on Home,
 *   Settings or the account screen with nothing being typed, on screen or off;
 * - `offScreen`: an update the person put off: the same, and only once the app is off screen.
 *
 * Off screen is not enough for an update. Android counts the app as in the background whenever
 * something covers it, not only when the person has put it away: a permission prompt, or the
 * browser opened to sign in to Trakt or to set an addon up. Those flows wait in this JavaScript
 * for the person to come back, so starting it again there loses them, and a text box loses what
 * was typed. The player is never left either, so the person comes back to their film.
 */
export type RestartRule = 'join' | 'update' | 'offScreen';

/** Where the app may start again under the person: Home, Settings and the account screen. */
export const SAFE_SCREENS: readonly string[] = ['home', 'settings', 'account'];

/** Whether starting the app again now loses the person nothing, by `rule`. */
export function safeMoment(where: Whereabouts, rule: RestartRule): boolean {
  const settled = !where.busy() && SAFE_SCREENS.indexOf(where.screen()) !== -1;
  switch (rule) {
    case 'join':
      return where.hidden() || settled;
    case 'update':
      return settled;
    case 'offScreen':
      return settled && where.hidden();
  }
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
