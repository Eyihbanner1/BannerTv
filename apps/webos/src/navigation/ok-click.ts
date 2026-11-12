import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { KeyCode } from './keys';

/** A click this soon after OK is the same press. */
const CLICK_AFTER_OK_MS = 400;
let answeredAt = -Infinity;

/** The page's own clock, which a TV setting its time cannot move back. */
const now = () => performance.now();

/**
 * In pointer mode the Magic Remote OK can come as a key press and then a
 * click where the pointer is. Whatever answered the key press calls this, so
 * the click does not press a second thing: one the key press has just
 * brought up under the pointer, say. A key press nothing answered, such as
 * one a text box took, leaves the click to press what the pointer is on.
 */
export function answeredOk(): void {
  answeredAt = now();
}

// Counted as spatial navigation counts a held key: up again on its key up.
let okDowns = 0;
let okDownOn: string | null = null;
let okDownAt = -Infinity;

/**
 * Whether a click now came with an OK that something has answered already:
 * one still held down (a hold answers as OK goes down, though it acts only
 * when OK comes up or the hold fires), or one just let go. Not when a later
 * OK went down that nothing answered: the click is that one's, and presses
 * what the pointer is on.
 */
export function clickCameWithOk(): boolean {
  if (okDownAt > answeredAt) return false;
  if (okDowns > 0) return true;
  return now() - answeredAt <= CLICK_AFTER_OK_MS;
}

/** Notes what had focus when OK went down, so a held OK's repeats press only that. */
export function watchOkHold(): void {
  const options = { capture: true, passive: true };
  // Capturing, so this runs before spatial navigation moves focus for the key.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.keyCode !== KeyCode.Ok) return;
      okDowns += 1;
      if (okDowns !== 1) return;
      okDownOn = getCurrentFocusKey() || null;
      okDownAt = now();
    },
    options,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.keyCode !== KeyCode.Ok) return;
      // Its click can come as it is let go, however long it was held.
      if (okDowns > 0 && answeredAt >= okDownAt) answeredAt = now();
      letGo();
    },
    options,
  );
  // OK can open another app (YouTube, for a trailer), which then has its key up.
  // Left counted as down, it would take every later click as part of that press.
  window.addEventListener('blur', letGo);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) letGo();
    });
  }
}

function letGo(): void {
  okDowns = 0;
  okDownOn = null;
}

/**
 * Whether the OK being held went down before `time` (the page's clock,
 * `performance.now()`): a hold from before something showed, which its
 * repeats must not press, though it has the focus key of what was there.
 */
export function okDownBefore(time: number): boolean {
  return okDowns > 0 && okDownAt < time;
}

/** The focus key that had focus when the OK being held went down. */
export function okWentDownOn(): string | null {
  return okDownOn;
}
