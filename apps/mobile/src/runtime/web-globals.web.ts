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
};

export const window = real.window;
export const document = real.document;
export const localStorage = real.localStorage;
export const sessionStorage = real.sessionStorage;
export const history = real.history;
