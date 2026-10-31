/** The third episode in a row to start by itself asks "Still watching?" first. */
export const STILL_WATCHING_EPISODES = 3;
/** After this long with nothing pressed, the next episode asks "Still watching?" first. */
export const STILL_WATCHING_QUIET_MS = 90 * 60 * 1000;

/**
 * Whether to ask "Still watching?" at the moment the next episode would
 * start by itself. `autoplaysSinceInput` counts the episodes that already
 * started by themselves since the last key press or pointer move, not the
 * one about to start; `sinceInputMs` is the time since that input.
 *
 * It asks when two episodes have already started by themselves, so this
 * would be the third in a row: the viewer has sat through those two, and
 * the end of the one they last touched, with nothing pressed. It also asks
 * when nothing has been pressed for 90 minutes, whatever the count. The
 * first next episode after any input never asks for the count alone.
 */
export function askStillWatching(input: {
  autoplaysSinceInput: number;
  sinceInputMs: number;
}): boolean {
  return (
    input.autoplaysSinceInput + 1 >= STILL_WATCHING_EPISODES ||
    input.sinceInputMs >= STILL_WATCHING_QUIET_MS
  );
}
