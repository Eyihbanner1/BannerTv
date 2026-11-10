/**
 * What the player does about the video while the sleep timer has it paused. A stream that starts
 * playing under the dark screen is paused again, as on the TV. In picture-in-picture the dark
 * screen can't show, so its Carry on watching can't be pressed: Play in the small window (or on
 * headphones while it is up) is the viewer carrying on. Only once the video has stopped, though:
 * as the timer runs out the video is still playing, and that must be paused, not taken as a wake.
 */
export function sleepHold({
  playing,
  stopped,
  unseen,
}: {
  /** The video plays now. */
  playing: boolean;
  /** It has stopped since the timer paused it. */
  stopped: boolean;
  /** The dark screen can't be seen: picture-in-picture. */
  unseen: boolean;
}): 'pause' | 'wake' | 'wait' {
  if (!playing) return 'wait';
  return unseen && stopped ? 'wake' : 'pause';
}
