import {
  createBandwidthMemory,
  createPlayedVideos,
  createProgressStore,
  createSourceMemory,
} from '@bannertv/core';
import { storage } from './storage';

/** Where each video was left, for Resume and Continue Watching on Home. */
export const progress = createProgressStore({ storage: storage.kv });

/** Which addons' streams have played on this TV, for auto-play's ranking. */
export const sourceMemory = createSourceMemory({ storage: storage.kv });

/** The name, artwork and episode of each video that played, for Continue Watching on Home. */
export const playedVideos = createPlayedVideos({ storage: storage.kv });

/** How much data this TV's connection keeps up with, so auto-play avoids streams that buffer. */
export const bandwidth = createBandwidthMemory({ storage: storage.kv });

export function startPlaybackData(): void {
  void progress.load();
  void sourceMemory.load();
  void bandwidth.load();
  void playedVideos.load();
}
