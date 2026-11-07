import type { Profile, ProfilesState } from '@bannertv/core';
import { openSection, push } from '../app/router';
import { activeProfile, activeProfileId, askAgainOnRelaunch, profiles } from './profiles';

/**
 * A title to open from outside the app, such as a card on the system's
 * "Continue watching" row: ids only, never an addon's address.
 */
export interface OpenLink {
  type: string;
  meta: string;
  /** The video the card was for. Details is what opens, with Resume on it. */
  video?: string;
}

// Content types are short lowercase words (movie, series, channel, tv); ids are an addon's own
// and only need to be sane text, since they go to the addons exactly as a tile's would.
const TYPE = /^[a-z0-9_-]{1,32}$/;
const MAX_ID = 300;

function isId(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID) return false;
  // No control characters: an id never has any, and one that does was made up.
  for (let i = 0; i < value.length; i += 1) if (value.charCodeAt(i) < 0x20) return false;
  return true;
}

/**
 * The link as the shell hands it over, or null when it is not one the app
 * opens. Another app on the device can send one, so nothing is taken on trust.
 */
export function readOpenLink(value: unknown): OpenLink | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, meta, video } = value as Record<string, unknown>;
  if (typeof type !== 'string' || !TYPE.test(type) || !isId(meta)) return null;
  const link: OpenLink = { type, meta };
  if (isId(video)) link.video = video;
  return link;
}

/**
 * Whether opening a link asks "Who's watching?" first, by the rule a
 * relaunch from the launcher follows (askAgainOnRelaunch): with more than one
 * profile, when the profile in use has a PIN or the picker is to show at
 * launch. The system's row holds the profile in use's titles, so that is the
 * profile the card was for.
 */
export function asksFirst(
  state: ProfilesState = profiles.get(),
  inUse: Profile | undefined = activeProfile(),
): boolean {
  return state.profiles.length > 1 && (state.askAtLaunch || inUse?.pin !== undefined);
}

/**
 * Opens a title's Details over Home, as a fresh start would have it: Back
 * goes to Home, and Details puts focus on Resume when there is a place to
 * resume, so the person sees what plays before it does.
 */
export function openTitle(link: OpenLink): void {
  openSection('home');
  // Nothing on Home was pressed to get here, so Back lands where Home starts.
  push({ name: 'details', type: link.type, id: link.meta }, () => undefined);
}

/** Runs `run` once someone has said who is watching: at once when they have. */
function whenChosen(run: () => void): void {
  if (activeProfileId.get() !== null) {
    run();
    return;
  }
  const stop = activeProfileId.subscribe(() => {
    if (activeProfileId.get() === null) return;
    stop();
    run();
  });
}

/**
 * Opens the links the shell hands over. `take` gives the link waiting there,
 * if any, and the shell keeps it until it is taken, which survives the
 * reload that asks "Who's watching?" again. So the link is taken only once
 * someone is watching: at launch after the picker, or at once when the app
 * was opened from a card while it ran. Returns what to call when the shell
 * says a link has come in while the app is running.
 */
export function startOpenLinks(take: () => unknown): () => void {
  const openWaiting = () => {
    const link = readOpenLink(take());
    if (link) openTitle(link);
  };
  whenChosen(openWaiting);
  return () => {
    // "Who's watching?" is up already: the link opens once it has an answer.
    if (activeProfileId.get() === null) return;
    if (asksFirst()) {
      askAgainOnRelaunch();
      return;
    }
    openWaiting();
  };
}
