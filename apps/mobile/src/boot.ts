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
import { addPhoneStrings } from './i18n/phone';
import { startAppUpdates } from './runtime/app-updates';

let booted = false;

/** Starts the shared data layer, in the order the TV's main.tsx does. Runs once. */
export function boot(): void {
  if (booted) return;
  booted = true;
  initI18n();
  addPhoneStrings();
  initAndroid({ onRelaunch: askAgainOnRelaunch });
  startAddons();
  startPlaybackData();
  startLibraryData();
  checkServiceStatus();
  startTrakt();
  // The phone has no Sports screen yet, but Home and Search wait for the sports state.
  void startSports();
  startSync();
  // Over-the-air updates, after the stores that say when a restart would interrupt nothing.
  startAppUpdates();
}
