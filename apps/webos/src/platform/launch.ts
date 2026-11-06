import { sinceActivity } from '../navigation/activity';
import { bootInfo } from './boot';
import { bootMark } from './marks';

/**
 * Once Home has placed its first focus, the launch has settled when the
 * remote has then been still this long: the first rows have drawn, and work
 * started now does not land on the first presses.
 */
export const SETTLE_QUIET_MS = 2000;
/** ...or, whatever Home is doing, once this long has passed since the bundle started. */
export const SETTLE_LATEST_MS = 10000;

let homeFocusedAt: number | undefined;
let settled = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const waiting: Array<() => void> = [];

function settle(): void {
  settled = true;
  clearTimeout(timer);
  for (const run of waiting.splice(0)) {
    try {
      run();
    } catch (error) {
      console.warn('[BannerTV] after launch:', String(error));
    }
  }
}

/** Settles now if it is time, else looks again when it could be: a key press meanwhile waits longer. */
function check(): void {
  if (settled) return;
  const now = Date.now();
  let wait = SETTLE_LATEST_MS - (now - bootInfo.startedAt);
  if (homeFocusedAt !== undefined) {
    // Before any key, the remote has been still since Home's focus.
    const quiet = Math.min(sinceActivity(), now - homeFocusedAt);
    wait = Math.min(wait, SETTLE_QUIET_MS - quiet);
  }
  if (wait <= 0) {
    settle();
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(check, wait);
}

/**
 * Home has placed its first focus since the page loaded: the launch is
 * usable. Later showings of Home change nothing.
 */
export function noteHomeFocused(): void {
  if (homeFocusedAt !== undefined) return;
  homeFocusedAt = Date.now();
  bootMark('boot:first-focus');
  if (waiting.length > 0) check();
}

/**
 * Runs `run` once the launch has settled: Home has placed its first focus
 * and the remote has then been still for SETTLE_QUIET_MS, or at the latest
 * SETTLE_LATEST_MS after the bundle started (Home may never be shown, as
 * when the app starts on a screen above it). At once if it already has.
 * Nothing waits, and no timer runs, until something asks.
 */
export function afterLaunch(run: () => void): void {
  if (settled) {
    run();
    return;
  }
  waiting.push(run);
  check();
}
