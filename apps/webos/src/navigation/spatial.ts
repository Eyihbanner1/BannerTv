import { init, navigateByDirection, setKeyMap } from '@noriginmedia/norigin-spatial-navigation';
import { backStack } from './back';
import { timeBack } from './back-timing';
import { isBackKey, SPATIAL_KEY_MAP } from './keys';

const WHEEL_STEP_MS = 150;
// A focus change this soon after a wheel notch came from the wheel.
const WHEEL_INTENT_MS = 400;
let lastWheel = 0;

/** Whether the latest focus move came from the Magic Remote wheel. */
export function movedByWheel(): boolean {
  return Date.now() - lastWheel < WHEEL_INTENT_MS;
}

export function initNavigation(): void {
  init({
    // Holding an arrow moves at most once per 100 ms, so key repeat never queues up.
    throttle: 100,
    throttleKeypresses: true,
    // Real DOM focus lets LG Audio Guidance read aria-labels and opens the
    // on-screen keyboard on inputs. Rows scroll by transform, never by the browser.
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: true },
  });
  setKeyMap(SPATIAL_KEY_MAP);

  window.addEventListener('keydown', (event) => {
    if (!isBackKey(event)) return;
    event.preventDefault();
    // A long press is the system's: it exits to the Home launcher.
    if (event.repeat) return;
    backStack.handle();
    timeBack(event);
  });

  // The Magic Remote wheel moves one row per notch.
  window.addEventListener(
    'wheel',
    (event) => {
      const now = Date.now();
      if (event.deltaY === 0 || now - lastWheel < WHEEL_STEP_MS) return;
      lastWheel = now;
      void navigateByDirection(event.deltaY > 0 ? 'down' : 'up');
    },
    { passive: true },
  );
}
