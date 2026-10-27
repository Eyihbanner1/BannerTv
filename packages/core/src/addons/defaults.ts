import cinemeta from './cinemeta.manifest.json';
import openSubtitles from './opensubtitles-v3.manifest.json';
import type { StoredAddon } from './collection';

export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
export const OPENSUBTITLES_V3_URL = 'https://opensubtitles-v3.strem.io/manifest.json';

/**
 * Installed on first launch, both removable. Their manifests ship with the app
 * (copied from github.com/Stremio/stremio-official-addons), so Home can ask
 * for catalogs at once; the live manifests replace them on the first refresh.
 */
export const DEFAULT_ADDONS: readonly StoredAddon[] = [
  { transportUrl: CINEMETA_URL, manifest: cinemeta, official: true, fetchedAt: 0 },
  { transportUrl: OPENSUBTITLES_V3_URL, manifest: openSubtitles, official: true, fetchedAt: 0 },
];
