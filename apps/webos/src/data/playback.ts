import { createBandwidthMemory, createProgressStore, createSourceMemory } from '@bannertv/core';
import { storage } from './storage';

/** Where each video was left, for Resume and (in Phase 3) Continue Watching. */
export const progress = createProgressStore({ storage: storage.kv });

/** Which addons' streams have played on this TV, for auto-play's ranking. */
export const sourceMemory = createSourceMemory({ storage: storage.kv });

/** How much data this TV's connection keeps up with, so auto-play avoids streams that buffer. */
export const bandwidth = createBandwidthMemory({ storage: storage.kv });

export function startPlaybackData(): void {
  void progress.load();
  void sourceMemory.load();
  void bandwidth.load();
}
