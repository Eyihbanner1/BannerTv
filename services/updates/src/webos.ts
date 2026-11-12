/**
 * The LG webOS app's updates, as the Worker serves them: a Homebrew Channel repository (an index
 * of one package, BannerTV) and the .ipk and icon it names, all from Workers KV. Homebrew Channel
 * (webosbrew/webos-homebrew-channel 0.7.3) fetches the index with the TV's web engine, so it
 * needs `access-control-allow-origin`, and downloads the .ipk in its own service, which installs
 * it only when the file's SHA-256 is the one the index gives (lower-case hex, compared exactly).
 * It never checks for an update by itself: its details page offers Update whenever the version
 * installed differs from the index's.
 *
 * The "Publish LG update" workflow writes the same keys (scripts/lib/webos.mjs); the round-trip
 * test checks the two agree. The index is stored as the exact text served, written last.
 */

/** The one channel published to for now: builds of main. */
export const WEBOS_CHANNEL = 'main';
/** The app the index lists, as appinfo.json names it. */
export const WEBOS_APP_ID = 'com.bannertv.app';

/** Fetched fresh every time, as the newest publish has to show as soon as it reaches KV. */
export const REPO_CACHE = 'no-cache';
/** An .ipk or icon is named by its SHA-256, so what an address names can never change. */
export const FILE_CACHE = 'public, max-age=31536000, immutable';

export const REPO_TYPE = 'application/json; charset=utf-8';
/** An .ipk is an ar archive, as a .deb is, with nothing that would open it in a browser. */
export const IPK_TYPE = 'application/octet-stream';
export const ICON_TYPE = 'image/png';

/** SHA-256 in lower-case hex, the form Homebrew Channel compares. */
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** What appinfo.json and LG take: major.minor.patch. */
const VERSION = /^\d+\.\d+\.\d+$/;

export const isSha256Hex = (value: string): boolean => SHA256_HEX.test(value);

// What is kept in KV, beside the phone's keys and never mixed with them.
export const repoKey = (channel: string): string => `webos/repo/${channel}`;
export const historyKey = (channel: string): string => `webos/history/${channel}`;
export const ipkKey = (sha256: string): string => `webos/ipk/${sha256}`;
export const iconKey = (sha256: string): string => `webos/icon/${sha256}`;

/** What /status says of the build an index offers. */
export interface WebosUpdate {
  version: string;
  sha256: string;
  ipkSize: number | null;
  commit: string | null;
  publishedAt: string | null;
  /** When a roll back made this build the one offered again, or null. */
  restoredAt: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * The build a stored index offers, or undefined when it offers none or cannot be read. Only for
 * /status: the index itself is served exactly as stored.
 */
export function readRepoIndex(stored: string | null): WebosUpdate | undefined {
  if (stored === null) return undefined;
  try {
    const value = JSON.parse(stored) as { packages?: unknown } | null;
    if (!Array.isArray(value?.packages)) return undefined;
    const entry = (value.packages as unknown[]).find(
      (item) => (item as { id?: unknown } | null)?.id === WEBOS_APP_ID,
    ) as Record<string, unknown> | undefined;
    const manifest = entry?.manifest as Record<string, unknown> | undefined;
    const version = manifest?.version;
    const sha256 = (manifest?.ipkHash as { sha256?: unknown } | undefined)?.sha256;
    if (typeof version !== 'string' || !VERSION.test(version)) return undefined;
    if (typeof sha256 !== 'string' || !isSha256Hex(sha256)) return undefined;
    const size = manifest?.ipkSize;
    return {
      version,
      sha256,
      ipkSize: typeof size === 'number' && Number.isInteger(size) && size > 0 ? size : null,
      commit: text(entry?.commit),
      publishedAt: text(entry?.publishedAt),
      restoredAt: text(entry?.restoredAt),
    };
  } catch {
    return undefined;
  }
}

// In-app updates (apps/webos/src/shell): the app's loader asks for the newest signed update for
// its channel and runtime version, and downloads the scripts it names by their SHA-256. The
// Worker serves the answer exactly as the workflow stored it: the TV checks the signature with
// the key in its own index.html, so nothing here is trusted.

/** The signed answer for one runtime version: an update's manifest, or a directive to go back. */
export const appKey = (channel: string, runtime: string): string =>
  `webos/app/${channel}/${runtime}`;
/** A script an update names, by its SHA-256. */
export const appFileKey = (sha256: string): string => `webos/file/${sha256}`;

/** What apps/webos/build/shell.ts names a runtime version: webos-<contract>-<16 hex digits>. */
const RUNTIME = /^webos-\d{1,4}-[0-9a-f]{16}$/;
export const isWebosRuntime = (value: string): boolean => RUNTIME.test(value);

/** The loader asks at most once a minute, and a publish must reach it on the next ask. */
export const APP_CACHE = 'no-store';
/** Read as bytes and checked against the manifest before the TV runs it: never a page's script. */
export const APP_FILE_TYPE = 'application/octet-stream';

/** What /status says of the answer stored for a runtime version. */
export interface WebosAppAnswer {
  /** update: a build to start; built-in: go back to the .ipk's own code. */
  type: 'update' | 'built-in';
  id: string | null;
  version: string | null;
  commit: string | null;
  createdAt: string | null;
  keyId: string | null;
}

/** The stored answer's outline, or undefined when there is none or it cannot be read. Only for /status. */
export function readAppAnswer(stored: string | null): WebosAppAnswer | undefined {
  if (stored === null) return undefined;
  try {
    const body = JSON.parse(stored) as Record<string, unknown> | null;
    const signed = typeof body?.manifest === 'string' ? body.manifest : body?.directive;
    if (typeof signed !== 'string') return undefined;
    const value = JSON.parse(signed) as Record<string, unknown> | null;
    const type =
      value?.type === 'bannertv-lg-update'
        ? 'update'
        : value?.type === 'bannertv-lg-built-in'
          ? 'built-in'
          : undefined;
    if (!type) return undefined;
    return {
      type,
      id: text(value?.id),
      version: text(value?.version),
      commit: text(value?.commit),
      createdAt: text(value?.createdAt),
      keyId: text(body?.keyid),
    };
  } catch {
    return undefined;
  }
}
