/**
 * Presses a remote key as an LG TV would, for hosts whose keys reach the page
 * under other codes or not at all: Android sends them over its bridge
 * (platform/android.ts), and a Samsung TV sends codes of its own for Back,
 * Play/Pause and its on-screen keyboard (platform/tizen.ts). The app answers
 * the LG codes in navigation/keys.ts.
 */

/** Presses `keyCode` as the TV would: keydown then keyup, on whatever has focus. */
export function pressKey(keyCode: number, key: string, repeat: boolean): void {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup'] as const) {
    if (type === 'keyup' && repeat) break;
    const event = new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
    // keyCode cannot be set through the constructor; the app reads it, as the TV sends it.
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    Object.defineProperty(event, 'which', { get: () => keyCode });
    target.dispatchEvent(event);
  }
}

/** Whether the player's video is paused, or nothing plays: a single Play/Pause button then plays. */
export function playerPaused(): boolean {
  // Not the link test's hidden element, which stays in the page once used.
  const video = document.querySelector<HTMLVideoElement>('video:not([aria-hidden])');
  return video ? video.paused : true;
}
