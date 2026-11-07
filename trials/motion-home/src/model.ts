/**
 * What Home shows and where everything sits, shared by both drawing modes so
 * the comparison is like for like. Plain data and arithmetic: no DOM, no WebGL.
 */

export type Shape = 'poster' | 'landscape';

export interface Title {
  id: string;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  /** Year, runtime or similar, shown under the hero title. */
  info?: string;
}

export interface HomeRow {
  key: string;
  title: string;
  shape: Shape;
  items: Title[];
}

/** Layout for a 1920x1080 page, matching the app's tiles (Row.tsx, Tile.module.css). */
export const LAYOUT = {
  width: 1920,
  height: 1080,
  /** Left edge of the rows and of the focused tile. */
  left: 120,
  /** Top of the focused row: the hero fills the screen above it. */
  rowsTop: 600,
  rowTitleHeight: 52,
  rowGap: 40,
  tileGap: 24,
  tile: {
    poster: { w: 220, h: 330 },
    landscape: { w: 384, h: 216 },
  },
  focusScale: 1.08,
  radius: 16,
  /** Motion, in ms. Short enough to keep up with a held arrow. */
  slideMs: 220,
  zoomMs: 160,
  heroFadeMs: 320,
  /** Focus must rest this long before the hero changes. */
  heroDelayMs: 300,
} as const;

export function tileSize(shape: Shape): { w: number; h: number } {
  return LAYOUT.tile[shape];
}

/** Distance from one tile's left edge to the next. */
export function tileStep(shape: Shape): number {
  return tileSize(shape).w + LAYOUT.tileGap;
}

/** Height a row takes, title included. */
export function rowHeight(shape: Shape): number {
  return LAYOUT.rowTitleHeight + tileSize(shape).h + LAYOUT.rowGap;
}

/** Top of each row inside the rows track, which slides as a whole. */
export function rowOffsets(rows: readonly HomeRow[]): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const row of rows) {
    tops.push(y);
    y += rowHeight(row.shape);
  }
  return tops;
}

export interface Focus {
  row: number;
  /** The focused column of every row, so coming back to a row lands where it was left. */
  cols: number[];
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export function initialFocus(rows: readonly HomeRow[]): Focus {
  return { row: 0, cols: rows.map(() => 0) };
}

/** The focus after an arrow press, or the same object when the press goes nowhere. */
export function move(focus: Focus, rows: readonly HomeRow[], direction: Direction): Focus {
  const row = rows[focus.row];
  if (!row) return focus;
  const col = focus.cols[focus.row] ?? 0;
  switch (direction) {
    case 'left':
      if (col === 0) return focus;
      return withCol(focus, col - 1);
    case 'right':
      if (col >= row.items.length - 1) return focus;
      return withCol(focus, col + 1);
    case 'up':
      if (focus.row === 0) return focus;
      return { row: focus.row - 1, cols: focus.cols };
    case 'down':
      if (focus.row >= rows.length - 1) return focus;
      return { row: focus.row + 1, cols: focus.cols };
  }
}

function withCol(focus: Focus, col: number): Focus {
  const cols = focus.cols.slice();
  cols[focus.row] = col;
  return { row: focus.row, cols };
}

export function focusedTitle(focus: Focus, rows: readonly HomeRow[]): Title | undefined {
  const row = rows[focus.row];
  return row ? row.items[focus.cols[focus.row] ?? 0] : undefined;
}

/** Where the rows track sits so the focused row's top is at `rowsTop`. */
export function trackY(focus: Focus, offsets: readonly number[]): number {
  return LAYOUT.rowsTop - (offsets[focus.row] ?? 0);
}

/** Where a row's tiles sit so its focused tile stays at the left edge. */
export function tilesX(col: number, shape: Shape): number {
  return LAYOUT.left - col * tileStep(shape);
}
