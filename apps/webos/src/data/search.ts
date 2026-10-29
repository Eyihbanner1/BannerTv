import { createRecentList } from '@bannertv/core';
import { profileKv } from './storage';

export const recentSearches = createRecentList({
  storage: profileKv,
  key: 'recentSearches',
  max: 8,
});

let loading: Promise<void> | undefined;

/** Reads the saved recent searches the first time Search opens. */
export function loadRecentSearches(): void {
  if (!loading) loading = recentSearches.load();
}
