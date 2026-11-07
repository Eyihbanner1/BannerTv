import {
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { takePendingFocus } from './router';
import { useScreenSlot } from './screen-slot';

/**
 * Puts focus on a screen when it is shown: back where it was if the user
 * returned with Back, otherwise on `defaultFocusKey`. Screens with nothing to
 * focus pass nothing, and focus stays in the rail. A screen whose content
 * arrives later passes `ready` false until it is drawn; focus is placed once
 * each time the screen is shown, whether it was just mounted or uncovered.
 *
 * Norigin queues focusable registration and setFocus in one task queue, so
 * this runs after the screen's own focusables exist even when they register
 * during a key press. Focus keys are deterministic, so the key saved on the
 * way in is usually still there on the way back. A screen whose content can
 * change while it is hidden (Home's Continue Watching) passes `fallBack`: if
 * what was focused has gone once the screen has drawn, focus goes to the
 * screen's `defaultFocusKey` as it is then. A screen that waits a while
 * passes `keep`: if it says the pointer has already put focus on the screen
 * meanwhile, a first showing leaves focus there. `onPlaced` is told each
 * time focus has been placed (or left with the pointer) on a showing.
 */
export function useScreenFocus(
  defaultFocusKey?: string,
  ready = true,
  fallBack = false,
  keep?: () => boolean,
  onPlaced?: () => void,
): void {
  const slot = useScreenSlot();
  const placed = useRef(false);
  const latestDefault = useRef(defaultFocusKey);
  const latestKeep = useRef(keep);
  const latestPlaced = useRef(onPlaced);
  useLayoutEffect(() => {
    latestDefault.current = defaultFocusKey;
    latestKeep.current = keep;
    latestPlaced.current = onPlaced;
  });
  useEffect(() => {
    const place = () => {
      if (!slot.get()) {
        placed.current = false;
        return;
      }
      if (!ready || placed.current) return;
      placed.current = true;
      const pending = takePendingFocus();
      if (pending === undefined && latestKeep.current?.()) {
        latestPlaced.current?.();
        return;
      }
      const target = pending ?? defaultFocusKey;
      if (!target) return;
      const focusing = Promise.resolve(setFocus(target));
      latestPlaced.current?.();
      if (!fallBack) return;
      // Norigin applies focus a step later, after the screen has drawn with what is new.
      void focusing.then(() => {
        const fallback = latestDefault.current;
        if (!slot.get() || !fallback || doesFocusableExist(getCurrentFocusKey())) return;
        void setFocus(fallback);
      });
    };
    place();
    return slot.subscribe(place);
  }, [defaultFocusKey, ready, fallBack, slot]);
}
