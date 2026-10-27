import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';
import { takePendingFocus } from './router';

/**
 * Puts focus on a screen when it mounts: back where it was if the user
 * returned with Back, otherwise on `defaultFocusKey`. Screens with nothing to
 * focus pass nothing, and focus stays in the rail.
 *
 * Norigin queues focusable registration and setFocus in one task queue, so
 * this runs after the screen's own focusables exist even when they register
 * during a key press. Focus keys are deterministic, so the key saved on the
 * way in is still there on the way back.
 */
export function useScreenFocus(defaultFocusKey?: string): void {
  useEffect(() => {
    const target = takePendingFocus() ?? defaultFocusKey;
    if (target) void setFocus(target);
  }, [defaultFocusKey]);
}
