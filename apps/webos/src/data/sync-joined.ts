import type { KeyValueStore, Timers } from '@bannertv/core';
import { secureRandom } from '../platform/web-crypto';
import type { SavedProfiles } from './profiles';

/**
 * A join's reload (ADR 0006). Joining writes the profiles and the changes
 * held for the next launch to localStorage, sets the signed-in flag, and
 * starts the app again. A localStorage write made just before a reload can
 * be missing after it (Chromium hands them over in batches), and a profile
 * Use took away would then stay, one the account never knew. So the join
 * keeps a copy in IndexedDB, and the next launch puts back what it did not
 * read before dropping the copy.
 *
 * Only that launch: the copy carries a token the join also leaves in
 * window.name, which a reload keeps and closing the app does not. A copy
 * any other launch finds, left by one that could not read it, is dropped
 * unread: the profiles have been the person's to change since.
 */
export const JOINED_KEY = 'sync-joined';

/** How the token is named in window.name, which is no storage write a reload can miss. */
const NAME_PREFIX = 'bannertv.joined:';
/** A failed read is tried again this many times, a quarter of a second apart, as the engine's are. */
const READ_RETRIES = 3;
const READ_RETRY_MS = 250;

interface Joined extends SavedProfiles {
  /** The launch the copy is for: the one whose window.name has it. */
  token: string;
  /** The app already started again once to read it. */
  again?: true;
}

const text = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function readJoined(value: unknown): Joined | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { profiles, held, token, again } = value as Record<string, unknown>;
  if (!text(profiles) || !text(held) || typeof token !== 'string') return undefined;
  return again === true ? { profiles, held, token, again } : { profiles, held, token };
}

/** Leaves the token for the launch after this one. */
function leaveToken(token: string): void {
  try {
    window.name = NAME_PREFIX + token;
  } catch {
    // That launch then drops the copy unread: most often the reload reads everything anyway.
  }
}

/** The token a join left for this launch, taken so that no later launch of this run finds it. */
function takeToken(): string | undefined {
  try {
    const name = window.name;
    if (typeof name !== 'string' || name.indexOf(NAME_PREFIX) !== 0) return undefined;
    window.name = '';
    return name.slice(NAME_PREFIX.length);
  } catch {
    return undefined;
  }
}

/** Reads the copy, trying a failed read again a few times, `timers` apart. */
async function readCopy(kv: KeyValueStore, timers?: Timers): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await kv.get(JOINED_KEY);
    } catch (error) {
      if (attempt === READ_RETRIES) throw error;
      if (timers) await new Promise<void>((resolve) => timers.after(READ_RETRY_MS, resolve));
    }
  }
}

async function dropCopy(kv: KeyValueStore): Promise<void> {
  try {
    if (kv.delete) await kv.delete(JOINED_KEY);
    else await kv.set(JOINED_KEY, null);
  } catch {
    // IndexedDB has just read it, so this is not expected; the next launch would drop it unread.
  }
}

/**
 * Keeps what the join left in localStorage, just before the app starts
 * again. `saved` is read again after the copy is written, in case a sync
 * changed the profiles meanwhile.
 */
export async function markJoined(kv: KeyValueStore, saved: () => SavedProfiles): Promise<void> {
  const token = Date.now().toString(36) + secureRandom().toString(36).slice(2, 8);
  leaveToken(token);
  let kept: SavedProfiles | undefined;
  for (let tries = 0; tries < 3; tries++) {
    const now = saved();
    if (kept && kept.profiles === now.profiles && kept.held === now.held) return;
    kept = now;
    await kv.set(JOINED_KEY, { profiles: now.profiles, held: now.held, token });
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
  /** Waits between reads of the copy tried again. */
  timers?: Timers;
}

/**
 * At launch, before anything else uses the profiles: after a join's reload,
 * what the join wrote and this launch did not read is put back, and the
 * copy is dropped. Where the profiles had to be put back after the first
 * paint, the app starts again once, the copy kept until a launch reads it,
 * and this resolves false. A second time, they are put back in place. A
 * copy left from an earlier launch is only dropped.
 */
export async function settleJoined(options: JoinedLaunch): Promise<boolean> {
  const { kv, launch } = options;
  // Taken at once: whatever happens next, a later launch is no longer the join's.
  const token = takeToken();
  let saved: unknown;
  try {
    saved = await readCopy(kv, options.timers);
  } catch {
    // Unread even when tried again: the next launch finds it is not its own, and drops it.
    return true;
  }
  const joined = readJoined(saved);
  if (!joined || joined.token !== token) {
    if (saved !== undefined && saved !== null) await dropCopy(kv);
    return true;
  }
  options.signIn();
  const stale = joined.profiles !== launch.profiles || joined.held !== launch.held;
  if (stale && !joined.again) {
    try {
      await kv.set(JOINED_KEY, {
        profiles: joined.profiles,
        held: joined.held,
        token: joined.token,
        again: true,
      });
      leaveToken(joined.token);
      options.restore(joined, false);
      options.reload();
      return false;
    } catch {
      // Without the copy kept, starting again could lose them once more: in place, then.
    }
  }
  if (stale) options.restore(joined, true);
  await dropCopy(kv);
  return true;
}
