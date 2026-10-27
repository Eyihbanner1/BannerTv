import { createStore, type StreamEntry } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { currentlyPressed } from '../navigation/focus-memory';

/** Top-level destinations in the rail. */
export const SECTIONS = ['home', 'search', 'discover', 'library', 'addons', 'settings'] as const;
export type Section = (typeof SECTIONS)[number];

export type Route =
  | { name: Section }
  /** `preview` is what the tile already knew, drawn while the full meta loads. */
  | { name: 'details'; type: string; id: string; preview?: MetaPreview }
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
      startAt?: number;
      /** A Lab test stream: no addons are asked and nothing is remembered. */
      lab?: boolean;
    }
  /** Every stream for one video, for choosing by hand instead of auto-play. */
  | {
      name: 'streams';
      type: string;
      metaId: string;
      videoId: string;
      preview?: MetaPreview;
      startAt?: number;
    }
  | { name: 'diagnostics' }
  | { name: 'lab' };

interface Entry {
  route: Route;
  /** Where focus was when the next screen opened on top, restored on Back. */
  returnFocus?: string;
}

export interface RouterState {
  /** stack[0] is always a section. Only the top entry is mounted. */
  stack: readonly Entry[];
}

export const router = createStore<RouterState>({ stack: [{ route: { name: 'home' } }] });

// Read once by the screen that mounts after Back.
let pendingFocus: string | undefined;

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
  returnFocus: string = currentlyPressed() ?? getCurrentFocusKey(),
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
  return key;
}
