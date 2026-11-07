import {
  arrangeBoard,
  type BoardRow,
  buildBoard,
  buildKidsBoard,
  type CatalogFilter,
  CONTINUE_LINE,
  EMPTY_LAYOUT,
  type HomeLayout,
  homeLines,
  type InstalledAddon,
  LIVE_SPORT_LINE,
  MY_LIST_LINE,
  type OwnLine,
  ownLinePlaces,
} from '@bannertv/core';
import { useMemo, useSyncExternalStore } from 'react';
import { homeLayout } from './library';
import { isKidsProfile } from './profiles';

const readLayout = (): HomeLayout | null => (homeLayout.loaded() ? homeLayout.get() : null);

/**
 * Until it is moved in Settings > Home rows, the Live sport row is the third
 * row on Home, counting Continue Watching but not My List.
 */
const LIVE_SPORT_PLACE = 2;

/**
 * Home's own lines and where each sits until it is moved: Continue Watching
 * first (it can be hidden, not moved), My List under it, and Live sport,
 * while a sports addon is installed, third.
 */
export function homeOwnLines(sportShown: boolean, continueFilled: boolean): OwnLine[] {
  const lines: OwnLine[] = [
    { id: CONTINUE_LINE, place: 0, fixed: true },
    { id: MY_LIST_LINE, place: 0 },
  ];
  if (sportShown) {
    lines.push({
      id: LIVE_SPORT_LINE,
      place: Math.max(0, LIVE_SPORT_PLACE - (continueFilled ? 1 : 0)),
    });
  }
  return lines;
}

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

/**
 * Where Home draws its own lines (Continue Watching, Live sport, My List)
 * among the rows of useHomeBoard: for each one shown, how many of those rows
 * come before it. One hidden in Settings > Home rows is left out. A kids
 * profile has no layout of its own, so each sits at its place.
 */
export function useOwnLinePlaces(
  addons: readonly InstalledAddon[],
  ready: boolean,
  own: readonly OwnLine[],
  leaveOut?: CatalogFilter,
): Map<string, number> {
  const layout = useSyncExternalStore(homeLayout.subscribe, readLayout);
  return useMemo(() => {
    const kids = isKidsProfile();
    const rows = !ready
      ? []
      : kids
        ? buildKidsBoard(addons).filter((row) => !leaveOut?.(row.addon, row.catalog))
        : buildBoard(addons, leaveOut);
    return ownLinePlaces(homeLines(rows, kids ? EMPTY_LAYOUT : (layout ?? EMPTY_LAYOUT), own));
  }, [addons, ready, leaveOut, layout, own]);
}
