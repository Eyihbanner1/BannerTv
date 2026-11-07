import {
  cardNext,
  caughtUpSeries,
  CONTINUE_LIMIT,
  continueItem,
  isUnmarked,
  type PlayedVideo,
  playedCard,
  type ProgressEntry,
} from '@bannertv/core';
import type { MetaDetail } from '@bannertv/protocol';
import { addonClient } from './addons';
import { playedVideos, progress } from './playback';

// Titles already asked for this session, so a meta that fails is not asked for on every visit.
const asked = new Set<string>();
// Titles asked for whose answer has not come yet.
const waiting = new Set<string>();
const settledListeners = new Set<() => void>();
// What the last pass saw, so showing Home again with nothing new costs nothing.
let lastPass = '';
// A card saved during a pass makes the pass run again once it ends, not inside itself.
let filling = false;
/** A series the viewer is caught up on is looked at again this often, for a new episode. */
const RECHECK_MS = 24 * 60 * 60 * 1000;
// When each caught-up series was last looked at, this session.
const rechecked = new Map<string, number>();

/**
 * Progress saved before Continue Watching existed has no card with the
 * title's name and artwork, and a series card saved before its episode list
 * arrived has no episode. This asks the meta addon once a session for each
 * such title the row could show, and saves a card when it answers. It walks
 * history as far as the row does: only titles that can take a place count
 * towards the row's limit.
 *
 * It also looks again, once a day, at the series the viewer is caught up on
 * (caughtUpSeries): when the addon now lists an episode after the last one
 * watched, the card learns of it, and the series comes back to the row once
 * that episode airs. The meta is the cached one the calendar and Details read.
 */
export function fillPlayedCards(): void {
  if (filling) return;
  filling = true;
  try {
    for (;;) {
      const day = Math.floor(Date.now() / RECHECK_MS);
      const pass = `${progress.version()}:${playedVideos.version()}:${day}`;
      if (pass === lastPass) return;
      lastPass = pass;
      walk();
      recheckCaughtUp();
    }
  } finally {
    filling = false;
  }
}

/**
 * Whether a title the row could show has no card yet and may still get one:
 * it is still to be asked for, or its answer has not come. A title whose
 * answer came without a card stays as it is this session.
 */
export function cardsMissing(): boolean {
  let missing = false;
  eachWithoutCard((entry) => {
    if (!asked.has(entry.metaId) || waiting.has(entry.metaId)) missing = true;
  });
  return missing;
}

/** Tells `listener` each time an answer comes, card or not. */
export function onCardAnswer(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

function walk(): void {
  eachWithoutCard((entry, card) => {
    if (asked.has(entry.metaId)) return;
    asked.add(entry.metaId);
    waiting.add(entry.metaId);
    // The card made from this answer knows what comes next as of now: no second look today.
    rechecked.set(entry.metaId, Date.now());
    const query = addonClient.meta(entry.type, entry.metaId);
    const save = (meta: MetaDetail | undefined) => {
      // An error with nothing cached: the title stays as it is this session.
      if (!meta) return;
      // Recorded meanwhile by the player, which knows better.
      const latest = playedVideos.get(entry.videoId);
      if (latest && latest !== card) return;
      // Filled in here, not played: the account never takes it as an edit (ADR 0006, decision 4).
      playedVideos.record(
        playedCard(meta, entry.videoId, meta, { metaId: entry.metaId, type: entry.type }),
        { filled: true },
      );
    };
    const done = () => {
      const state = query.get();
      if (state.status === 'idle' || state.status === 'loading') return;
      // A cached copy shown while a fresh one is fetched: wait for the fresh one.
      if (state.stale && !state.error) return;
      unsubscribe();
      waiting.delete(entry.metaId);
      save(state.data);
      settledListeners.forEach((listener) => listener());
    };
    const unsubscribe = query.subscribe(done);
    query.load();
    done();
  });
}

function recheckCaughtUp(): void {
  const now = Date.now();
  for (const { entry, card } of caughtUpSeries(progress, playedVideos.get)) {
    const last = rechecked.get(entry.metaId);
    if (last !== undefined && now - last < RECHECK_MS) continue;
    rechecked.set(entry.metaId, now);
    const query = addonClient.meta(entry.type, entry.metaId);
    const done = () => {
      const state = query.get();
      if (state.status === 'idle' || state.status === 'loading') return;
      if (state.stale && !state.error) return;
      unsubscribe();
      const next = state.data && cardNext(state.data, entry.videoId);
      // Nothing new yet, or the player saved the card meanwhile and knows better.
      if (!next || playedVideos.get(entry.videoId) !== card) return;
      // record() gives it a new time and keeps a filled card filled only when told.
      playedVideos.record({ ...card, next }, { filled: card.filled === true });
    };
    const unsubscribe = query.subscribe(done);
    query.load();
    done();
  }
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
    // Marked not watched: the row passes over it, as continueWatching does.
    if (isUnmarked(entry) || seen.has(entry.metaId)) continue;
    seen.add(entry.metaId);
    // Kept only to resume, as a sports replay is: never on the row, so no addon is asked
    // for its page. A fan-out would ask addons that never listed it.
    if (entry.continueRow === false) continue;
    // A film with nothing left to resume is never on the row, so needs no card;
    // nor is a video of unknown length, such as a live broadcast, unless it was
    // marked watched: an episode marked so offers the next one.
    if (entry.duration <= 0 && !entry.watched) continue;
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
