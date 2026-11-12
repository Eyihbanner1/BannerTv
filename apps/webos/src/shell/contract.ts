/**
 * What the LG app's loader (the shell, src/shell) and the app it starts agree
 * on. The loader ships inside the .ipk and can never change over the air, so
 * everything here is the fixed side of in-app updates (docs/adr, ADR 0001
 * decision 11; services/updates/README.md, "In-app updates on the LG").
 *
 * The .ipk's index.html carries a ShellConfig as JSON. loader.js reads it,
 * decides whether to start the app from the .ipk's own files or from an
 * update stored on the TV, and gives the app a ShellApi as
 * window.__BANNERTV_SHELL__. Only types and constants live here, so the
 * loader's bundle and the app's both take them without taking each other.
 */

/**
 * Raised when the ShellApi or what the loader expects of the app changes in a
 * way an older loader or app cannot take. It is part of the runtime version,
 * so an update built against another contract never reaches a loader of this
 * one.
 */
export const SHELL_CONTRACT = 1;

/** The id of index.html's script element holding the ShellConfig, as JSON. */
export const CONFIG_ELEMENT_ID = 'bannertv-shell';

/** Where the loader keeps which update to start, outside the app's own `bannertv.` keys. */
export const STATE_KEY = 'bannertv-ota:state';

/** The loader's IndexedDB database, beside the app's own `bannertv` and never mixed with it. */
export const DB_NAME = 'bannertv-ota';

/** The manifest of an update and the directive back to the built-in code, as signed. */
export const UPDATE_TYPE = 'bannertv-lg-update';
export const BUILT_IN_TYPE = 'bannertv-lg-built-in';

/** The one platform these updates are for: the LG app, not the Android TV app's copy. */
export const PLATFORM = 'webos';

/** One file an update or the .ipk carries: its SHA-256 in lower-case hex, and its size. */
export interface FileEntry {
  sha256: string;
  size: number;
}

/** What the build writes into index.html for the loader. */
export interface ShellConfig {
  contract: number;
  /**
   * Which updates this .ipk can take: a hash of everything an update cannot
   * change (the loader, index.html, appinfo.json but its version, the app's
   * database version, the update key). An update is only ever offered to the
   * runtime it was built with.
   */
  runtime: string;
  /** This .ipk's own build. */
  build: {
    /** Differs for every build, so the loader can tell a newly installed .ipk. */
    id: string;
    version: string;
    commit: string | null;
    /** When it was built, by the build machine's clock: older updates are never taken. */
    builtAt: string;
  };
  /** The app's script, relative to index.html. */
  launch: string;
  /** The files an update can replace (the app's script, the players, the sports data). */
  files: Record<string, FileEntry>;
  /** Null when this build takes no updates (a pull request's, a test build's, the store's). */
  updates: {
    channel: string;
    /** The updates Worker's LG address, ending in a slash: …/webos/. */
    url: string;
    /** The public key updates are signed with: RSA, SPKI, DER in base64. */
    key: string;
    /** Its fingerprint, which a signed answer names. */
    keyId: string;
  } | null;
}

/** An update as its signed manifest describes it. */
export interface Manifest {
  type: typeof UPDATE_TYPE;
  id: string;
  createdAt: string;
  channel: string;
  platform: typeof PLATFORM;
  runtime: string;
  version: string;
  commit: string | null;
  launch: string;
  files: Record<string, FileEntry>;
}

/** A signed order to go back to the .ipk's own code. */
export interface BuiltInDirective {
  type: typeof BUILT_IN_TYPE;
  createdAt: string;
  channel: string;
  platform: typeof PLATFORM;
  runtime: string;
}

/** An update, by what the app shows of it. */
export interface UpdateInfo {
  id: string;
  createdAt: string;
  version: string;
  commit: string | null;
}

/** What the last check found, or is doing. */
export type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string }
  /** Nothing newer than what the TV has. */
  | { kind: 'latest' }
  /** Something the TV will start next: an update, or its built-in code again. */
  | { kind: 'ready' }
  /** No answer, an answer out of form, a bad signature, a file that did not match. */
  | { kind: 'failed'; reason: string }
  /** This build takes no updates, or the TV cannot check signatures. */
  | { kind: 'off' };

/** What the app reads of the loader. */
export interface ShellStatus {
  /** The update running now, or null for the .ipk's own code. */
  running: UpdateInfo | null;
  /** What starts the next time the app starts: an update, the built-in code, or nothing new. */
  next: UpdateInfo | 'built-in' | null;
  /** An update that failed to start on this TV and was put aside, the latest one. */
  failed: UpdateInfo | null;
  check: CheckState;
}

/** window.__BANNERTV_SHELL__: what the loader gives the app. */
export interface ShellApi {
  contract: number;
  runtime: string;
  build: ShellConfig['build'];
  /** Whether this build takes updates and the TV can check their signatures. */
  updates: boolean;
  /** The app's script ran to its end without throwing. */
  started(): void;
  /** The app has drawn and settled: this start counts as a good one. */
  markGood(): void;
  /**
   * Runs one of the files an update can replace (vendor/hls.min.js, …) as a
   * classic script: the update's copy when it has its own, else the .ipk's.
   */
  loadScript(path: string): Promise<void>;
  status(): ShellStatus;
  /** Calls `listener` on every change of status(). */
  subscribe(listener: () => void): () => void;
  /** Asks the Worker now, unless a check is running already. */
  check(): Promise<CheckState>;
  /** Starts the app again, so that what status().next names runs. */
  restart(): void;
}

declare global {
  interface Window {
    __BANNERTV_SHELL__?: ShellApi;
  }
}
