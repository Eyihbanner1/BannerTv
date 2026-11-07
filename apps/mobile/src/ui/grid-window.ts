/**
 * How much of a poster grid is drawn ahead. Once a FlatList has columns it counts
 * initialNumToRender and its batches in rows, not tiles, so the first render is set in tiles
 * here and turned into rows.
 */

/** Posters drawn in the first render: about one phone screen, seven rows of three. */
export const FIRST_RENDER_TILES = 21;

/**
 * Screens of posters kept drawn, the one in view included, as Home's list keeps: about three
 * below and three above. FlatList's default of 21 drew ten screens ahead, which is every poster
 * of a catalog's first page and about 190 of My List, each with its own download and decode.
 */
export const GRID_WINDOW_SCREENS = 7;

/** The rows that hold `tiles` posters, `columns` to a row; never fewer than one. */
export function rowsForTiles(tiles: number, columns: number): number {
  return Math.max(1, Math.ceil(tiles / Math.max(1, columns)));
}
