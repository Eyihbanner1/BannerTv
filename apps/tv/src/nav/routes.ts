import { createStore } from '@bannertv/core';
import type { BingeHint, StreamEntry } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { pop, push, replace, reset, type Stack, top } from './stack';

export interface PlayerRoute {
  type: string;
  metaId: string;
  videoId: string;
  preview?: MetaPreview;
  stream?: StreamEntry;
  /** The viewer picked `stream` by hand: no failover. */
  chosen?: boolean;
  binge?: BingeHint;
  /** Seconds; undefined resumes where the viewer left off, 0 starts over. */
  startAt?: number;
}

export interface StreamsRoute {
  type: string;
  metaId: string;
  videoId: string;
  preview?: MetaPreview;
}

/** The nav row's places. */
export type Section = 'home' | 'search' | 'discover' | 'sports' | 'library';

export type Route =
  | { name: 'section'; section: Section }
  | { name: 'details'; item: MetaPreview }
  | { name: 'streams'; streams: StreamsRoute }
  | { name: 'player'; player: PlayerRoute }
  | { name: 'settings' }
  | { name: 'profiles' };

/** Each screen gets a key, so a replaced player mounts afresh. */
export interface Entry {
  key: number;
  route: Route;
}

let counter = 0;
const entry = (route: Route): Entry => ({ key: ++counter, route });

export const screens = createStore<Stack<Entry>>(
  reset(entry({ name: 'section', section: 'home' })),
);

export function currentRoute(): Route {
  return top(screens.get()).route;
}

export function open(route: Route): void {
  screens.set((stack) => push(stack, entry(route)));
}

export function openSection(section: Section): void {
  screens.set(() => reset(entry({ name: 'section', section })));
}

export function openTitle(item: MetaPreview): void {
  open({ name: 'details', item });
}

export function openPlayer(player: PlayerRoute, how: 'push' | 'replace' = 'push'): void {
  if (how === 'replace') screens.set((stack) => replace(stack, entry({ name: 'player', player })));
  else open({ name: 'player', player });
}

export function openStreams(streams: StreamsRoute): void {
  open({ name: 'streams', streams });
}

/** One screen back. False on the first screen, so Back can leave the app. */
export function goBack(): boolean {
  const before = screens.get();
  const after = pop(before);
  if (after) screens.set(() => after);
  return after !== null;
}
