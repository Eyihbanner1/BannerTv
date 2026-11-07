import type { FocusableComponent } from '@noriginmedia/norigin-spatial-navigation';

export const GRID_COLUMNS = 7;
/** Where tiles sit: a 220 by 330 poster and the gap after it. */
export const COLUMN_STEP = 220 + 24;
export const ROW_STEP = 330 + 40;

const TILE_PREFIX = 'discover-tile-';

export const gridTileKey = (index: number) => `${TILE_PREFIX}${index}`;

/** The remembered tile, if it is among those drawn. */
export function drawnGridTile(
  remembered: string | undefined,
  first: number,
  last: number,
): string | undefined {
  if (!remembered || remembered.indexOf(TILE_PREFIX) !== 0) return undefined;
  const index = Number(remembered.slice(TILE_PREFIX.length));
  return index >= first && index < last ? remembered : undefined;
}

/**
 * The arrows move between the grid's tiles by index, so spatial navigation
 * does not measure every drawn tile on each press. Each answer is the tile
 * its search by position picked: the next one along a row, the one above or
 * below, and at the end of a short last row the nearest one on the diagonal.
 * Null where it found none, which leaves the grid as before: Left from the
 * first column, Right from the last, Up from the top row drawn, Down from
 * the bottom one.
 *
 * Drawn rows are whole, apart from the last row of the catalog, so the tile
 * a press reaches is drawn whenever its row is.
 */
export function nextGridTile(
  direction: string,
  focusKey: string,
  siblings: FocusableComponent[],
): FocusableComponent | null {
  if (focusKey.indexOf(TILE_PREFIX) !== 0) return null;
  const index = Number(focusKey.slice(TILE_PREFIX.length));
  const column = index % GRID_COLUMNS;
  const drawn = (target: number): FocusableComponent | null => {
    const key = gridTileKey(target);
    for (const sibling of siblings) if (sibling.focusKey === key) return sibling;
    return null;
  };
  switch (direction) {
    case 'left':
      return column > 0 ? drawn(index - 1) : null;
    case 'right':
      if (column === GRID_COLUMNS - 1) return null;
      // Past the end of a short last row, up to the next column of the row above.
      return drawn(index + 1) ?? drawn(index + 1 - GRID_COLUMNS);
    case 'up':
      return drawn(index - GRID_COLUMNS);
    case 'down': {
      const below = drawn(index + GRID_COLUMNS);
      if (below) return below;
      // Over the gap after a short last row: its last tile, the nearest.
      const rowStart = index - column + GRID_COLUMNS;
      for (let target = index + GRID_COLUMNS - 1; target >= rowStart; target--) {
        const tile = drawn(target);
        if (tile) return tile;
      }
      return null;
    }
    default:
      return null;
  }
}
