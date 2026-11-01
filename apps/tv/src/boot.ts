// The Android host first: the shared code asks `isAndroid()` as it starts.
import './runtime/install-host';
import { checkServiceStatus } from '@tv/data/api';
import { startAddons } from '@tv/data/addons';
import { startLibraryData } from '@tv/data/library';
import { startPlaybackData } from '@tv/data/playback';
import { askAgainOnRelaunch } from '@tv/data/profiles';
import { startSports } from '@tv/data/sports';
import { startSync } from '@tv/data/sync';
import { startTrakt } from '@tv/data/trakt';
import { initI18n } from '@tv/i18n';
import { initAndroid } from '@tv/platform/android';
import { addTvStrings } from './i18n/tv';

let booted = false;

/** Starts the shared data layer, in the order the LG app's main.tsx and the phone app do. */
export function boot(): void {
  if (booted) return;
  booted = true;
  initI18n();
  addTvStrings();
  initAndroid({ onRelaunch: askAgainOnRelaunch });
  startAddons();
  startPlaybackData();
  startLibraryData();
  checkServiceStatus();
  startTrakt();
  // No Sports screen here yet, but Home waits for the sports state to leave sport out.
  void startSports();
  startSync();
}
