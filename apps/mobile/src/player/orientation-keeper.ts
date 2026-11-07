/**
 * Which way the phone stands, decided in one place. The player turns the phone sideways while it
 * is open and the rest of the app stands upright. Going from one episode to the next swaps one
 * player for another, so letting go waits a moment, and a player that takes over in that moment
 * keeps the phone as it is.
 *
 * Letting go once is not enough, because a new start of the app knows nothing of the old player.
 * When Android closes the app in the background while the player is open and later brings it
 * back, the activity keeps the player's sideways lock and the app opens on Home; after the app
 * starts itself again ("Who's watching?", a profile switch) the navigation bar stays hidden. So
 * the app also asks for the way it wants to stand each time it starts and each time it comes back
 * to the front (`refresh`). A new activity also starts upright natively, before the JavaScript
 * runs (modules/banner-relaunch, UprightStartPackage.kt).
 */
export type Stance = 'landscape' | 'upright';

export interface OrientationKeeper {
  /**
   * Turns the phone sideways. The returned function lets go (once; later calls do nothing), and
   * the phone stands upright a moment later unless another player has taken over.
   */
  hold(): () => void;
  /**
   * Asks again for the way the app wants to stand now: sideways while a player holds it, upright
   * otherwise. A player letting go that is still settling decides for itself when it is done.
   */
  refresh(): void;
}

export function orientationKeeper(
  apply: (stance: Stance) => void,
  settleMs: number,
): OrientationKeeper {
  let holders = 0;
  let settling: ReturnType<typeof setTimeout> | undefined;
  const stopSettling = () => {
    clearTimeout(settling);
    settling = undefined;
  };
  return {
    hold() {
      holders += 1;
      stopSettling();
      apply('landscape');
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        stopSettling();
        settling = setTimeout(() => {
          settling = undefined;
          if (holders === 0) apply('upright');
        }, settleMs);
      };
    },
    refresh() {
      if (settling !== undefined) return;
      apply(holders > 0 ? 'landscape' : 'upright');
    },
  };
}
