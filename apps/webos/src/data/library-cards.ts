import { HISTORY_LIMIT, isUnmarked, type PlayedVideo, playedCard } from '@bannertv/core';
import type { ContentType, MetaDetail } from '@bannertv/protocol';
import { addonClient } from './addons';
import { library } from './library';
import { playedVideos, progress } from './playback';

/** Meta requests the Library keeps going at once, so Home and Search still get the limiter. */
const AT_ONCE = 2;

interface Wanted {
  /** Says what the answer is for: `list:<id>` or `history:<videoId>`. */
  key: string;
  type: ContentType;
  metaId: string;
  take: (meta: MetaDetail) => void;
}

// Asked for this session, answered or not: a title whose meta fails is not asked for again.
const asked = new Set<string>();
const queue: Wanted[] = [];
let running = 0;
// The Library screens open and showing, so filling stops when the last one closes.
let watchers = 0;

// History cards made this session for progress that came from Trakt alone. They are
// kept in memory, not with the played cards: those hold Continue Watching's titles,
// at most 200, and a long Trakt history would push them out.
const sessionCards = new Map<string, PlayedVideo>();
const cardListeners = new Set<() => void>();
let cardChanges = 0;

function next(): void {
  while (watchers > 0 && running < AT_ONCE && queue.length > 0) {
    const wanted = queue.shift()!;
    running += 1;
    const query = addonClient.meta(wanted.type, wanted.metaId);
    let settled = false;
    const done = () => {
      if (settled) return;
      const state = query.get();
      if (state.status === 'idle' || state.status === 'loading') return;
      // A cached copy shown while a fresh one is fetched: the cached one has the artwork.
      settled = true;
      unsubscribe();
      running -= 1;
      if (state.data) wanted.take(state.data);
      next();
    };
    const unsubscribe = query.subscribe(done);
    query.load();
    done();
  }
}

function want(wanted: Wanted): void {
  if (asked.has(wanted.key)) return;
  asked.add(wanted.key);
  queue.push(wanted);
}

/**
 * Titles that came from Trakt's watchlist land in My List with a name and
 * year only. This asks the meta addon once a session for each saved title
 * with no poster, newest first, and saves the artwork it answers with, as
 * opening the title's page does.
 */
function wantListArtwork(): void {
  for (const item of library.items()) {
    if (item.poster) continue;
    want({
      key: `list:${item.id}`,
      type: item.type,
      metaId: item.id,
      take: (meta) => {
        // Taken off the list meanwhile: nothing to fill in.
        if (library.has(item.id)) void library.refresh({ ...meta, id: item.id });
      },
    });
  }
}

/**
 * History shows a title by the card saved when it played, so progress that
 * came from Trakt alone has none. This asks the meta addon once a session for
 * each such title History would list, most recent first, and keeps the card
 * for this session (see sessionCards).
 */
function wantHistoryCards(): void {
  const seen = new Set<string>();
  for (const entry of progress.recent()) {
    if (seen.size >= HISTORY_LIMIT) break;
    // Marked not watched: History passes over it, as historyView does.
    if (isUnmarked(entry) || seen.has(entry.metaId)) continue;
    seen.add(entry.metaId);
    if (playedVideos.get(entry.videoId) || sessionCards.has(entry.videoId)) continue;
    // Kept only to resume, as a sports replay is: only the addon that listed it may be asked.
    if (entry.continueRow === false) continue;
    const { videoId, metaId, type } = entry;
    want({
      key: `history:${videoId}`,
      type,
      metaId,
      take: (meta) => {
        if (playedVideos.get(videoId)) return;
        sessionCards.set(videoId, {
          ...playedCard(meta, videoId, meta, { metaId, type }),
          updatedAt: 0,
        });
        cardChanges += 1;
        cardListeners.forEach((listener) => listener());
      },
    });
  }
}

/**
 * While a Library screen shows My List or History, quietly fills in the
 * artwork its titles are missing. Returns a stop for when the screen closes
 * or switches: requests already running finish, the rest wait for the next
 * time and are asked for then.
 */
export function fillLibraryCards(show: 'list' | 'history'): () => void {
  watchers += 1;
  if (show === 'list') wantListArtwork();
  else wantHistoryCards();
  next();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    watchers -= 1;
    if (watchers > 0) return;
    // Not started: asked for again next time.
    for (const wanted of queue.splice(0)) asked.delete(wanted.key);
  };
}

/** A History tile's card: the one saved when the video played, else one made this session. */
export function historyCard(videoId: string): PlayedVideo | undefined {
  return playedVideos.get(videoId) ?? sessionCards.get(videoId);
}

/** Bumps as History cards are made, for the screens that list them. */
export function historyCardsVersion(): number {
  return cardChanges;
}

export function subscribeHistoryCards(listener: () => void): () => void {
  cardListeners.add(listener);
  return () => {
    cardListeners.delete(listener);
  };
}
