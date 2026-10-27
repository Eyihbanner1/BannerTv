import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef } from 'react';
import { takePendingFocus } from './router';

/**
 * Puts focus on a screen when it mounts: back where it was if the user
 * returned with Back, otherwise on `defaultFocusKey`. Screens with nothing to
 * focus pass nothing, and focus stays in the rail. A screen whose content
 * arrives later passes `ready` false until it is drawn; focus is placed once.
 *
 * Norigin queues focusable registration and setFocus in one task queue, so
 * this runs after the screen's own focusables exist even when they register
 * during a key press. Focus keys are deterministic, so the key saved on the
 * way in is still there on the way back.
 */
export function useScreenFocus(defaultFocusKey?: string, ready = true): void {
  const placed = useRef(false);
  useEffect(() => {
    if (!ready || placed.current) return;
    placed.current = true;
    const target = takePendingFocus() ?? defaultFocusKey;
    if (target) void setFocus(target);
  }, [defaultFocusKey, ready]);
}
