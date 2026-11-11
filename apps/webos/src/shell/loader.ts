/**
 * The loader: what index.html runs before the app, from the .ipk, and so the
 * one part of the LG app that can never change over the air. It starts the
 * app from the update the TV last downloaded or from the .ipk's own files,
 * checks the updates Worker now and then, downloads and checks a newer update
 * in the background, and starts it the next time the app starts.
 *
 * Everything that touches the page, the network, storage or the clock comes
 * in through ShellEnv (main.ts gives the real ones), so the unit tests run it
 * all with fakes. The rules for which update starts are in state.ts; the
 * checks on what the Worker sends are in signed.ts.
 *
 * How a bad update is caught, before it can cost more than a start or two:
 * - its manifest's signature, and the SHA-256 of every file, are checked again
 *   at every start, and anything that fails runs the .ipk's code instead, in
 *   the same start;
 * - an app script that throws before its end (started() never called) is put
 *   aside, and the page starts again from the .ipk's code;
 * - an app that has not said its start went well (markGood()) WATCHDOG_MS
 *   after its script ran is put aside in the same way;
 * - an update that started MAX_TRIES times without markGood() (the TV turned
 *   off each time, say) is put aside at the next start.
 */
import {
  BUILT_IN_TYPE,
  type CheckState,
  type Manifest,
  type ShellApi,
  type ShellConfig,
  type ShellStatus,
  UPDATE_TYPE,
  type UpdateInfo,
} from './contract';
import {
  importUpdateKey,
  readAnswer,
  readSigned,
  type SignedAnswer,
  sha256Hex,
  verifyText,
} from './signed';
import {
  boot,
  freshState,
  isNewer,
  markBad,
  markGood,
  readState,
  sameAsBuiltIn,
  type ShellState,
  takeBuiltIn,
  takeUpdate,
} from './state';
import type { UpdateStore } from './store';

/** The first check, after the launch has had the network to itself. */
export const FIRST_CHECK_MS = 60 * 1000;
/** Then this often while the app runs: it stays running in the background for days. */
export const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
/** A check asked for this soon after the last one gives the last one's answer. */
export const RECHECK_MS = 60 * 1000;
/** How long the app has from its script running to its start going well. */
export const WATCHDOG_MS = 30 * 1000;
/** How long the app stays off screen, with an update waiting, before it starts again to run it. */
export const HIDDEN_RESTART_MS = 60 * 1000;
/** The Worker's answer is a few kilobytes. */
export const ANSWER_TIMEOUT_MS = 30 * 1000;
/** One file, the app's script at about 1.2 MB the largest. */
export const FILE_TIMEOUT_MS = 2 * 60 * 1000;
/** The longest a start again waits for the state's copy in IndexedDB to be written. */
export const SAVE_WAIT_MS = 1000;

/** The page as the loader uses it. */
export interface ShellPage {
  /** Runs a script from the app's folder by its path; resolves once it ran, rejects if it did not load. */
  runFile(path: string): Promise<void>;
  /** Runs a script from its bytes; resolves once it ran, rejects if it could not. */
  runBytes(bytes: ArrayBuffer): Promise<void>;
  reload(): void;
  hidden(): boolean;
  onVisibilityChange(listener: () => void): void;
}

export interface ShellEnv {
  config: ShellConfig;
  /**
   * Whether updates can run here at all: an LG TV (the Android TV app shows
   * the same files in a WebView, and takes none), with Web Crypto, IndexedDB,
   * localStorage and fetch.
   */
  updatesHere: boolean;
  subtle: SubtleCrypto | undefined;
  store: UpdateStore | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * The loader's state, as text in localStorage, read as the page starts. The store keeps a copy
   * (UpdateStore.putState) for a start that finds localStorage empty.
   */
  storage: { get(): string | null; set(text: string): void };
  page: ShellPage;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  /** The page's own clock (performance.now()), only ever for intervals. */
  now(): number;
  warn(message: string): void;
}

const LATEST: CheckState = { kind: 'latest' };
const READY: CheckState = { kind: 'ready' };

const infoOf = (manifest: Manifest): UpdateInfo => ({
  id: manifest.id,
  createdAt: manifest.createdAt,
  version: manifest.version,
  commit: manifest.commit,
});

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message.slice(0, 80) : 'error';

/**
 * The loader over `env`: the API the app gets as window.__BANNERTV_SHELL__,
 * and `launch`, which starts the app. Set the API on the window first: the
 * app's script reads it as it runs.
 */
export function createShell(env: ShellEnv): { api: ShellApi; launch(): Promise<void> } {
  const { config } = env;
  const updates = config.updates;
  const on = !!(updates && env.updatesHere && env.subtle && env.store);
  const subtle = env.subtle!;
  const store = env.store!;

  let state: ShellState = freshState(config.build.id);
  let run: UpdateInfo | null = null;
  /** The last write of the state's copy in IndexedDB. */
  let saved: Promise<void> = Promise.resolve();
  /** Once the state is read and this start counted (boot), before anything runs. */
  const ready: Promise<void> = on
    ? readStored().then((text) => {
        const booted = boot(readState(text, config.build.id));
        state = booted.state;
        run = booted.run;
        save();
      })
    : Promise.resolve();
  /** The manifest of the update running, once its checks passed. */
  let running: Manifest | null = null;
  let checkState: CheckState = on ? { kind: 'idle' } : { kind: 'off' };
  let started = false;
  let good = false;
  let watchdog: unknown;
  let hiddenTimer: unknown;
  let checking: Promise<CheckState> | undefined;
  let lastCheckAt = -Infinity;
  const listeners: Array<() => void> = [];

  let keyPromise: Promise<CryptoKey> | undefined;
  const key = () => {
    if (!keyPromise) {
      keyPromise = importUpdateKey(subtle, updates!.key);
      keyPromise.catch(() => {
        keyPromise = undefined;
      });
    }
    return keyPromise;
  };

  /**
   * The state from localStorage, or from its copy in IndexedDB when localStorage has none: a
   * page started again can find localStorage without the last writes before it (desktop
   * Chromium does it now and then on file://), and a TV short of space may clear it.
   */
  function readStored(): Promise<string | null> {
    let text: string | null = null;
    try {
      text = env.storage.get();
    } catch {
      // Read the copy instead.
    }
    if (text !== null) return Promise.resolve(text);
    return store.getState().catch(() => null);
  }

  function save(): void {
    const text = JSON.stringify(state);
    try {
      env.storage.set(text);
    } catch {
      // The copy in IndexedDB is still written.
    }
    // Without either, this start is all there is: the next starts the .ipk's code.
    saved = store.putState(text).catch(() => undefined);
  }

  /** Starts the page again once the state's copy is written, or SAVE_WAIT_MS on at the most. */
  function reloadWhenSaved(): void {
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      env.page.reload();
    };
    const timer = env.setTimeout(go, SAVE_WAIT_MS);
    void saved.then(() => {
      env.clearTimeout(timer);
      go();
    });
  }

  function notify(): void {
    for (const listener of listeners.slice()) {
      try {
        listener();
      } catch (error) {
        env.warn(`[BannerTV] shell listener: ${reasonOf(error)}`);
      }
    }
  }

  function setCheck(next: CheckState): void {
    checkState = next;
    notify();
  }

  /** The files an update has of its own, not the .ipk's. */
  function ownFiles(manifest: Manifest): Array<[string, { sha256: string; size: number }]> {
    return Object.keys(manifest.files)
      .filter((path) => config.files[path]?.sha256 !== manifest.files[path]!.sha256)
      .map((path) => [path, manifest.files[path]!]);
  }

  async function verified(answer: SignedAnswer): Promise<boolean> {
    return (
      answer.keyId === updates!.keyId && verifyText(subtle, await key(), answer.text, answer.sig)
    );
  }

  /** A stored file, checked again against the hash its manifest gives it. */
  async function storedFile(sha256: string): Promise<ArrayBuffer> {
    const bytes = await store.getFile(sha256);
    if (!bytes) throw new Error('missing');
    if ((await sha256Hex(subtle, bytes)) !== sha256) throw new Error('changed');
    return bytes;
  }

  /** The stored update `update`, checked from its signature to its files. */
  async function prepare(update: UpdateInfo): Promise<{ manifest: Manifest; bytes?: ArrayBuffer }> {
    const stored = await store.getUpdate(update.id);
    if (!stored) throw new Error('missing');
    if (!(await verified({ text: stored.text, sig: stored.sig, keyId: stored.keyId }))) {
      throw new Error('signature');
    }
    const manifest = readSigned(stored.text, config);
    if (manifest.type !== UPDATE_TYPE || manifest.id !== update.id) throw new Error('manifest');
    const own = ownFiles(manifest);
    const have = await store.hasFiles(own.map(([, file]) => file.sha256));
    if (own.some(([, file]) => !have.has(file.sha256))) throw new Error('files');
    const launchFile = manifest.files[manifest.launch]!;
    if (config.files[manifest.launch]?.sha256 === launchFile.sha256) return { manifest };
    return { manifest, bytes: await storedFile(launchFile.sha256) };
  }

  function putAside(update: UpdateInfo, reason: string): void {
    env.warn(`[BannerTV] update ${update.version} (${update.id}) put aside: ${reason}`);
    state = markBad(state, update);
    running = null;
    save();
    notify();
  }

  function launchBuiltIn(): Promise<void> {
    return env.page.runFile(config.launch).catch(() => {
      env.warn('[BannerTV] the app script did not load');
    });
  }

  function armWatchdog(update: UpdateInfo): void {
    env.clearTimeout(watchdog);
    watchdog = env.setTimeout(() => {
      if (good) return;
      // Off screen the app's own timers may wait too: judge it on screen.
      if (env.page.hidden()) {
        armWatchdog(update);
        return;
      }
      putAside(update, 'did not settle');
      reloadWhenSaved();
    }, WATCHDOG_MS);
  }

  /** Starts the app; resolves once its script has run, or the .ipk's in its place. */
  function launch(): Promise<void> {
    return ready.then(launchNow);
  }

  function launchNow(): Promise<void> {
    const update = run;
    if (!update) return launchBuiltIn();
    return prepare(update)
      .then(({ manifest, bytes }) => {
        running = manifest;
        const ran = bytes ? env.page.runBytes(bytes) : env.page.runFile(manifest.launch);
        return ran.then(
          () => {
            if (!started) {
              putAside(update, 'threw at start');
              reloadWhenSaved();
              return;
            }
            if (!good) armWatchdog(update);
          },
          () => {
            // It never ran, so the .ipk's code can still start in this same load.
            putAside(update, 'did not load');
            return launchBuiltIn();
          },
        );
      })
      .catch((error: unknown) => {
        putAside(update, reasonOf(error));
        return launchBuiltIn();
      });
  }

  /** Deletes every stored update and file but what runs now and what waits to. */
  async function prune(): Promise<void> {
    const keep = [state.current, state.next !== 'built-in' ? state.next : null].filter(
      (info): info is UpdateInfo => info !== null,
    );
    const hashes: string[] = [];
    for (const info of keep) {
      const stored = await store.getUpdate(info.id);
      const manifest = stored ? (JSON.parse(stored.text) as Manifest) : null;
      for (const path of Object.keys(manifest?.files ?? {})) {
        hashes.push(manifest!.files[path]!.sha256);
      }
    }
    await store.keepOnly(
      keep.map((info) => info.id),
      hashes,
    );
  }

  /** A plain GET, with its body read inside the same time limit. */
  async function getWithin(
    url: string,
    ms: number,
  ): Promise<{ status: number; bytes: ArrayBuffer }> {
    const controller = new AbortController();
    const timer = env.setTimeout(() => controller.abort(), ms);
    try {
      // No header of our own and no credentials: from file:// that is a request with no preflight.
      const response = await env.fetch(url, {
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      return { status: response.status, bytes: await response.arrayBuffer() };
    } catch {
      throw new Error('network');
    } finally {
      env.clearTimeout(timer);
    }
  }

  async function download(manifest: Manifest): Promise<void> {
    const own = ownFiles(manifest);
    const have = await store.hasFiles(own.map(([, file]) => file.sha256));
    for (const [, file] of own) {
      if (have.has(file.sha256)) continue;
      const { status, bytes } = await getWithin(
        `${updates!.url}file/${file.sha256}`,
        FILE_TIMEOUT_MS,
      );
      if (status !== 200) throw new Error(`file ${status}`);
      if (bytes.byteLength !== file.size || (await sha256Hex(subtle, bytes)) !== file.sha256) {
        throw new Error('file');
      }
      await store.putFile(file.sha256, bytes);
    }
  }

  async function checkNow(): Promise<CheckState> {
    const query = `channel=${encodeURIComponent(updates!.channel)}&runtime=${encodeURIComponent(config.runtime)}`;
    const { status, bytes } = await getWithin(`${updates!.url}update?${query}`, ANSWER_TIMEOUT_MS);
    if (status === 204) return LATEST;
    if (status !== 200) throw new Error(`status ${status}`);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('answer');
    }
    const answer = readAnswer(body);
    if (!(await verified(answer))) throw new Error('signature');
    const signed = readSigned(answer.text, config);
    if (!isNewer(state, signed.createdAt, config.build.builtAt)) return LATEST;
    if (signed.type === BUILT_IN_TYPE || sameAsBuiltIn(signed.files, config.files)) {
      state = takeBuiltIn(state, signed.createdAt);
      save();
      return state.next === 'built-in' ? READY : LATEST;
    }
    if (state.bad.indexOf(signed.id) !== -1) return LATEST;
    if (state.current?.id === signed.id) return LATEST;
    if (state.next !== 'built-in' && state.next?.id === signed.id) return READY;
    setCheck({ kind: 'downloading', version: signed.version });
    await download(signed);
    await store.putUpdate({
      id: signed.id,
      text: answer.text,
      sig: answer.sig,
      keyId: answer.keyId,
    });
    state = takeUpdate(state, infoOf(signed));
    save();
    return READY;
  }

  /** With something waiting to start, starts again once the app has been off screen a while. */
  function restartWhenHidden(): void {
    env.clearTimeout(hiddenTimer);
    if (!on || state.next === null || !env.page.hidden()) return;
    hiddenTimer = env.setTimeout(() => {
      if (env.page.hidden() && state.next !== null) reloadWhenSaved();
    }, HIDDEN_RESTART_MS);
  }

  function check(): Promise<CheckState> {
    if (!on) return Promise.resolve(checkState);
    if (checking) return checking;
    if (env.now() - lastCheckAt < RECHECK_MS && checkState.kind !== 'failed') {
      return Promise.resolve(checkState);
    }
    setCheck({ kind: 'checking' });
    checking = ready
      .then(checkNow)
      .catch((error: unknown): CheckState => ({ kind: 'failed', reason: reasonOf(error) }))
      .then((result) => {
        checking = undefined;
        lastCheckAt = env.now();
        setCheck(result);
        restartWhenHidden();
        return result;
      });
    return checking;
  }

  if (on) {
    const every = () => {
      void check().then(() => {
        env.setTimeout(every, CHECK_EVERY_MS);
      });
    };
    env.setTimeout(every, FIRST_CHECK_MS);
    env.page.onVisibilityChange(restartWhenHidden);
  }

  const status = (): ShellStatus => ({
    running: running ? infoOf(running) : null,
    next: state.next,
    failed: state.failed,
    check: checkState,
  });

  const api: ShellApi = {
    contract: config.contract,
    runtime: config.runtime,
    build: config.build,
    updates: on,
    started() {
      started = true;
    },
    markGood() {
      if (good) return;
      good = true;
      env.clearTimeout(watchdog);
      if (!on) return;
      state = markGood(state);
      save();
      prune().catch((error: unknown) => env.warn(`[BannerTV] update prune: ${reasonOf(error)}`));
    },
    loadScript(path) {
      const own = running?.files[path];
      if (!running || !own || config.files[path]?.sha256 === own.sha256) {
        return env.page.runFile(path);
      }
      return storedFile(own.sha256).then(
        (bytes) => env.page.runBytes(bytes),
        (error: unknown) => {
          // Better the .ipk's copy than none.
          env.warn(`[BannerTV] update file ${path}: ${reasonOf(error)}`);
          return env.page.runFile(path);
        },
      );
    },
    status,
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at !== -1) listeners.splice(at, 1);
      };
    },
    check,
    restart: reloadWhenSaved,
  };
  return { api, launch };
}
