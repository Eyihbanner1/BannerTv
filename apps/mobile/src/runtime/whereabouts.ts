import { createStore } from '@bannertv/core';

/**
 * Where the person is in the phone app, as far as starting it again is concerned (the account's
 * join restarts the app, see shims/sync-reload.ts). The screens report it; nothing else reads it.
 */
export interface Whereabouts {
  /** The screen on top, named as the TV names it where they match: home, settings, account. */
  screen: string;
  /** A text box is open for typing. */
  typing: boolean;
}

export const whereabouts = createStore<Whereabouts>({ screen: 'home', typing: false });

export function reportScreen(screen: string): void {
  if (whereabouts.get().screen !== screen) whereabouts.set({ ...whereabouts.get(), screen });
}

export function reportTyping(typing: boolean): void {
  if (whereabouts.get().typing !== typing) whereabouts.set({ ...whereabouts.get(), typing });
}
