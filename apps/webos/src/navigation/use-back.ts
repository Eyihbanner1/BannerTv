import { useEffect, useRef } from 'react';
import { useScreenSlot } from '../app/screen-slot';
import { type BackHandler, type BackLayer, backStack } from './back';

/**
 * Registers a Back handler while the component is mounted and its screen is
 * on show. A screen kept mounted under another one does not answer Back.
 */
export function useBack(layer: BackLayer, handler: BackHandler, enabled = true): void {
  const latest = useRef(handler);
  const slot = useScreenSlot();
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    let release: (() => void) | undefined;
    const sync = () => {
      if (slot.get()) {
        if (!release) release = backStack.push(layer, () => latest.current());
      } else if (release) {
        release();
        release = undefined;
      }
    };
    sync();
    const unsubscribe = slot.subscribe(sync);
    return () => {
      unsubscribe();
      release?.();
    };
  }, [layer, enabled, slot]);
}
