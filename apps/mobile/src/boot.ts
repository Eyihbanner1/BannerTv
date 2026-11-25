// The Android host first: the shared code asks `isAndroid()` as it starts.
import './runtime/install-host';
import { checkServiceStatus } from '@tv/data/api';
import { startAddons } from '@tv/data/addons';
import { startLibraryData } from '@tv/data/library';
import { scorecard, startPlaybackData } from '@tv/data/playback';
import { askAgainOnRelaunch } from '@tv/data/profiles';
import { startSports } from '@tv/data/sports';
import { startSync } from '@tv/data/sync';
import { startTrakt } from '@tv/data/trakt';
import { initI18n } from '@tv/i18n';
import { initAndroid } from '@tv/platform/android';
import { playRows, scorecardRows } from '@tv/player/scorecard-rows';
import { addPhoneStrings } from './i18n/phone';
import { startAppUpdates } from './runtime/app-updates';
import { catchCrashes, reportPlayback } from './runtime/crash-catcher';

let booted = false;

/** Plays the report lists one by one, newest first, under the scorecard's averages. */
const REPORT_PLAYS = 5;

/** Starts the shared data layer, in the order the TV's main.tsx does. Runs once. */
export function boot(): void {
  if (booted) return;
  booted = true;
  // First, so a problem as the data layer starts is kept for Send a report.
  catchCrashes();
  initI18n();
  addPhoneStrings();
  initAndroid({ onRelaunch: askAgainOnRelaunch });
  startAddons();
  startPlaybackData();
  // How plays went on this phone goes with Send a report: the averages, then the newest few.
  reportPlayback(() => {
    const plays = scorecard.plays();
    return [...scorecardRows(plays), ...playRows(plays.slice(0, REPORT_PLAYS))];
  });
  startLibraryData();
  checkServiceStatus();
  startTrakt();
  // The phone has no Sports screen yet, but Home and Search wait for the sports state.
  void startSports();
  startSync();
  // Over-the-air updates, after the stores that say when a restart would interrupt nothing.
  startAppUpdates();
}
