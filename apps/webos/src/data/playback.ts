import { createProgressStore, createSourceMemory } from '@bannertv/core';
import { storage } from './storage';

/** Where each video was left, for Resume and (in Phase 3) Continue Watching. */
export const progress = createProgressStore({ storage: storage.kv });

/** Which addons' streams have played on this TV, for auto-play's ranking. */
export const sourceMemory = createSourceMemory({ storage: storage.kv });

export function startPlaybackData(): void {
  void progress.load();
  void sourceMemory.load();
}
