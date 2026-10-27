import { useEffect, useRef } from 'react';
import { type BackHandler, type BackLayer, backStack } from './back';

/** Registers a Back handler while the component is mounted. */
export function useBack(layer: BackLayer, handler: BackHandler, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return backStack.push(layer, () => latest.current());
  }, [layer, enabled]);
}
