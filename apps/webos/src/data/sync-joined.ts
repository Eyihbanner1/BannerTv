import type { KeyValueStore } from '@bannertv/core';
import type { SavedProfiles } from './profiles';

/**
 * A join's reload (ADR 0006). Joining writes the profiles and the changes
 * held for the next launch to localStorage, sets the signed-in flag, and
 * starts the app again. A localStorage write made just before a reload can
 * be missing after it (Chromium hands them over in batches), and a profile
 * Use took away would then stay, one the account never knew. So the join
 * keeps a copy in IndexedDB, and the next launch puts back what it did not
 * read before dropping the copy.
 */
export const JOINED_KEY = 'sync-joined';

interface Joined extends SavedProfiles {
  /** The app already started again once to read it. */
  again?: true;
}

const text = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function readJoined(value: unknown): Joined | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { profiles, held, again } = value as Record<string, unknown>;
  if (!text(profiles) || !text(held)) return undefined;
  return again === true ? { profiles, held, again } : { profiles, held };
}

/**
 * Keeps what the join left in localStorage, just before the app starts
 * again. `saved` is read again after the copy is written, in case a sync
 * changed the profiles meanwhile.
 */
export async function markJoined(kv: KeyValueStore, saved: () => SavedProfiles): Promise<void> {
  let kept: SavedProfiles | undefined;
  for (let tries = 0; tries < 3; tries++) {
    const now = saved();
    if (kept && kept.profiles === now.profiles && kept.held === now.held) return;
    kept = now;
    await kv.set(JOINED_KEY, { profiles: now.profiles, held: now.held });
  }
}

export interface JoinedLaunch {
  kv: KeyValueStore;
  /** What this launch read before its first paint. */
  launch: SavedProfiles;
  /** Writes the join's copy back: into the profiles at once (`now`), or into localStorage only. */
  restore(saved: SavedProfiles, now: boolean): void;
  /** The join made this screen one of the account's: the flag it set. */
  signIn(): void;
  reload(): void;
}

/**
 * At launch, before anything else uses the profiles: after a join's reload,
 * what the join wrote and this launch did not read is put back, and the
 * copy is dropped. Where the profiles had to be put back after the first
 * paint, the app starts again once, the copy kept until a launch reads it,
 * and this resolves false. A second time, they are put back in place.
 */
export async function settleJoined(options: JoinedLaunch): Promise<boolean> {
  const { kv, launch } = options;
  let joined: Joined | undefined;
  try {
    joined = readJoined(await kv.get(JOINED_KEY));
  } catch {
    // Read at the next launch, then.
    return true;
  }
  if (!joined) return true;
  options.signIn();
  const stale = joined.profiles !== launch.profiles || joined.held !== launch.held;
  if (stale && !joined.again) {
    try {
      await kv.set(JOINED_KEY, { profiles: joined.profiles, held: joined.held, again: true });
      options.restore(joined, false);
      options.reload();
      return false;
    } catch {
      // Without the copy kept, starting again could lose them once more: in place, then.
    }
  }
  if (stale) options.restore(joined, true);
  try {
    if (kv.delete) await kv.delete(JOINED_KEY);
    else await kv.set(JOINED_KEY, null);
  } catch {
    // IndexedDB has just read it, so this is not expected; the next launch would put it back.
  }
  return true;
}
