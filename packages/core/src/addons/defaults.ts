import demo from './bannertv-demo.manifest.json';
import cinemeta from './cinemeta.manifest.json';
import openSubtitles from './opensubtitles-v3.manifest.json';
import type { StoredAddon } from './collection';

export const BANNERTV_DEMO_URL = 'https://demo.bannertv.workers.dev/manifest.json';
/** Its manifest id, which stream entries carry as `addonId`. */
export const BANNERTV_DEMO_ID = demo.id;
export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
export const OPENSUBTITLES_V3_URL = 'https://opensubtitles-v3.strem.io/manifest.json';
/** Its manifest id. */
export const OPENSUBTITLES_V3_ID = openSubtitles.id;

/**
 * Installed on first launch, all removable. Their manifests ship with the app
 * (Cinemeta and OpenSubtitles copied from github.com/Stremio/stremio-official-addons,
 * BannerTV Demo from services/demo), so Home can ask for catalogs at once; the
 * live manifests replace them on the first refresh.
 *
 * BannerTV Demo comes first: Home loads rows in addon order and its first row
 * fills the hero, so a new viewer starts on films that play.
 */
export const DEFAULT_ADDONS: readonly StoredAddon[] = [
  { transportUrl: BANNERTV_DEMO_URL, manifest: demo, official: true, fetchedAt: 0 },
  { transportUrl: CINEMETA_URL, manifest: cinemeta, official: true, fetchedAt: 0 },
  { transportUrl: OPENSUBTITLES_V3_URL, manifest: openSubtitles, official: true, fetchedAt: 0 },
];
