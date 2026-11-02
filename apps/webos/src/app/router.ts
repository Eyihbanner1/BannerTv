import { type BingeHint, createStore, type SportEvent, type StreamEntry } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { currentlyPressed } from '../navigation/focus-memory';

/** Top-level destinations in the rail. Some show only some of the time: see sections.ts. */
export const SECTIONS = [
  'home',
  'search',
  'discover',
  'sports',
  'library',
  'addons',
  'settings',
] as const;
export type Section = (typeof SECTIONS)[number];

/**
 * A sports event to play: streams come only from the addons that listed it,
 * one request per source (docs/PLAN.md, Sports addons, Play and playback).
 */
export interface EventPlay {
  /** The event's key, which with its sources' installs names its stream finder. */
  key: string;
  sources: SportEvent['sources'];
  /**
   * A replay or full match on demand, which keeps its place to resume like
   * any other video. A match, live or still to come, saves nothing.
   */
  replay: boolean;
}

/** How the event page hands an event to the player and All streams. */
export function eventPlay(event: Pick<SportEvent, 'key' | 'sources' | 'kind'>): EventPlay {
  return { key: event.key, sources: event.sources, replay: event.kind === 'replay' };
}

/**
 * Whether playback keeps its place to resume, and what it learns about
 * addons and the connection. Never for the Lab's test streams, nor for a
 * sports match, whose broadcast has no place to come back to; a sports
 * replay does, like any other video (docs/PLAN.md, Play and playback).
 */
export function remembersPlace(route: { lab?: boolean; event?: EventPlay }): boolean {
  if (route.lab) return false;
  return !route.event || route.event.replay;
}

export type Route =
  | { name: Section }
  /** `preview` is what the tile already knew, drawn while the full meta loads. */
  | { name: 'details'; type: string; id: string; preview?: MetaPreview }
  /** One sports event, as the Sports screen had it when it was opened. */
  | { name: 'event'; event: SportEvent }
  /** "See all" from a Home row: Discover, opened on that row's catalog and genre. */
  | { name: 'catalog'; transportUrl: string; type: string; catalogId: string; genre?: string }
  /**
   * Plays one video. Without `stream` the player picks the best working
   * stream itself; All streams passes the one the user chose. `startAt`
   * (seconds) carries the position over when the stream is switched.
   */
  | {
      name: 'player';
      type: string;
      metaId: string;
      videoId: string;
      preview?: MetaPreview;
      stream?: StreamEntry;
      /** The viewer picked `stream` by hand, so the player asks before moving to another. */
      chosen?: boolean;
      /**
       * The release the episode before played (Next episode, Up Next,
       * Episodes): it goes first when its addon has this video too. Never a link.
       */
      binge?: BingeHint;
      startAt?: number;
      /** A Lab test stream: no addons are asked and nothing is remembered. */
      lab?: boolean;
      /**
       * A sports event: only its own sources are asked, and nothing goes on
       * Continue Watching. Only a replay keeps its place (see remembersPlace).
       */
      event?: EventPlay;
    }
  /** Every stream for one video, for choosing by hand instead of auto-play. */
  | {
      name: 'streams';
      type: string;
      metaId: string;
      videoId: string;
      preview?: MetaPreview;
      startAt?: number;
      event?: EventPlay;
      /** Sent from the player's Sources: Back goes back to the film, where it was. */
      backTo?: PlayerRoute;
    }
  | { name: 'diagnostics' }
  | { name: 'lab' }
  /**
   * Settings > Profiles, and one profile's page; without an id it adds a
   * profile. `unlocked`: its PIN was entered to open the page, so changing
   * the PIN does not ask for it again.
   */
  | { name: 'profiles' }
  | { name: 'profile-edit'; id?: string; unlocked?: boolean }
  /** Settings > Home rows: their order, and which are hidden. */
  | { name: 'home-rows' }
  /** Settings > Trakt: sign in, sync, sign out. */
  | { name: 'trakt' }
  /**
   * Settings > BannerTV account: create, join, sync now, leave, delete (ADR 0006).
   * `join` opens it on typing a code, from the welcome's Join with a code.
   */
  | { name: 'account'; join?: boolean }
  /** Settings > Stream helper: run it (Android) or pair with one (the LG). */
  | { name: 'stream-helper' };

export type PlayerRoute = Extract<Route, { name: 'player' }>;

/**
 * Where focus goes on Back. A function is asked as the screen is shown again,
 * for a screen whose content moves about while it is covered.
 */
export type ReturnFocus = string | (() => string | undefined);

interface Entry {
  route: Route;
  /** Where focus was when the next screen opened on top, restored on Back. */
  returnFocus?: ReturnFocus;
}

export interface RouterState {
  /** stack[0] is always a section. Only the top entry is mounted. */
  stack: readonly Entry[];
}

export const router = createStore<RouterState>({ stack: [{ route: { name: 'home' } }] });

// Read once by the screen that mounts after Back.
let pendingFocus: ReturnFocus | undefined;

export function topRoute(state: RouterState = router.get()): Route {
  return state.stack[state.stack.length - 1]!.route;
}

export function currentSection(state: RouterState = router.get()): Section {
  return state.stack[0]!.route.name as Section;
}

export function canGoBack(state: RouterState = router.get()): boolean {
  return state.stack.length > 1;
}

export function openSection(section: Section): void {
  pendingFocus = undefined;
  router.set({ stack: [{ route: { name: section } }] });
}

export function push(
  route: Route,
  returnFocus: ReturnFocus = currentlyPressed() ?? getCurrentFocusKey(),
): void {
  router.set(({ stack }) => ({
    stack: [...stack.slice(0, -1), { ...stack[stack.length - 1]!, returnFocus }, { route }],
  }));
}

/**
 * Swaps the top screen for another, for example one episode's player for the
 * next one's, so Back still leads to the screen below. On a section root,
 * which must stay, it opens the route on top instead.
 */
export function replace(route: Route): void {
  const { stack } = router.get();
  if (stack.length <= 1) {
    push(route);
    return;
  }
  pendingFocus = undefined;
  router.set({ stack: [...stack.slice(0, -1), { route }] });
}

/** Closes the top screen. Returns false on a section root, where there is nothing to close. */
export function back(): boolean {
  const { stack } = router.get();
  if (stack.length <= 1) return false;
  const below = stack[stack.length - 2]!;
  pendingFocus = below.returnFocus;
  router.set({ stack: stack.slice(0, -1) });
  return true;
}

export function takePendingFocus(): string | undefined {
  const key = pendingFocus;
  pendingFocus = undefined;
  return typeof key === 'function' ? key() : key;
}
