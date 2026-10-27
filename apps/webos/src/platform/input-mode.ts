import { createStore } from '@bannertv/core';
import { movedByWheel } from '../navigation/spatial';

export type InputMode = 'keys' | 'pointer';

/** Whether the Magic Remote pointer (or a mouse) is showing. */
export const inputMode = createStore<InputMode>('keys');

interface CursorStateDetail {
  visibility: boolean;
}

const POINTER_CLASS = 'pointer-mode';

/**
 * Whether lists may slide to follow focus. With the arrows, yes. Under a
 * resting pointer, no, or a new tile would slide under it and take focus;
 * the wheel is the exception, since scrolling is what it asks for.
 */
export function canSlide(): boolean {
  return inputMode.get() === 'keys' || movedByWheel();
}

/**
 * On the TV, webOS fires cursorStateChange when the Magic Remote pointer
 * appears or hides (it hides as soon as an arrow key is pressed). Elsewhere a
 * mouse move turns pointer mode on and an arrow key turns it off.
 */
export function initInputMode(): void {
  inputMode.subscribe(() => {
    document.documentElement.classList.toggle(POINTER_CLASS, inputMode.get() === 'pointer');
  });

  document.addEventListener('cursorStateChange', (event) => {
    const detail = (event as CustomEvent<CursorStateDetail>).detail;
    inputMode.set(detail?.visibility ? 'pointer' : 'keys');
  });
  window.addEventListener(
    'mousemove',
    (event) => {
      // Chromium sends zero-distance moves when content slides under a still
      // pointer. Those must not steal focus from the remote.
      if (event.movementX !== 0 || event.movementY !== 0) inputMode.set('pointer');
    },
    // Capture runs before any element's handler, so the first move after the
    // arrows already counts as pointer input when it reaches a tile.
    { capture: true, passive: true },
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.keyCode >= 37 && event.keyCode <= 40) inputMode.set('keys');
    },
    { capture: true },
  );
}
