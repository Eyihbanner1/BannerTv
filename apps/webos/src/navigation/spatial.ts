import {
  BaseWebAdapter,
  type FocusableComponent,
  getCurrentFocusKey,
  init,
  navigateByDirection,
  setKeyMap,
} from '@noriginmedia/norigin-spatial-navigation';
import { markActivity } from './activity';
import { backStack } from './back';
import { timeBack } from './back-timing';
import { isBackKey, SPATIAL_KEY_MAP } from './keys';

const WHEEL_STEP_MS = 150;
// A focus change this soon after a wheel notch came from the wheel.
const WHEEL_INTENT_MS = 400;
let lastWheel = 0;

/**
 * The focused key, or '' before anything has had focus: spatial navigation
 * returns null then, whatever its type says.
 */
export function focusedKey(): string {
  return getCurrentFocusKey() || '';
}

/** Whether the latest focus move came from the Magic Remote wheel. */
export function movedByWheel(): boolean {
  return Date.now() - lastWheel < WHEEL_INTENT_MS;
}

/**
 * Spatial navigation measures every focusable as it is added and focused,
 * each a forced layout. A row's tiles never need it: the row moves between
 * them by index, and Up and Down leave the row as a whole. So a tile inside a
 * row (marked `data-row-key`) is not measured, which spares a dozen forced
 * layouts each time a row is drawn. The row itself still is.
 */
class RowTileAdapter extends BaseWebAdapter {
  constructor(service: ConstructorParameters<typeof BaseWebAdapter>[0]) {
    super(service);
    const measure = this.measureLayout;
    this.measureLayout = (component: FocusableComponent) => {
      const { node } = component;
      const row = node && node.parentElement ? node.parentElement.closest('[data-row-key]') : null;
      if (!row) return measure(component);
      return Promise.resolve({
        node,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      });
    };
  }
}

export function initNavigation(): void {
  init({
    // Holding an arrow moves at most once per 100 ms, so key repeat never
    // queues up. Separate presses all count: throttling them too would drop
    // the presses a busy TV delivers together after a pause.
    throttle: 100,
    throttleKeypresses: false,
    // Real DOM focus lets LG Audio Guidance read aria-labels and opens the
    // on-screen keyboard on inputs. Rows scroll by transform, never by the browser.
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: true },
    layoutAdapter: RowTileAdapter,
  });
  setKeyMap(SPATIAL_KEY_MAP);

  window.addEventListener('keydown', markActivity, { capture: true, passive: true });

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
      markActivity();
      void navigateByDirection(event.deltaY > 0 ? 'down' : 'up');
    },
    { passive: true },
  );
}
