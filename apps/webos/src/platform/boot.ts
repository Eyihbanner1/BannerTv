/**
 * Facts about how the bundle was loaded, captured while it first runs.
 * `document.currentScript` is only set during a classic script's first run,
 * and is always null for module scripts, so this must be read at import time.
 */
const script = typeof document === 'undefined' ? null : document.currentScript;

export const bootInfo = {
  loadedAsClassicScript: script !== null,
  scriptSrc: script instanceof HTMLScriptElement ? script.src : '',
  startedAt: Date.now(),
};
