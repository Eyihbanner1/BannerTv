/*
 * Updates for a sideloaded LG build through Homebrew Channel (webosbrew), on a
 * TV that has it (docs/TV_SETUP.md, Updates through Homebrew Channel). The
 * updates Worker (services/updates) serves BannerTV's own Homebrew Channel
 * repository: a list with at most one entry, the newest build of main, whose
 * .ipk Homebrew Channel downloads, checks against its SHA-256 and installs over
 * this one. Homebrew Channel never looks for updates by itself, so Settings
 * reads the same list, says when it has a newer build, and opens Homebrew
 * Channel. Signed updates inside the app are separate work, still to come.
 */
import { createStore, type FetchJson } from '@bannertv/core';
import { HOMEBREW_UPDATES_IN_BUILD } from '../app/features';
import { isAndroid } from '../platform/android';
import { isWebOS, lunaCall } from '../platform/webos';
import { HOMEBREW_CHANNEL_ID, HOMEBREW_REPO_URL } from './homebrew-repo';

export { HOMEBREW_CHANNEL_ID, HOMEBREW_REPO_URL };

/** The list is a few hundred bytes. After this long Settings stops waiting and says nothing. */
export const REPO_TIMEOUT_MS = 8000;

/**
 * Whether Settings offers updates through Homebrew Channel: only on an LG TV,
 * and only in a build that allows it. The Android app shows this same page in
 * a WebView, and the development build runs it in a browser; neither has
 * Homebrew Channel, so neither shows it or asks the Worker anything.
 */
export function homebrewUpdatesShown(): boolean {
  return HOMEBREW_UPDATES_IN_BUILD && isWebOS() && !isAndroid();
}

/** What the list says, next to the build this TV runs. */
export type RepoNews =
  /** The list has a newer build. */
  | { kind: 'ready'; version: string }
  /** The list has this very build. */
  | { kind: 'latest' }
  /** The list has an older build, as it can when a newer one was installed by hand. */
  | { kind: 'older'; version: string }
  /**
   * Nothing to say: nothing published yet, no BannerTV in the list, an
   * answer out of form, an error status, or no answer at all.
   */
  | { kind: 'none' };

const NONE: RepoNews = { kind: 'none' };

// LG takes strictly major.minor.patch (tools/scripts/check-version.mjs), so
// anything else in the list is out of form, leading zeros included.
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/** A major.minor.patch version as three numbers, or null for anything else. */
export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = VERSION.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Below 0 when `a` is older than `b`, 0 when they are the same and above 0
 * when `a` is newer, part by part as numbers (0.10.0 is newer than 0.9.0).
 * Null when either is out of form.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let part = 0; part < 3; part++) {
    if (left[part] !== right[part]) return left[part]! - right[part]!;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The version of `appId` in a Homebrew Channel list, as the manifest in its
 * entry gives it, or null. Lenient as Homebrew Channel is, which takes any
 * JSON with a `packages` array: other entries and fields are passed over, and
 * the first entry with the id decides. An entry with only a manifestUrl, a
 * manifest without a version or a version out of form counts as none.
 */
export function repoVersion(index: unknown, appId: string): string | null {
  if (!isRecord(index) || !Array.isArray(index.packages)) return null;
  for (const entry of index.packages as unknown[]) {
    if (!isRecord(entry) || entry.id !== appId) continue;
    const manifest = entry.manifest;
    if (!isRecord(manifest)) return null;
    const version = manifest.version;
    return typeof version === 'string' && parseVersion(version) ? version : null;
  }
  return null;
}

/** What the list `index` says about `appId` next to `installed`, the version this TV runs. */
export function repoNews(index: unknown, appId: string, installed: string): RepoNews {
  const version = repoVersion(index, appId);
  const order = version === null ? null : compareVersions(version, installed);
  if (version === null || order === null) return NONE;
  if (order > 0) return { kind: 'ready', version };
  if (order < 0) return { kind: 'older', version };
  return { kind: 'latest' };
}

/**
 * Reads the list once and says what it has next to `installed`. `fetchJson`
 * (platform/http.ts) sends a plain GET without credentials or headers of its
 * own, so a TV running from file:// sends no preflight; the Worker answers
 * with Access-Control-Allow-Origin: * and Cache-Control: no-cache, so a stale
 * copy is never shown. Never rejects: an error status, an answer out of form
 * or no answer within the timeout all come back as 'none'.
 */
export function checkHomebrewRepo(
  fetchJson: FetchJson,
  appId: string,
  installed: string,
  timeoutMs = REPO_TIMEOUT_MS,
): Promise<RepoNews> {
  return fetchJson(HOMEBREW_REPO_URL, { timeoutMs }).then(
    (index) => repoNews(index, appId, installed),
    () => NONE,
  );
}

// A one-bit flag read as Settings draws, so it lives in localStorage.
export const LIST_SENT_KEY = 'bannertv.homebrewListSent';

function readListSent(): boolean {
  try {
    return localStorage.getItem(LIST_SENT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether Homebrew Channel has opened from this TV on its Add repository
 * dialog with BannerTV's list filled in. Homebrew Channel keeps its
 * repositories to itself, and adds a second copy of one it has already if the
 * dialog is confirmed again, so from then on Settings opens it on its apps
 * and fills in the dialog again only when asked to.
 */
export const homebrewListSent = createStore<boolean>(readListSent());

function markListSent(): void {
  try {
    localStorage.setItem(LIST_SENT_KEY, '1');
  } catch {
    // Without storage the next press fills in the dialog again, which the person can close.
  }
  homebrewListSent.set(true);
}

/**
 * How to open Homebrew Channel: 'add-list' opens it on its Add repository
 * dialog with BannerTV's list filled in, for the person to confirm (its
 * launchMode addRepository); 'open' opens it on its list of apps, where
 * BannerTV is once its list has been added.
 */
export type HomebrewOpen = 'add-list' | 'open';

/**
 * Opens Homebrew Channel through the TV's application manager. Rejects when
 * it does not open, which is how a TV without it answers.
 */
export async function openHomebrewChannel(how: HomebrewOpen): Promise<void> {
  await lunaCall(
    'luna://com.webos.applicationManager/launch',
    how === 'add-list'
      ? {
          id: HOMEBREW_CHANNEL_ID,
          params: { launchMode: 'addRepository', url: HOMEBREW_REPO_URL },
        }
      : { id: HOMEBREW_CHANNEL_ID },
  );
  if (how === 'add-list') markListSent();
}
