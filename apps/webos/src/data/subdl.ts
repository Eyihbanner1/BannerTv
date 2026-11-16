import {
  cleanSubdlKey,
  createPersisted,
  createSubdlClient,
  createSubdlUsage,
  type Persisted,
  readSubdlKey,
  SUBDL_DOWNLOADS,
  type SubdlClient,
  type SubdlKeyRecord,
  type SubdlUsage,
} from '@bannertv/core';
import { requestJson } from '../platform/http';
import { queryCache, runForPlay } from './addons';
import { isKidsProfile } from './profiles';
import { profileKv, storage } from './storage';

/**
 * SubDL, a second source of subtitle files, with the viewer's own free key
 * (ADR 0003, step D). The key is the profile's, and follows the BannerTV
 * account like the profile's settings (ADR 0006); it is never shown once
 * saved, never logged, and sent to SubDL's API only, never with a download.
 * How much this screen asked today, and any rest SubDL asked for, are the
 * screen's.
 */

/** The profile's key and whether SubDL took it. */
export const subdlKey: Persisted<SubdlKeyRecord | null> = createPersisted({
  storage: profileKv,
  key: 'subdl/key',
  initial: null,
  read: readSubdlKey,
});

/** Today's searches and downloads on this screen, and the rest SubDL asked for. */
export const subdlUsage: SubdlUsage = createSubdlUsage({ storage: storage.kv });

void subdlKey.load();
void subdlUsage.load();

export const subdl: SubdlClient = createSubdlClient({
  http: requestJson,
  queries: queryCache,
  usage: subdlUsage,
  key: () => subdlKey.get(),
  ready: () => subdlKey.load(),
  // The key a search was sent with may have been replaced while it was out.
  setKeyState: (key, state) => setSubdlKeyState(key, state),
  kidsOnly: isKidsProfile,
  run: runForPlay,
});

/** Saves a key typed or pasted, not yet tried: 'bad' when it cannot be a SubDL key. */
export function saveSubdlKey(text: string): 'saved' | 'bad' {
  const key = cleanSubdlKey(text);
  if (key === null) return 'bad';
  void subdlKey.updateNow(() => ({ key, state: 'unchecked' }));
  return 'saved';
}

/** What SubDL said of the key saved, if it is still the one saved. */
export function setSubdlKeyState(key: string, state: SubdlKeyRecord['state']): void {
  void subdlKey.updateNow((record) =>
    record && record.key === key && record.state !== state ? { key, state } : record,
  );
}

export function removeSubdlKey(): void {
  void subdlKey.updateNow(() => null);
}

/** A file on SubDL's download host, which counts against the day's downloads. */
export function isSubdlDownload(url: string): boolean {
  return url.startsWith(SUBDL_DOWNLOADS + '/');
}

/** Where the viewer gets a key: SubDL's API page (to confirm with a real account). */
export const SUBDL_KEY_PAGE = 'https://subdl.com/api-doc';
