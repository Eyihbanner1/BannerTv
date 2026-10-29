import {
  arrangeBoard,
  type BoardRow,
  buildBoard,
  buildKidsBoard,
  type CatalogFilter,
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
 * hidden ones. Catalogs `leaveOut` names, such as the ones the Sports screen
 * shows, get no row. Null until `ready` and the profile's layout has been
 * read, so Home does not draw rows that then jump.
 */
export function useHomeBoard(
  addons: readonly InstalledAddon[],
  ready: boolean,
  leaveOut?: CatalogFilter,
): BoardRow[] | null {
  const layout = useSyncExternalStore(homeLayout.subscribe, readLayout);
  return useMemo(() => {
    if (!ready) return null;
    if (isKidsProfile()) {
      return buildKidsBoard(addons).filter((row) => !leaveOut?.(row.addon, row.catalog));
    }
    return layout ? arrangeBoard(buildBoard(addons, leaveOut), layout) : null;
  }, [addons, ready, leaveOut, layout]);
}
