import { createStore } from '@bannertv/core';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';

/** Top-level destinations in the rail. */
export const SECTIONS = ['home', 'search', 'discover', 'library', 'addons', 'settings'] as const;
export type Section = (typeof SECTIONS)[number];

export type Route =
  | { name: Section }
  | { name: 'details'; itemId: string }
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

export function push(route: Route, returnFocus: string = getCurrentFocusKey()): void {
  router.set(({ stack }) => ({
    stack: [...stack.slice(0, -1), { ...stack[stack.length - 1]!, returnFocus }, { route }],
  }));
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
