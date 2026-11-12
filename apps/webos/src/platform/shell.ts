/**
 * The app's side of the loader (src/shell): the API index.html's loader.js
 * puts on window before the app's script runs. In the development server, the
 * Playwright journeys' dev runs and unit tests there is no loader, and every
 * call here falls back to what the app did before it: scripts from the app's
 * folder, and nothing to report.
 */
import { SHELL_CONTRACT, type ShellApi } from '../shell/contract';
import { afterLaunch } from './launch';

/** The loader's API, when the page was started by a loader of this app's contract. */
export function shell(): ShellApi | undefined {
  const api = typeof window !== 'undefined' ? window.__BANNERTV_SHELL__ : undefined;
  return api && api.contract === SHELL_CONTRACT ? api : undefined;
}

/** A classic script from the app's folder, without a loader. */
function plainScript(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `./${path}`;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load ${path}`));
    };
    document.head.appendChild(script);
  });
}

/**
 * Runs one of the scripts beside the app's own that an update can replace
 * (vendor/hls.min.js, data/sports-data.js): the running update's copy when it
 * has one, else the .ipk's. Resolves once it has run.
 */
export function loadAppScript(path: string): Promise<void> {
  const api = shell();
  return api ? api.loadScript(path) : plainScript(path);
}

let drawn = false;
let settled = false;
let marked = false;

function markGoodWhenReady(): void {
  if (marked || !drawn || !settled) return;
  // React takes the whole tree down when a screen throws while drawing, leaving the root empty:
  // that start did not go well, and the loader's watchdog puts the update aside.
  const root = document.getElementById('root');
  if (!root || root.childElementCount === 0) return;
  marked = true;
  shell()?.markGood();
}

/**
 * The app's script has run to its end: tells the loader so, and that the
 * start went well once the app has drawn (noteAppDrawn) and the launch has
 * settled (afterLaunch). Until then a stored update is on trial.
 */
export function noteAppStarted(): void {
  shell()?.started();
  afterLaunch(() => {
    settled = true;
    markGoodWhenReady();
  });
}

/** The app's root has drawn for the first time. */
export function noteAppDrawn(): void {
  drawn = true;
  markGoodWhenReady();
}
