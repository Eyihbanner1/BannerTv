import { reloadAppAsync } from 'expo';
import * as ExpoCrypto from 'expo-crypto';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Stand-ins for the browser globals the shared web modules (apps/webos/src) read, handed to
 * them one module at a time by build/web-globals-plugin.js; nothing here is global. They keep the
 * browser's meaning where it matters to those modules:
 *
 * - localStorage is persistent and synchronous (SQLite).
 * - sessionStorage, window.name and the address's hash survive the app starting again
 *   (location.reload(), which a profile switch and an account join use) but not the app closing,
 *   as a page's do across a reload.
 * - document.hidden follows the app going to the background and back.
 */

type Listener = (event: { type: string }) => void;

class Listeners {
  private readonly byType = new Map<string, Set<Listener>>();

  add(type: string, listener: Listener): void {
    let set = this.byType.get(type);
    if (!set) {
      set = new Set();
      this.byType.set(type, set);
    }
    set.add(listener);
  }

  remove(type: string, listener: Listener): void {
    this.byType.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of Array.from(this.byType.get(type) ?? [])) {
      try {
        listener({ type });
      } catch (error) {
        console.warn('[BannerTV] listener failed:', String(error));
      }
    }
  }
}

/** The Web Storage interface over one SQLite key-value database. */
class SqliteWebStorage {
  constructor(private readonly db: SQLiteStorage) {}

  get length(): number {
    return this.db.getLengthSync();
  }

  key(index: number): string | null {
    return this.db.getKeyByIndexSync(index);
  }

  getItem(key: string): string | null {
    return this.db.getItemSync(key);
  }

  setItem(key: string, value: string): void {
    this.db.setItemSync(key, String(value));
  }

  removeItem(key: string): void {
    this.db.removeItemSync(key);
  }

  clear(): void {
    this.db.clearSync();
  }
}

const sessionDb = new SQLiteStorage('bannertv-session.db');

// Written just before the app starts itself again. A launch that finds it recent is that start
// (keep the session); any other launch is a fresh one (forget the last run's session).
const RELOADING = '__bannertv.reloading';
const RELOAD_WINDOW_MS = 60_000;
const NAME_KEY = '__bannertv.window.name';
const HASH_KEY = '__bannertv.location.hash';

function startSession(): void {
  try {
    const marked = Number(sessionDb.getItemSync(RELOADING));
    const reloaded = marked > 0 && Math.abs(Date.now() - marked) < RELOAD_WINDOW_MS;
    if (reloaded) sessionDb.removeItemSync(RELOADING);
    else sessionDb.clearSync();
  } catch (error) {
    console.warn('[BannerTV] session storage unavailable:', String(error));
  }
}
startSession();

export const localStorage = new SqliteWebStorage(new SQLiteStorage('bannertv-local.db'));

class SessionWebStorage extends SqliteWebStorage {
  // The stand-ins for window.name and the hash live in the same database, out of sight.
  override get length(): number {
    return this.keys().length;
  }

  override key(index: number): string | null {
    return this.keys()[index] ?? null;
  }

  override clear(): void {
    for (const key of this.keys()) this.removeItem(key);
  }

  private keys(): string[] {
    return sessionDb.getAllKeysSync().filter((key) => key.indexOf('__bannertv.') !== 0);
  }
}

export const sessionStorage = new SessionWebStorage(sessionDb);

function readSession(key: string): string {
  try {
    return sessionDb.getItemSync(key) ?? '';
  } catch {
    return '';
  }
}

function writeSession(key: string, value: string): void {
  try {
    if (value) sessionDb.setItemSync(key, value);
    else sessionDb.removeItemSync(key);
  } catch {
    // Lost on the next start, as a page's would be without storage.
  }
}

const location = {
  pathname: '/',
  search: '',
  get hash(): string {
    return readSession(HASH_KEY);
  },
  set hash(value: string) {
    const text = String(value);
    writeSession(HASH_KEY, text === '' || text === '#' ? '' : text[0] === '#' ? text : `#${text}`);
  },
  get href(): string {
    return `bannertv://app/${this.hash}`;
  },
  /** Starts the app again, keeping the session as a page reload keeps it. */
  reload(): void {
    try {
      sessionDb.setItemSync(RELOADING, String(Date.now()));
    } catch {
      // Starts as a fresh launch instead: the profile picker asks again.
    }
    reloadAppAsync('BannerTV starts again').catch((error: unknown) => {
      console.warn('[BannerTV] could not start again:', String(error));
    });
  },
};

export const history = {
  /** The shared modules only use this to take the hash back out of the address. */
  replaceState(_state: unknown, _title: string, url?: string): void {
    if (url !== undefined && url.indexOf('#') === -1) location.hash = '';
  },
};

const appState = { status: AppState.currentState as AppStateStatus | null };
const documentListeners = new Listeners();
const windowListeners = new Listeners();

function hidden(): boolean {
  return appState.status === 'background';
}

AppState.addEventListener('change', (next) => {
  const wasHidden = hidden();
  appState.status = next;
  if (hidden() === wasHidden) return;
  if (hidden()) windowListeners.dispatch('pagehide');
  documentListeners.dispatch('visibilitychange');
});

export const document = {
  get hidden(): boolean {
    return hidden();
  },
  get visibilityState(): 'hidden' | 'visible' {
    return hidden() ? 'hidden' : 'visible';
  },
  /** A phone has no focused DOM element; text fields tell the app themselves (typing.ts). */
  activeElement: null,
  addEventListener(type: string, listener: Listener): void {
    documentListeners.add(type, listener);
  },
  removeEventListener(type: string, listener: Listener): void {
    documentListeners.remove(type, listener);
  },
};

export const window = {
  location,
  history,
  localStorage,
  sessionStorage,
  get name(): string {
    return readSession(NAME_KEY);
  },
  set name(value: string) {
    writeSession(NAME_KEY, String(value));
  },
  crypto: {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      return ExpoCrypto.getRandomValues(array as never) as T;
    },
  },
  setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout> | undefined) => clearTimeout(id),
  setInterval: (handler: () => void, ms?: number) => setInterval(handler, ms),
  clearInterval: (id: ReturnType<typeof setInterval> | undefined) => clearInterval(id),
  addEventListener(type: string, listener: Listener): void {
    windowListeners.add(type, listener);
  },
  removeEventListener(type: string, listener: Listener): void {
    windowListeners.remove(type, listener);
  },
  dispatchEvent(event: { type: string }): boolean {
    windowListeners.dispatch(event.type);
    return true;
  },
};
