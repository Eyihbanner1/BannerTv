/**
 * loader.js: the build bundles this file alone into a classic script beside
 * index.html (build/shell.ts), which runs it after the unsupported-TV check
 * and before anything of the app. It reads the ShellConfig index.html
 * carries, hands the loader the page's real storage, network and clock, puts
 * the loader's API on window and starts the app.
 */
import { CONFIG_ELEMENT_ID, DB_NAME, type ShellConfig, STATE_KEY } from './contract';
import { createShell, type ShellPage } from './loader';
import { idbStore } from './store';

interface Host {
  webOSSystem?: unknown;
  PalmSystem?: unknown;
  BannerAndroid?: { protocol?: unknown };
  __BANNERTV_UNSUPPORTED__?: boolean;
}

function readConfig(): ShellConfig | null {
  try {
    const element = document.getElementById(CONFIG_ELEMENT_ID);
    return element ? (JSON.parse(element.textContent ?? '') as ShellConfig) : null;
  } catch {
    return null;
  }
}

function tryGet<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Appends a script to the page; resolves once it has run, rejects if it did not load. */
function append(setUp: (script: HTMLScriptElement) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.onload = () => resolve();
    script.onerror = () => {
      script.parentNode?.removeChild(script);
      reject(new Error('load'));
    };
    setUp(script);
    (document.body ?? document.head).appendChild(script);
  });
}

/**
 * Runs a script's text in the page. It runs as the element goes in, and an
 * error it throws goes to window's error event, as for any script. The element
 * is taken out again so its text, a megabyte for the app's, is not kept.
 */
function inline(bytes: ArrayBuffer): Promise<void> {
  const script = document.createElement('script');
  script.text = new TextDecoder().decode(bytes);
  (document.body ?? document.head).appendChild(script);
  script.parentNode?.removeChild(script);
  return Promise.resolve();
}

const page: ShellPage = {
  runFile: (path) =>
    append((script) => {
      script.src = `./${path}`;
    }),
  runBytes(bytes) {
    // A blob: script loads like a file (Chromium parses it off the main thread); a TV that will not
    // load one from a file:// page gets the same bytes as an inline script.
    const url = tryGet(() => URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' })));
    if (!url) return inline(bytes);
    const revoke = () => tryGet(() => URL.revokeObjectURL(url));
    return append((script) => {
      script.src = url;
    }).then(revoke, () => {
      revoke();
      return inline(bytes);
    });
  },
  reload: () => window.location.reload(),
  hidden: () => document.hidden === true,
  onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
};

function main(): void {
  const host = window as unknown as Host;
  if (host.__BANNERTV_UNSUPPORTED__) return;
  const config = readConfig();
  // The build always writes one (tools/scripts/check-bundle.mjs checks it).
  if (!config) return;

  const isLg = !!(host.webOSSystem || host.PalmSystem);
  const isAndroid = !!host.BannerAndroid && typeof host.BannerAndroid.protocol === 'function';
  const subtle = tryGet(() => window.crypto.subtle);
  const idb = tryGet(() => window.indexedDB);
  const local = tryGet(() => window.localStorage);
  const updatesHere =
    isLg &&
    !isAndroid &&
    !!subtle &&
    !!idb &&
    !!local &&
    typeof fetch === 'function' &&
    typeof AbortController === 'function' &&
    typeof TextDecoder === 'function';

  const { api, launch } = createShell({
    config,
    updatesHere,
    subtle,
    store: idb ? idbStore(idb) : undefined,
    fetch: (url, init) => fetch(url, init),
    storage: {
      get: () => local?.getItem(STATE_KEY) ?? null,
      set: (text) => local?.setItem(STATE_KEY, text),
    },
    page,
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    warn: (message) => console.warn(message),
  });
  window.__BANNERTV_SHELL__ = api;
  void launch();

  // A build that takes no updates installed over one that took them (the store's, say): what the
  // earlier one stored is of no use now. Later, so it never slows the start.
  if (!api.updates && local && tryGet(() => local.getItem(STATE_KEY)) != null) {
    window.setTimeout(() => {
      tryGet(() => local.removeItem(STATE_KEY));
      tryGet(() => idb?.deleteDatabase(DB_NAME));
    }, 30 * 1000);
  }
}

main();
