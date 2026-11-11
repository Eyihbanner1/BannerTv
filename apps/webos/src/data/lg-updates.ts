/*
 * Signed updates inside the app on an LG TV: the app's side of the loader
 * (src/shell, platform/shell.ts). The loader checks the updates Worker by
 * itself, downloads a newer update in the background and starts it the next
 * time the app starts, or once the app has been off screen for a minute. The
 * app adds one more moment: Settings, where the Updates part says what is
 * happening, so an update found while Settings shows starts there and then.
 * Never anywhere else on screen: on a TV a restart under the person is seen
 * by the whole room.
 */
import { createStore } from '@bannertv/core';
import type { ShellStatus } from '../shell/contract';
import { shell } from '../platform/shell';
import { appWhereabouts, safeNow, type SafePlaces, whenSafe } from './sync-reload';

/** Settings shows the line for this long before the app starts again. */
export const RESTART_PAUSE_MS = 2500;

const UPDATE_PLACES: SafePlaces = { screens: ['settings'], hidden: false };

/** Whether this build takes updates on this TV, so Settings says how they stand. */
export function lgUpdatesShown(): boolean {
  return shell()?.updates === true;
}

const OFF: ShellStatus = { running: null, next: null, failed: null, check: { kind: 'off' } };

/** The loader's status, kept as a store so Settings redraws on each change. */
export const lgUpdateStatus = createStore<ShellStatus>(shell()?.status() ?? OFF);

/** Asks the Worker now, as Settings opens: the loader answers at most once a minute. */
export function checkLgUpdates(): void {
  void shell()?.check();
}

/**
 * Follows the loader's status, and starts the app again on Settings once
 * something is waiting to start. Call once, as the app starts.
 */
export function startLgUpdates(): void {
  const api = shell();
  if (!api || !api.updates) return;
  let restarting = false;
  const restart = () => {
    window.setTimeout(() => {
      // Still there after the pause, and nothing opened meanwhile, or wait for the next time.
      if (safeNow(appWhereabouts, UPDATE_PLACES)) api.restart();
      else whenSafe(appWhereabouts, restart, UPDATE_PLACES);
    }, RESTART_PAUSE_MS);
  };
  const follow = () => {
    const status = api.status();
    lgUpdateStatus.set(status);
    if (restarting || status.next === null) return;
    restarting = true;
    whenSafe(appWhereabouts, restart, UPDATE_PLACES);
  };
  api.subscribe(follow);
  follow();
}
