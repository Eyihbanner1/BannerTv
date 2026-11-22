/**
 * Fills in what an older TV web engine lacks, before anything of the app
 * runs: main.tsx imports this module second, after boot.ts.
 *
 * The build is checked against Chromium 68, webOS 5.0's engine
 * (tools/scripts/check-bundle.mjs). Samsung's 2019 TVs (Tizen 5.0) run
 * Chromium 63, which parses the same ES2017 and has the ES2018 built-ins, but
 * not two web APIs the app leans on:
 *
 * - AbortController (Chromium 66). Every addon request makes one for its
 *   timeout, so without it nothing loads. The stand-in has a fetch that
 *   rejects with an AbortError when its signal aborts. The request itself runs
 *   on, as the old engine cannot stop it, and its answer is dropped.
 * - focus({ preventScroll }) (Chromium 64). Spatial navigation focuses each
 *   tile with it while rows move by transform; without it the browser would
 *   also scroll the row's box to show the tile, and the row would jump. The
 *   stand-in puts back any scroll the focus moved.
 *
 * Each is installed only where the engine lacks it, so on the LG, Android and
 * newer Samsung TVs this module does nothing.
 */

type Listener = (event: { type: string; target: unknown }) => void;

class LegacyAbortSignal {
  aborted = false;
  reason: unknown = undefined;
  onabort: Listener | null = null;
  private listeners: Listener[] = [];

  addEventListener(type: string, listener: Listener): void {
    if (type === 'abort' && this.listeners.indexOf(listener) === -1) this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === 'abort') this.listeners = this.listeners.filter((each) => each !== listener);
  }

  /** Called by its controller once. */
  fire(reason: unknown): void {
    this.aborted = true;
    this.reason = reason;
    const event = { type: 'abort', target: this };
    this.onabort?.call(this, event);
    for (const listener of this.listeners.slice()) listener.call(this, event);
  }
}

class LegacyAbortController {
  readonly signal = new LegacyAbortSignal();

  abort(reason?: unknown): void {
    if (!this.signal.aborted) this.signal.fire(reason === undefined ? abortError() : reason);
  }
}

function abortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}

interface LegacyWindow {
  AbortController?: unknown;
  AbortSignal?: unknown;
  fetch?: typeof fetch;
}

/**
 * Puts an AbortController on `win` where it has none, with a fetch that
 * honours its signal. Returns whether it did.
 */
export function installAbortController(win: LegacyWindow): boolean {
  if (typeof win.AbortController === 'function') return false;
  win.AbortController = LegacyAbortController;
  win.AbortSignal = LegacyAbortSignal;
  const nativeFetch = win.fetch;
  if (typeof nativeFetch !== 'function') return true;
  win.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal as unknown as LegacyAbortSignal | undefined;
    if (!(signal instanceof LegacyAbortSignal)) return nativeFetch.call(win, input, init);
    if (signal.aborted) return Promise.reject(signal.reason);
    // The old engine knows no signal: it is kept out of what fetch is given.
    const rest: RequestInit = {};
    for (const key of Object.keys(init!) as Array<keyof RequestInit>) {
      if (key !== 'signal') (rest as Record<string, unknown>)[key] = init![key];
    }
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort);
      nativeFetch.call(win, input, rest).then(
        (response) => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  } as typeof fetch;
  return true;
}

/** Whether focus() reads its options: a getter on preventScroll runs only if it does. */
function focusTakesOptions(probe: HTMLElement): boolean {
  let read = false;
  try {
    probe.focus({
      get preventScroll() {
        read = true;
        return true;
      },
    });
  } catch {
    // An engine that throws on the argument reads nothing.
  }
  return read;
}

interface FocusablePrototype {
  focus(this: HTMLElement, options?: FocusOptions): void;
}

/**
 * Makes `focus({ preventScroll: true })` keep every scroll where it was, on
 * an engine whose focus() ignores its options. Returns whether it did.
 */
export function installFocusPreventScroll(
  proto: FocusablePrototype,
  probe: HTMLElement,
  win: Pick<Window, 'pageXOffset' | 'pageYOffset' | 'scrollTo'>,
): boolean {
  if (focusTakesOptions(probe)) return false;
  const original = proto.focus;
  proto.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (!options || !options.preventScroll) {
      original.call(this);
      return;
    }
    const kept: Array<[Element, number, number]> = [];
    for (let node = this.parentElement; node; node = node.parentElement) {
      kept.push([node, node.scrollTop, node.scrollLeft]);
    }
    const x = win.pageXOffset;
    const y = win.pageYOffset;
    original.call(this);
    for (const [node, top, left] of kept) {
      if (node.scrollTop !== top) node.scrollTop = top;
      if (node.scrollLeft !== left) node.scrollLeft = left;
    }
    if (win.pageXOffset !== x || win.pageYOffset !== y) win.scrollTo(x, y);
  };
  return true;
}

/** Everything above, on the page. Off a page (unit tests) it does nothing. */
export function installLegacyPolyfills(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  installAbortController(window as unknown as LegacyWindow);
  if (typeof HTMLElement !== 'undefined') {
    installFocusPreventScroll(HTMLElement.prototype, document.createElement('div'), window);
  }
}

installLegacyPolyfills();
