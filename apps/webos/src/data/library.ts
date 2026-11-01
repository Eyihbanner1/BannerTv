import {
  createHomeLayout,
  createLibrary,
  createSubtitleOffsets,
  createTrackMemory,
  createWatchedSet,
} from '@bannertv/core';
import { createSubtitleDrifts } from '../player/drift';
import { profileKv } from './storage';

/** The profile's "My List" (ADR 0004, item 6). */
export const library = createLibrary({ storage: profileKv });

/** What Trakt says the profile has watched, for watched ticks (ADR 0004, item 12). */
export const watchedSet = createWatchedSet({ storage: profileKv });

/** Audio and subtitle languages chosen per title (ADR 0004, item 7). */
export const trackMemory = createTrackMemory({ storage: profileKv });

/** How much later or earlier the viewer moved each subtitle file. */
export const subtitleOffsets = createSubtitleOffsets({ storage: profileKv });

/** The drift fix the viewer chose for each subtitle file timed for another frame rate. */
export const subtitleDrifts = createSubtitleDrifts({ storage: profileKv });

/** The order and visibility of the profile's Home rows (ADR 0004, item 8). */
export const homeLayout = createHomeLayout({ storage: profileKv });

/** Reads the profile's library data once it is known; Home waits for the layout. */
export function startLibraryData(): void {
  void library.load();
  void watchedSet.load();
  void trackMemory.load();
  void subtitleOffsets.load();
  void subtitleDrifts.load();
  void homeLayout.load();
}
