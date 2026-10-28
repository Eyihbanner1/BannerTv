import {
  arrangeBoard,
  type BoardRow,
  buildBoard,
  buildKidsBoard,
  type HomeLayout,
  type InstalledAddon,
} from '@bannertv/core';
import { useMemo, useSyncExternalStore } from 'react';
import { homeLayout } from './library';
import { isKidsProfile } from './profiles';

const readLayout = (): HomeLayout | null => (homeLayout.loaded() ? homeLayout.get() : null);

/**
 * Home's rows for the profile in use: a kids profile gets Family rows only;
 * anyone else gets every row in the order chosen in Settings, without the
 * hidden ones. Null until the profile's layout has been read, so Home does
 * not draw rows that then jump.
 */
export function useHomeBoard(addons: readonly InstalledAddon[]): BoardRow[] | null {
  const layout = useSyncExternalStore(homeLayout.subscribe, readLayout);
  return useMemo(() => {
    if (isKidsProfile()) return buildKidsBoard(addons);
    return layout ? arrangeBoard(buildBoard(addons), layout) : null;
  }, [addons, layout]);
}
