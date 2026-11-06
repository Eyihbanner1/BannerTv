/**
 * Facts about how the bundle was loaded, captured while it first runs.
 * `document.currentScript` is only set during a classic script's first run,
 * and is always null for module scripts, so this must be read at import time.
 */
const script = typeof document === 'undefined' ? null : document.currentScript;

/**
 * When the bundle started to run, in ms since the page began to load
 * (performance.now()). main.tsx imports this module first, so this is read
 * before any other module of the bundle runs.
 */
export const scriptAt =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;

export const bootInfo = {
  loadedAsClassicScript: script !== null,
  // Outside a page (unit tests) there is no script element to be.
  scriptSrc:
    typeof HTMLScriptElement !== 'undefined' && script instanceof HTMLScriptElement
      ? script.src
      : '',
  startedAt: Date.now(),
};

/**
 * How this page load began: `cold` when the app was started, `reload` when
 * the app started itself again with location.reload() (a profile switch, an
 * account join), else the navigation's own type, or `unknown`.
 */
export function launchKind(): string {
  try {
    const [navigation] = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[];
    if (!navigation) return 'unknown';
    return navigation.type === 'navigate' ? 'cold' : navigation.type;
  } catch {
    return 'unknown';
  }
}
