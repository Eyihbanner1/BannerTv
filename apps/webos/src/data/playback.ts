import {
  createBandwidthMemory,
  createPlayedVideos,
  createProgressStore,
  createSourceMemory,
  createSpeedMemory,
} from '@bannertv/core';
import { profileKv, storage } from './storage';
import { storeNow } from './sync-clock';

/** Where each video was left, for Resume and Continue Watching on Home. Per profile. */
export const progress = createProgressStore({ storage: profileKv, now: storeNow });

/** Which addons' streams have played on this TV, for auto-play's ranking. Shared by profiles. */
export const sourceMemory = createSourceMemory({ storage: storage.kv });

/** The name, artwork and episode of each video that played, for Continue Watching on Home. Per profile. */
export const playedVideos = createPlayedVideos({ storage: profileKv, now: storeNow });

/** How much data this TV's connection keeps up with, so auto-play avoids streams that buffer. */
export const bandwidth = createBandwidthMemory({ storage: storage.kv });

/** Which playback speeds Settings > Lab measured this TV keeping, for each kind of stream. Shared by profiles. */
export const speedMemory = createSpeedMemory({ storage: storage.kv });

export function startPlaybackData(): void {
  void progress.load();
  void sourceMemory.load();
  void bandwidth.load();
  void speedMemory.load();
  void playedVideos.load();
}
