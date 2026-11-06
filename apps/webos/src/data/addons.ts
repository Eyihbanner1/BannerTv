import {
  BANNERTV_DEMO_ID,
  createAddonClient,
  createAddonCollection,
  createLimiter,
  createQueryCache,
  DEFAULT_ADDONS,
} from '@bannertv/core';
import { fetchJson } from '../platform/http';
import { isKidsProfile } from './profiles';
import { storage } from './storage';

/** Most requests the app runs at once (docs/PLAN.md, request routing rule 4). */
const MAX_REQUESTS = 6;
const MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IDLE_DELAY_MS = 5000;

export const addonCollection = createAddonCollection({
  storage: storage.kv,
  fetchJson,
  defaults: DEFAULT_ADDONS,
});

/** Every request the app makes for browsing waits its turn here, TMDB's included. */
export const requestLimiter = createLimiter(MAX_REQUESTS);

/** Cached answers, kept across launches: addons' and TMDB's. */
export const queryCache = createQueryCache({ store: storage.cache });

export const addonClient = createAddonClient({
  collection: addonCollection,
  queries: queryCache,
  limiter: requestLimiter,
  fetchJson,
  kidsOnly: isKidsProfile,
});

/** Each installed addon's name, by its manifest id. */
export function addonNames(): Map<string, string> {
  return new Map(addonCollection.get().addons.map((a) => [a.manifest.id, a.manifest.name]));
}

/**
 * Whether any addon this profile uses finds streams: the BannerTV Demo addon
 * aside, which only plays its own clips, and adult addons on a kids profile.
 */
export function hasStreamAddon(): boolean {
  const kids = isKidsProfile();
  return addonCollection
    .get()
    .addons.some(
      (addon) =>
        addon.manifest.id !== BANNERTV_DEMO_ID &&
        !(kids && addon.manifest.behaviorHints.adult) &&
        addon.manifest.resources.some((resource) => resource.name === 'stream'),
    );
}

/**
 * Reads the addon collection, then refreshes day-old manifests once Home has
 * had a few seconds to load, so the refresh never competes with the first rows.
 */
export function startAddons(): void {
  void addonCollection.load().then(() => {
    setTimeout(() => {
      void addonCollection.refreshManifests(MANIFEST_MAX_AGE_MS);
    }, IDLE_DELAY_MS);
  });
}
