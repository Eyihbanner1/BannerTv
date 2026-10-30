import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { KeyCode } from './keys';

/** A click this soon after OK is the same press. */
const CLICK_AFTER_OK_MS = 400;
let answeredAt = -Infinity;

/**
 * In pointer mode the Magic Remote OK can come as a key press and then a
 * click where the pointer is. Whatever answered the key press calls this, so
 * the click does not press a second thing: one the key press has just
 * brought up under the pointer, say. A key press nothing answered, such as
 * one a text box took, leaves the click to press what the pointer is on.
 */
export function answeredOk(): void {
  answeredAt = Date.now();
}

/** Whether a click now came with an OK that something has answered already. */
export function clickCameWithOk(): boolean {
  return Date.now() - answeredAt <= CLICK_AFTER_OK_MS;
}

// Counted as spatial navigation counts a held key: up again on its key up.
let okDowns = 0;
let okDownOn: string | null = null;

/** Notes what had focus when OK went down, so a held OK's repeats press only that. */
export function watchOkHold(): void {
  const options = { capture: true, passive: true };
  // Capturing, so this runs before spatial navigation moves focus for the key.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.keyCode !== KeyCode.Ok) return;
      okDowns += 1;
      if (okDowns === 1) okDownOn = getCurrentFocusKey() || null;
    },
    options,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.keyCode !== KeyCode.Ok) return;
      okDowns = 0;
      okDownOn = null;
    },
    options,
  );
}

/** The focus key that had focus when the OK being held went down. */
export function okWentDownOn(): string | null {
  return okDownOn;
}
