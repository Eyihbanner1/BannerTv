/**
 * In the web build (used for tests and development) the shared web modules get the real browser
 * globals. See web-globals.ts for the phone.
 */
const real = globalThis as unknown as {
  window: Window;
  document: Document;
  localStorage: Storage;
  sessionStorage: Storage;
  history: History;
  Event: typeof globalThis.Event;
  CustomEvent: typeof globalThis.CustomEvent;
  KeyboardEvent: typeof globalThis.KeyboardEvent;
  HTMLMediaElement: typeof globalThis.HTMLMediaElement;
  TextDecoder: typeof globalThis.TextDecoder;
};

export const window = real.window;
export const document = real.document;
export const localStorage = real.localStorage;
export const sessionStorage = real.sessionStorage;
export const history = real.history;
export const Event = real.Event;
export const CustomEvent = real.CustomEvent;
export const KeyboardEvent = real.KeyboardEvent;
export const HTMLMediaElement = real.HTMLMediaElement;
export const TextDecoder = real.TextDecoder;

/** Starts the page again; a page keeps its session across a reload by itself. */
export function startAgain(
  restart: () => Promise<void> = async () => real.window.location.reload(),
): Promise<void> {
  return restart().catch((error: unknown) => {
    console.warn('[BannerTV] could not start again:', String(error));
  });
}
