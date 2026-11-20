import demo from './bannertv-demo.manifest.json';
import cinemeta from './cinemeta.manifest.json';
import openSubtitles from './opensubtitles-v3.manifest.json';
import type { StoredAddon } from './collection';

export const BANNERTV_DEMO_URL = 'https://demo.bannertv.workers.dev/manifest.json';
/** Its manifest as the app ships it (services/demo checks the Worker still sends it). */
export const BANNERTV_DEMO_MANIFEST: unknown = demo;
/** Its manifest id, which stream entries carry as `addonId`. */
export const BANNERTV_DEMO_ID = demo.id;
export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
export const OPENSUBTITLES_V3_URL = 'https://opensubtitles-v3.strem.io/manifest.json';
/** Its manifest id. */
export const OPENSUBTITLES_V3_ID = openSubtitles.id;
/**
 * Subtitles addons that match files by the video's hash: asked again when the
 * hash is read after they were asked without it. Other addons were sent the
 * file name already, and no manifest says an addon uses the hash.
 */
export const HASH_MATCHING_ADDON_IDS: ReadonlySet<string> = new Set([OPENSUBTITLES_V3_ID]);

/**
 * Installed on first launch, all removable. Their manifests ship with the app
 * (copied from github.com/Stremio/stremio-official-addons), so Home can ask
 * for catalogs at once; the live manifests replace them on the first refresh.
 */
export const DEFAULT_ADDONS: readonly StoredAddon[] = [
  { transportUrl: CINEMETA_URL, manifest: cinemeta, official: true, fetchedAt: 0 },
  { transportUrl: OPENSUBTITLES_V3_URL, manifest: openSubtitles, official: true, fetchedAt: 0 },
];

/**
 * Addons earlier builds installed on first launch and this one takes away
 * (createAddonCollection's `retired`). BannerTV Demo, the Blender open movies,
 * is no longer installed for anyone; a viewer can still add it by its address.
 */
export const RETIRED_DEFAULT_ADDONS: readonly string[] = [BANNERTV_DEMO_URL];
