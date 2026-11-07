import { createStore } from '@bannertv/core';
import { normalizeManifestUrl } from '@bannertv/protocol';

/**
 * Addon install links from outside the app: a stremio:// link tapped in the browser (an addon's
 * settings page gives one), or an addon's address shared to BannerTV from another app. The link
 * can carry the person's debrid or API keys, so it is held here in memory only, never in a route
 * param, in storage or in a log, until the Addons screen takes it and asks before adding.
 */

/** Stremio's install links, `stremio://host/path/manifest.json`, which mean the https address. */
const STREMIO_LINK = /stremio:\/\/[^\s"'<>]+/i;
/**
 * An addon's address as a web link: one that names its manifest, and ends there, or goes on
 * only to a query, or to punctuation that ends a sentence.
 */
const MANIFEST_LINK = /https?:\/\/[^\s"'<>]+?\/manifest\.json(?=$|[\s"'<>?#]|[.,;:!)\]]+(?:$|\s))/i;
/** What a sentence can leave stuck to the end of a link. */
const TRAILING = /[.,;:!)\]]+$/;
/** Longer than any addon address: shared text past this is not one. */
const MAX_TEXT = 8192;

/**
 * The addon address in a link or in shared text (a browser shares the page's title and its
 * address together), as the https manifest address; undefined when it holds none. Only a
 * stremio:// link or an address that names a manifest.json counts, so sharing an ordinary web
 * page does not offer to add it.
 */
export function readAddonLink(text: string): string | undefined {
  if (text.length > MAX_TEXT) return undefined;
  const found = STREMIO_LINK.exec(text)?.[0] ?? MANIFEST_LINK.exec(text)?.[0];
  return found ? normalizeManifestUrl(found.replace(TRAILING, '')) : undefined;
}

/** A link waiting for the Addons screen. A new object for each arrival, even of the same link. */
export interface AddonLink {
  url: string;
}

/** The latest link to arrive, until the Addons screen takes it or a kids profile drops it. */
export const addonLinks = createStore<AddonLink | null>(null);

/** Holds the addon link in `text`, if it has one. Returns whether it had. */
export function holdAddonLink(text: string): boolean {
  const url = readAddonLink(text);
  if (url === undefined) return false;
  addonLinks.set({ url });
  return true;
}

/** The link waiting, which then waits no more; undefined when none does. */
export function takeAddonLink(): string | undefined {
  const waiting = addonLinks.get();
  if (waiting === null) return undefined;
  addonLinks.set(null);
  return waiting.url;
}

/** Forgets the link waiting, without using it. */
export function dropAddonLink(): void {
  addonLinks.set(null);
}

/** Where the person is, as far as an arriving link is concerned. */
export interface LinkPlace {
  /** The welcome has been seen. */
  welcomed: boolean;
  /** The profile in use; null while "Who's watching?" is up. */
  profileId: string | null;
  /** The profile in use is a kids profile. */
  kids: boolean;
  /** The screen on top, as the screens report it (runtime/whereabouts.ts). */
  screen: string;
}

/**
 * What to do with a link waiting. Addons are for the grown-ups, as on the TV: until the welcome
 * is done and someone is chosen it waits, a kids profile drops it, and a grown-up gets the Addons
 * screen, which takes it itself when it is already on top.
 */
export function linkStep(place: LinkPlace): 'wait' | 'drop' | 'open' | 'here' {
  if (!place.welcomed || place.profileId === null) return 'wait';
  if (place.kids) return 'drop';
  return place.screen === 'addons' ? 'here' : 'open';
}
