import { createStore, type Store } from '@bannertv/core';
import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * Whether a mounted screen is the one on show. The section root stays mounted,
 * hidden, while screens opened from it sit on top, so Back shows it again
 * without building it from scratch. A hidden screen must not answer Back or
 * the remote, so hooks that do read this.
 *
 * A store rather than a context value: screens learn about the change without
 * re-rendering, which would cost what keeping them mounted saves.
 */
export type ScreenSlot = Pick<Store<boolean>, 'get' | 'subscribe'>;

export function createScreenSlot(active: boolean): Store<boolean> {
  return createStore(active);
}

// Outside any screen (the rail, the welcome) everything is always on show.
const ALWAYS: ScreenSlot = createScreenSlot(true);

export const ScreenSlotContext = createContext<ScreenSlot>(ALWAYS);

export function useScreenSlot(): ScreenSlot {
  return useContext(ScreenSlotContext);
}

/** Re-renders the caller when its screen is shown or hidden. Keep callers small. */
export function useScreenActive(): boolean {
  const slot = useScreenSlot();
  return useSyncExternalStore(slot.subscribe, slot.get);
}
