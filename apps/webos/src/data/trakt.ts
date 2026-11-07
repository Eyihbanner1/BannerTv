import {
  createDeviceSignIn,
  createStore,
  createTraktAccount,
  createTraktMarks,
  createTraktSync,
  type TraktMark,
  type TraktSyncResult,
} from '@bannertv/core';
import { serviceStatus, traktSend } from './api';
import { library, watchedSet } from './library';
import { progress } from './playback';
import { isKidsProfile, profilePrefix } from './profiles';
import { profileKv } from './storage';

/** A sync this long after launch, so it never competes with Home's first rows. */
const FIRST_SYNC_MS = 8000;
/** And again this often while BannerTV is on screen. */
const SYNC_EVERY_MS = 30 * 60 * 1000;
/** After the player closes, so what was just watched comes back as Trakt has it. */
const AFTER_PLAYBACK_MS = 5000;
/** My List's changes wait this long, so a quick add and remove send nothing. */
const PUSH_DELAY_MS = 3000;

/** The profile's Trakt sign-in. Kids profiles never sign in. */
export const traktAccount = createTraktAccount({ storage: profileKv, send: traktSend });

/** Sign-in with a code shown on the TV, for the Trakt screen. */
export const traktDevice = createDeviceSignIn({ send: traktSend, account: traktAccount });

/** Progress, watched ticks and My List, kept the same as the profile's Trakt account. */
export const traktSync = createTraktSync({
  account: traktAccount,
  storage: profileKv,
  targets: { progress, library, watched: watchedSet },
});

/** What the viewer marks watched, and takes off Continue Watching, told to Trakt too. */
export const traktMarks = createTraktMarks({ account: traktAccount });

/** Whether this profile can use Trakt: the service has its keys, and it is not a kids profile. */
export function traktAvailable(): boolean {
  return serviceStatus.get().trakt && !isKidsProfile();
}

export interface LastSync {
  result: TraktSyncResult;
  at: number;
}

/** The last sync's result, for the Trakt screen. */
export const lastSync = createStore<LastSync | null>(null);

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let lastRunAt = 0;
// A sync that came due behind another app, run once BannerTV is back.
let missed = false;

/** Syncs now, unless Trakt is not for this profile. Never rejects. */
export function syncTrakt(): Promise<TraktSyncResult> {
  clearTimeout(syncTimer);
  if (!traktAvailable() || traktAccount.get().status !== 'signedIn') {
    schedule(SYNC_EVERY_MS);
    return Promise.resolve('skipped');
  }
  lastRunAt = Date.now();
  return traktSync.run().then((result) => {
    if (result !== 'skipped') lastSync.set({ result, at: Date.now() });
    schedule(SYNC_EVERY_MS);
    return result;
  });
}

function schedule(ms: number) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    // Hidden behind another app: the sync waits until BannerTV is back.
    if (document.hidden) missed = true;
    else void syncTrakt();
  }, ms);
}

/** A sync shortly, as after the player closes. */
export function syncTraktSoon(): void {
  schedule(AFTER_PLAYBACK_MS);
}

/**
 * Puts what the viewer marked watched into Trakt's history, or takes it out,
 * when the profile is signed in there; a sync follows, so the ticks come back
 * as Trakt has them. Saved progress is what counts here either way.
 */
export function markOnTrakt(marks: readonly TraktMark[], watched: boolean): void {
  if (!traktAvailable() || traktAccount.get().status !== 'signedIn') return;
  void traktMarks.history(marks, watched).then((ok) => {
    if (ok) syncTraktSoon();
  });
}

/** Takes a title off Trakt's paused list too, when the profile is signed in there. */
export function forgetPausedOnTrakt(metaId: string, type: string): void {
  if (!traktAvailable() || traktAccount.get().status !== 'signedIn') return;
  void traktMarks.forgetPaused(metaId, type);
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

function pushLibrarySoon() {
  if (!traktAvailable() || traktAccount.get().status !== 'signedIn') return;
  if (library.outbox().length === 0) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void traktSync.pushLibrary(), PUSH_DELAY_MS);
}

/**
 * Starts Trakt for the profile once someone is chosen: a sync soon after
 * launch, then every half hour while BannerTV is on screen, on coming back
 * after that long behind another app, and My List's changes as they happen.
 */
export function startTrakt(): void {
  void profilePrefix.then(async () => {
    if (isKidsProfile()) return;
    await traktAccount.load();
    library.subscribe(pushLibrarySoon);
    // Signing in on the Trakt screen brings everything in at once.
    let signedIn = traktAccount.get().status === 'signedIn';
    traktAccount.subscribe(() => {
      const now = traktAccount.get().status === 'signedIn';
      if (now && !signedIn) void syncTrakt();
      if (!now) lastSync.set(null);
      signedIn = now;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !(missed || Date.now() - lastRunAt >= SYNC_EVERY_MS)) return;
      missed = false;
      schedule(FIRST_SYNC_MS);
    });
    schedule(FIRST_SYNC_MS);
  });
}
