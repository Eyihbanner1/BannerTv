import {
  createAddonClient,
  createAddonCollection,
  createLimiter,
  createQueryCache,
  DEFAULT_ADDONS,
} from '@bannertv/core';
import { fetchJson } from '../platform/http';
import { createStorage } from '../platform/idb';

/** Most requests the app runs at once (docs/PLAN.md, request routing rule 4). */
const MAX_REQUESTS = 6;
const MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IDLE_DELAY_MS = 5000;

const storage = createStorage();

export const addonCollection = createAddonCollection({
  storage: storage.kv,
  fetchJson,
  defaults: DEFAULT_ADDONS,
});

export const addonClient = createAddonClient({
  collection: addonCollection,
  queries: createQueryCache({ store: storage.cache }),
  limiter: createLimiter(MAX_REQUESTS),
  fetchJson,
});

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
