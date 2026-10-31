import type { BingeHint, StreamEntry } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { router } from 'expo-router';

/**
 * The phone's routes. Objects a screen hands the next one (the tile's preview, a chosen stream)
 * travel in memory under a short key, not in the address: they can be large, and a stream's
 * link can hold the viewer's addon keys.
 */

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
  startAt?: number;
  /** Opened from the player: picking a stream replaces the player instead of stacking another. */
  fromPlayer?: boolean;
}

export interface CatalogRoute {
  transportUrl: string;
  type: string;
  catalogId: string;
  genre?: string;
  title: string;
}

const MAX_KEPT = 40;
const kept = new Map<string, unknown>();
let counter = 0;

function keep(value: unknown): string {
  const key = `${Date.now().toString(36)}${(++counter).toString(36)}`;
  kept.set(key, value);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return key;
}

/** What the previous screen handed this one, or undefined after the app started again. */
export function handed<T>(key: string | string[] | undefined): T | undefined {
  return typeof key === 'string' ? (kept.get(key) as T | undefined) : undefined;
}

export function openTitle(item: MetaPreview): void {
  router.push({ pathname: '/title', params: { type: item.type, id: item.id, key: keep(item) } });
}

export function openPlayer(route: PlayerRoute, how: 'push' | 'replace' = 'push'): void {
  const target = { pathname: '/player' as const, params: { key: keep(route) } };
  if (how === 'replace') router.replace(target);
  else router.push(target);
}

export function openStreams(route: StreamsRoute, how: 'push' | 'replace' = 'push'): void {
  const target = { pathname: '/streams' as const, params: { key: keep(route) } };
  if (how === 'replace') router.replace(target);
  else router.push(target);
}

export function openCatalog(route: CatalogRoute): void {
  router.push({ pathname: '/catalog', params: { key: keep(route) } });
}

export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
