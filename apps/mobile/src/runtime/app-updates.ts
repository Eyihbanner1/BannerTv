import { createStore } from '@bannertv/core';
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';
import { restartWhenSafe } from '../shims/sync-reload';
import { colors } from '../ui/theme';
import {
  type Asker,
  type CheckPhase,
  nextStep,
  readyToStart,
  restartRuleFor,
  type Running,
  runningFrom,
  takesUpdates,
  worthFetching,
} from './app-updates-plan';
import { startAgain } from './web-globals';
import { whereabouts } from './whereabouts';

/**
 * Over-the-air updates on the phone (ADR 0007, settings in app.config.ts). Expo's own client,
 * expo-updates, checks BannerTV's updates Worker at each launch by itself and downloads in the
 * background, taking only signed updates for this APK's runtime version. This module checks
 * again each time the app comes back to the foreground, at most every 15 minutes, and starts the
 * app again on a downloaded update at a moment that loses the person nothing
 * (runtime/safe-restart.ts): off screen, or Home, Settings or the account screen with nothing
 * being typed, never from the player or while "Who's watching?" is up. Without that restart
 * the update starts at the next launch. Settings shows what runs and has Check for updates.
 *
 * Nothing here runs in the web build, a development build or an APK without the certificate.
 * Errors stay quiet: a failed check is tried again later, and only the person's own check says so.
 */

export interface AppUpdates {
  /** This build takes updates. */
  on: boolean;
  running: Running;
  phase: CheckPhase;
  /** The person's check downloaded an update and Settings should offer to restart now. */
  offer: boolean;
}

const on = takesUpdates({
  platform: Platform.OS,
  development: __DEV__,
  enabled: Updates.isEnabled,
});

export const appUpdates = createStore<AppUpdates>({
  on,
  running: runningFrom(on, Updates),
  phase: 'idle',
  offer: false,
});

/** Who waits on the check that runs, or on the update downloaded. */
let asker: Asker = 'app';
/** When the last check started, Expo's own at launch included. */
let lastCheck: number | null = null;
let cancelRestart: (() => void) | undefined;
let restarting = false;
let started = false;

function set(next: Partial<AppUpdates>): void {
  appUpdates.set({ ...appUpdates.get(), ...next });
}

/**
 * Starts the downloaded update now, over the app's own background rather than expo-updates'
 * white. If that fails nothing tries again by itself (Restart now can), and the next launch
 * starts it anyway.
 */
function restart(): void {
  if (restarting) return;
  restarting = true;
  cancelRestart?.();
  cancelRestart = undefined;
  void startAgain(async () => {
    try {
      await Updates.reloadAsync({
        reloadScreenOptions: { backgroundColor: colors.bg, fade: true },
      });
    } catch (error) {
      restarting = false;
      throw error;
    }
  });
}

/** Whether an update already waits, downloaded by this check or by Expo's own at launch. */
function waiting(): boolean {
  return appUpdates.get().phase === 'ready';
}

/** An update is downloaded: it starts by the rule of whoever wanted it. */
function ready(): void {
  if (waiting()) return;
  const rule = restartRuleFor(asker);
  // Offered only while Settings, where it was asked for, is still on screen.
  set({ phase: 'ready', offer: asker === 'person' && whereabouts.get().screen === 'settings' });
  cancelRestart?.();
  cancelRestart = restartWhenSafe(restart, rule);
}

function finished(phase: 'none' | 'failed'): void {
  if (waiting()) return;
  // Only the person's own check says it failed: the app's are tried again later.
  set({ phase: phase === 'failed' && asker === 'app' ? 'idle' : phase });
  asker = 'app';
}

async function check(): Promise<void> {
  lastCheck = Date.now();
  set({ phase: 'checking' });
  try {
    const found = await Updates.checkForUpdateAsync();
    if (waiting()) return;
    if (!worthFetching(found)) {
      finished('none');
      return;
    }
    set({ phase: 'downloading' });
    const fetched = await Updates.fetchUpdateAsync();
    if (readyToStart(fetched) || Updates.latestContext.isUpdatePending) ready();
    else finished('none');
  } catch (error) {
    console.warn('[BannerTV] update check failed:', String(error));
    finished('failed');
  }
}

/** A wish to check, the app's or the person's. */
function wish(who: Asker): void {
  if (!on) return;
  switch (nextStep(who, appUpdates.get().phase, lastCheck, Date.now())) {
    case 'check':
      asker = who;
      void check();
      return;
    case 'join':
      asker = who;
      return;
    case 'offer':
      asker = who;
      set({ offer: true });
      // While the person decides, and if they put it off, only off screen.
      cancelRestart?.();
      cancelRestart = restartWhenSafe(restart, restartRuleFor(who));
      return;
    case 'skip':
      return;
  }
}

/** Settings' Check for updates: checks and downloads, then offers to restart (`offer`). */
export function checkForUpdates(): void {
  wish('person');
}

/** Settings has shown its offer. */
export function offerShown(): void {
  if (appUpdates.get().offer) set({ offer: false });
}

/** The person chose to start the downloaded update now. */
export function restartNow(): void {
  if (appUpdates.get().phase === 'ready') restart();
}

/**
 * Starts following updates, from boot. Expo's own check at launch counts as the first: the app
 * follows it through expo-updates' state (the same events its useUpdates hook reads) and checks
 * again itself only once back in the foreground.
 */
export function startAppUpdates(): void {
  if (started || !on) return;
  started = true;
  lastCheck = Date.now();
  try {
    if (Updates.latestContext.isUpdatePending) ready();
    Updates.addUpdatesStateChangeListener((event) => {
      if (event.context.isUpdatePending) ready();
    });
  } catch (error) {
    console.warn('[BannerTV] app updates unavailable:', String(error));
  }
  let active = AppState.currentState === 'active';
  AppState.addEventListener('change', (next) => {
    const back = !active && next === 'active';
    active = next === 'active';
    if (back) wish('app');
  });
}
