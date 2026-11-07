import {
  answerState,
  BANNERTV_DEMO_ID,
  createAddonClient,
  createAddonCollection,
  createAddonHealth,
  createAddonSwitches,
  createLimiter,
  createQueryCache,
  DEFAULT_ADDONS,
  InstallError,
  type InstalledAddon,
  installIdForUrl,
  installIdOf,
  MANIFEST_TIMEOUT_MS,
  observeAnswers,
  switchedOnOnly,
} from '@bannertv/core';
import { type Manifest, normalizeManifestUrl, parseManifest } from '@bannertv/protocol';
import { fetchJson } from '../platform/http';
import { tuning } from '../platform/tuning';
import { createPlayerFirst, type PlayerVideo } from './player-first';
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
  installOf: (url) => installIdForUrl(allAddons.get().addons, url),
  note: addonHealth.note,
  elapsed,
});

/**
 * Every install, those switched off included, in priority order: for the
 * Addons screens and their dialogs, and for the BannerTV account, which
 * keeps the addons whether they are on or off. Everything else reads
 * `addonCollection`.
 */
export const allAddons = createAddonCollection({
  storage: storage.kv,
  fetchJson: watchedFetch,
  defaults: DEFAULT_ADDONS,
});

/**
 * Which addons are switched off: one set for the screen, as the addons are,
 * and the account's when there is one. A default addon switched off is
 * still installed, so it stays off rather than coming back as new.
 */
export const addonSwitches = createAddonSwitches({ storage: storage.kv, collection: allAddons });

/**
 * The addons the app uses: every install but those switched off. Home,
 * Search, Discover, Sports, the player, subtitles and the addon client read
 * this, so a switched-off addon is asked nothing and shows nowhere, while
 * its settings and its place in the list are kept.
 */
export const addonCollection = switchedOnOnly(allAddons, addonSwitches);

/** Every request the app makes for browsing waits its turn here, TMDB's included. */
export const requestLimiter = createLimiter(MAX_REQUESTS);

/** Cached answers, kept across launches: addons' and TMDB's. */
export const queryCache = createQueryCache({ store: storage.cache });

// The videos a player has open, when their requests go first (tuning `playFirst`).
const playerFirst = tuning.playFirst ? createPlayerFirst() : undefined;

export const addonClient = createAddonClient({
  collection: addonCollection,
  queries: queryCache,
  limiter: requestLimiter,
  fetchJson: watchedFetch,
  kidsOnly: isKidsProfile,
  playPriority: playerFirst?.priority,
});

/**
 * While a player has these videos, their stream and subtitles requests go
 * ahead of every other request waiting for a slot, those already waiting
 * too, when the `playFirst` tuning switch is on. Returns the release.
 */
export function putVideosFirst(videos: readonly PlayerVideo[]): () => void {
  return playerFirst ? playerFirst.put(videos) : () => undefined;
}

/** Each installed addon's name, by its manifest id, those switched off included. */
export function addonNames(): Map<string, string> {
  return new Map(allAddons.get().addons.map((a) => [a.manifest.id, a.manifest.name]));
}

/** Switches an addon off, keeping its settings and its place, or back on. */
export function switchAddon(addon: InstalledAddon, off: boolean): void {
  addonSwitches.set(installIdOf(addon), off);
}

/**
 * The installs this profile could ask for streams, for the problem box: the
 * BannerTV Demo addon aside, which only plays its own clips, and adult
 * addons on a kids profile. `on`: one is switched on, so the player asks it.
 * `off`: one is installed but switched off, so it was not asked, and the box
 * says to switch it on rather than to add one.
 */
export function streamAddons(): { on: boolean; off: boolean } {
  const kids = isKidsProfile();
  const findsStreams = (addon: InstalledAddon) =>
    addon.manifest.id !== BANNERTV_DEMO_ID &&
    !(kids && addon.manifest.behaviorHints.adult) &&
    addon.manifest.resources.some((resource) => resource.name === 'stream');
  return {
    on: addonCollection.get().addons.some(findsStreams),
    off: allAddons.get().addons.some((addon) => addonSwitches.isOff(addon) && findsStreams(addon)),
  };
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
 * The manifest at an address, so a link from outside the app can be asked
 * about by name ("Add Torrentio?") before anything is added. Nothing is
 * installed or kept. It fails as an install would, so describeInstallError
 * reads its errors.
 */
export async function addonPreview(input: string): Promise<Manifest> {
  const url = normalizeManifestUrl(input);
  if (url === undefined) throw new InstallError('invalid-url', 'This is not an addon address');
  let json: unknown;
  try {
    json = await fetchJson(url, { timeoutMs: MANIFEST_TIMEOUT_MS });
  } catch {
    throw new InstallError('unreachable', 'The address did not answer');
  }
  try {
    return parseManifest(json);
  } catch {
    throw new InstallError('not-an-addon', 'The address did not answer with an addon');
  }
}

/**
 * What was noted about an install goes when the install does. At launch,
 * notes of installs a build before this one removed go too.
 */
function followRemovals(): void {
  let installed: readonly string[] | undefined;
  allAddons.subscribe(() => {
    const { ready, addons } = allAddons.get();
    if (!ready) return;
    const ids = addons.map(installIdOf);
    if (!installed) {
      void addonHealth.load().then(() => {
        const now = allAddons.get().addons.map(installIdOf);
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
 * Reads the addon collection and its switches, then refreshes day-old
 * manifests once Home has had a few seconds to load, so the refresh never
 * competes with the first rows. Switched-off addons are refreshed too, so
 * their cards stay up to date.
 */
export function startAddons(): void {
  followRemovals();
  void addonHealth.load();
  void addonSwitches.load();
  void allAddons.load().then(() => {
    setTimeout(() => {
      void allAddons.refreshManifests(MANIFEST_MAX_AGE_MS);
    }, IDLE_DELAY_MS);
  });
}
