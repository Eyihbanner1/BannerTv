import {
  CONTINUE_LIMIT,
  continueItem,
  type PlayedVideo,
  playedCard,
  type ProgressEntry,
} from '@bannertv/core';
import { addonClient } from './addons';
import { playedVideos, progress } from './playback';

// Titles already asked for this session, so a meta that fails is not asked for on every visit.
const asked = new Set<string>();
// What the last pass saw, so showing Home again with nothing new costs nothing.
let lastPass = '';
// A card saved during a pass makes the pass run again once it ends, not inside itself.
let filling = false;

/**
 * Progress saved before Continue Watching existed has no card with the
 * title's name and artwork, and a series card saved before its episode list
 * arrived has no episode. This asks the meta addon once a session for each
 * such title the row could show, and saves a card when it answers. It walks
 * history as far as the row does: only titles that can take a place count
 * towards the row's limit.
 */
export function fillPlayedCards(): void {
  if (filling) return;
  filling = true;
  try {
    for (;;) {
      const pass = `${progress.version()}:${playedVideos.version()}`;
      if (pass === lastPass) return;
      lastPass = pass;
      walk();
    }
  } finally {
    filling = false;
  }
}

/** Whether a title the row could show has no card yet, so its tile is still to come. */
export function cardsMissing(): boolean {
  let missing = false;
  eachWithoutCard(() => (missing = true));
  return missing;
}

function walk(): void {
  eachWithoutCard((entry, card) => {
    if (asked.has(entry.metaId)) return;
    asked.add(entry.metaId);
    const query = addonClient.meta(entry.type, entry.metaId);
    const done = () => {
      const state = query.get();
      if (state.status === 'idle' || state.status === 'loading') return;
      // A cached copy shown while a fresh one is fetched: wait for the fresh one.
      if (state.stale && !state.error) return;
      unsubscribe();
      // An error with nothing cached: the title stays as it is this session.
      const meta = state.data;
      if (!meta) return;
      // Recorded meanwhile by the player, which knows better.
      const latest = playedVideos.get(entry.videoId);
      if (latest && latest !== card) return;
      playedVideos.record(
        playedCard(meta, entry.videoId, meta, { metaId: entry.metaId, type: entry.type }),
      );
    };
    const unsubscribe = query.subscribe(done);
    query.load();
    done();
  });
}

/**
 * Walks history as far as the row reaches, handing on each title the row
 * could show that has no usable card. Only titles that can take a place count
 * towards the row's limit, and one with no card yet may well take one.
 */
function eachWithoutCard(
  missing: (entry: ProgressEntry, card: PlayedVideo | undefined) => void,
): void {
  const now = Date.now();
  const seen = new Set<string>();
  let places = 0;
  for (const entry of progress.recent()) {
    if (places >= CONTINUE_LIMIT) break;
    if (seen.has(entry.metaId)) continue;
    seen.add(entry.metaId);
    // A film with nothing left to resume is never on the row, so needs no card;
    // nor is a video of unknown length, such as a live broadcast.
    if (entry.duration <= 0) continue;
    if (entry.type === 'movie' && progress.resumeAt(entry.videoId) === undefined) continue;
    const card = playedVideos.get(entry.videoId);
    if (card && (card.type === 'movie' || card.episode !== undefined)) {
      if (continueItem(entry, card, progress, now)) places += 1;
      continue;
    }
    places += 1;
    missing(entry, card);
  }
}
