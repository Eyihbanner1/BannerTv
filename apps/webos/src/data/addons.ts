import {
  answerState,
  createAddonClient,
  createAddonCollection,
  createAddonHealth,
  createLimiter,
  createQueryCache,
  DEFAULT_ADDONS,
  type InstalledAddon,
  installIdForUrl,
  installIdOf,
  MANIFEST_TIMEOUT_MS,
  observeAnswers,
} from '@bannertv/core';
import { parseManifest } from '@bannertv/protocol';
import { fetchJson } from '../platform/http';
import { isKidsProfile } from './profiles';
import { storage } from './storage';

/** Most requests the app runs at once (docs/PLAN.md, request routing rule 4). */
const MAX_REQUESTS = 6;
const MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IDLE_DELAY_MS = 5000;

/** A clock that does not jump when the TV sets its time, for how long a request took. */
const elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * How each install last answered: in good time, slowly, or not at all, and
 * since when. Kept on this screen only, under the install's name: it says how
 * this screen reaches the addon, so it never goes to the account.
 */
export const addonHealth = createAddonHealth({ storage: storage.kv });

// Every request to an installed addon notes how it answered, the daily manifest refresh's
// included, without the collection or the client knowing. The collection is read only when
// a request goes, by which time it exists.
const watchedFetch = observeAnswers(fetchJson, {
  installOf: (url) => installIdForUrl(addonCollection.get().addons, url),
  note: addonHealth.note,
  elapsed,
});

export const addonCollection = createAddonCollection({
  storage: storage.kv,
  fetchJson: watchedFetch,
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
  fetchJson: watchedFetch,
  kidsOnly: isKidsProfile,
});

/** Each installed addon's name, by its manifest id. */
export function addonNames(): Map<string, string> {
  return new Map(addonCollection.get().addons.map((a) => [a.manifest.id, a.manifest.name]));
}

/**
 * Asks an addon for its manifest once, for Check now, and notes how it
 * answered. The manifest itself is not used: refreshing it stays the daily
 * refresh's job. An answer that is not a manifest counts as none.
 */
export async function checkAddon(addon: InstalledAddon): Promise<void> {
  const id = installIdOf(addon);
  const started = elapsed();
  try {
    parseManifest(await fetchJson(addon.transportUrl, { timeoutMs: MANIFEST_TIMEOUT_MS }));
  } catch {
    addonHealth.note(id, 'failed');
    return;
  }
  addonHealth.note(id, answerState(undefined, elapsed() - started, MANIFEST_TIMEOUT_MS)!);
}

/**
 * What was noted about an install goes when the install does. At launch,
 * notes of installs a build before this one removed go too.
 */
function followRemovals(): void {
  let installed: readonly string[] | undefined;
  addonCollection.subscribe(() => {
    const { ready, addons } = addonCollection.get();
    if (!ready) return;
    const ids = addons.map(installIdOf);
    if (!installed) {
      void addonHealth.load().then(() => {
        const now = addonCollection.get().addons.map(installIdOf);
        const stale = Array.from(addonHealth.get().keys()).filter((id) => now.indexOf(id) === -1);
        if (stale.length > 0) addonHealth.forget(stale);
      });
    }
    const gone = installed ? installed.filter((id) => ids.indexOf(id) === -1) : [];
    installed = ids;
    if (gone.length > 0) addonHealth.forget(gone);
  });
}

/**
 * Reads the addon collection, then refreshes day-old manifests once Home has
 * had a few seconds to load, so the refresh never competes with the first rows.
 */
export function startAddons(): void {
  followRemovals();
  void addonHealth.load();
  void addonCollection.load().then(() => {
    setTimeout(() => {
      void addonCollection.refreshManifests(MANIFEST_MAX_AGE_MS);
    }, IDLE_DELAY_MS);
  });
}
