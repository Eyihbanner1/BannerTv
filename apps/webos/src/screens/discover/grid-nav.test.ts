import {
  type FocusableComponent,
  type FocusableComponentLayout,
  SpatialNavigationService,
} from '@noriginmedia/norigin-spatial-navigation';
import { describe, expect, it } from 'vitest';
import {
  COLUMN_STEP,
  drawnGridTile,
  GRID_COLUMNS,
  gridTileKey,
  nextGridTile,
  ROW_STEP,
} from './grid-nav';

// A poster tile's size (Tile.module.css), and somewhere for the grid to start on the page.
const TILE_WIDTH = 220;
const TILE_HEIGHT = 330;
const GRID_LEFT = 252;
const GRID_TOP = 220;
const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;

/** Where a drawn tile sits, as spatial navigation measures it: offsets ignore the track's slide. */
function layoutOf(index: number): FocusableComponentLayout {
  const left = GRID_LEFT + (index % GRID_COLUMNS) * COLUMN_STEP;
  const top = GRID_TOP + Math.floor(index / GRID_COLUMNS) * ROW_STEP;
  return {
    x: left - GRID_LEFT,
    y: top - GRID_TOP,
    left,
    top,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    right: left + TILE_WIDTH,
    bottom: top + TILE_HEIGHT,
    node: null as unknown as HTMLElement,
  };
}

interface Internals {
  enabled: boolean;
  focusKey: string | null;
  focusableComponents: Record<string, unknown>;
  layoutAdapter: { measureLayout: (component: FocusableComponent) => unknown };
  setImmediateFocus: (focusKey: string) => void;
  smartNavigate: (direction: string, fromParentFocusKey: string | null, details: object) => unknown;
  getNextFocusKey: (targetFocusKey: string) => Promise<string>;
}

/** Spatial navigation with the grid's drawn tiles, and anything else in the grid, laid out. */
function service(drawn: readonly number[], others: Record<string, FocusableComponentLayout> = {}) {
  const navigation = new SpatialNavigationService() as unknown as Internals;
  const add = (focusKey: string, parentFocusKey: string, layout: FocusableComponentLayout) => {
    navigation.focusableComponents[focusKey] = {
      focusKey,
      parentFocusKey,
      focusable: true,
      layout,
      layoutUpdatedAt: 0,
    };
  };
  add('discover-grid', 'SN:ROOT', layoutOf(0));
  for (const index of drawn) add(gridTileKey(index), 'discover-grid', layoutOf(index));
  for (const key of Object.keys(others)) add(key, 'discover-grid', others[key]!);
  navigation.layoutAdapter = {
    measureLayout: (measured) =>
      Promise.resolve((measured as unknown as { layout: FocusableComponentLayout }).layout),
  };
  navigation.enabled = true;
  return navigation;
}

/** Where spatial navigation's own search by position goes from a tile, or null out of the grid. */
async function byPosition(
  drawn: readonly number[],
  from: number,
  direction: string,
): Promise<string | null> {
  const navigation = service(drawn);
  navigation.focusKey = gridTileKey(from);
  let landed: string | null = null;
  navigation.setImmediateFocus = (focusKey) => {
    landed = focusKey;
  };
  await navigation.smartNavigate(direction, null, {});
  return landed;
}

/** The drawn rows of a grid of `count` tiles, as PosterGrid draws them around a row. */
function drawnAround(count: number, anchorRow: number): number[] {
  const rows = Math.ceil(count / GRID_COLUMNS);
  const firstRow = Math.max(0, anchorRow - 1);
  const lastRow = Math.min(rows, anchorRow + 3 + 1);
  const drawn: number[] = [];
  for (
    let index = firstRow * GRID_COLUMNS;
    index < Math.min(count, lastRow * GRID_COLUMNS);
    index++
  ) {
    drawn.push(index);
  }
  return drawn;
}

function byIndex(drawn: readonly number[], from: number, direction: string): string | null {
  const siblings = drawn.map(
    (index) => ({ focusKey: gridTileKey(index) }) as unknown as FocusableComponent,
  );
  return nextGridTile(direction, gridTileKey(from), siblings)?.focusKey ?? null;
}

describe('moving in the poster grid by index', () => {
  it('lands where the search by position lands, from every tile, in grids of every shape', async () => {
    let checked = 0;
    for (let count = 1; count <= 45; count++) {
      const rows = Math.ceil(count / GRID_COLUMNS);
      // Every slide of the grid, and one past its end (a remembered scroll from a longer list).
      for (let anchorRow = 0; anchorRow <= rows; anchorRow++) {
        const drawn = drawnAround(count, anchorRow);
        for (const from of drawn) {
          for (const direction of DIRECTIONS) {
            const where = `${direction} from ${from} of ${count}, rows from ${anchorRow - 1}`;
            expect(byIndex(drawn, from, direction), where).toBe(
              await byPosition(drawn, from, direction),
            );
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('moves along rows and columns, and leaves the grid at its edges', () => {
    const drawn = drawnAround(25, 1);
    expect(byIndex(drawn, 8, 'left')).toBe('discover-tile-7');
    expect(byIndex(drawn, 8, 'right')).toBe('discover-tile-9');
    expect(byIndex(drawn, 8, 'up')).toBe('discover-tile-1');
    expect(byIndex(drawn, 8, 'down')).toBe('discover-tile-15');
    expect(byIndex(drawn, 7, 'left')).toBeNull();
    expect(byIndex(drawn, 13, 'right')).toBeNull();
    expect(byIndex(drawn, 3, 'up')).toBeNull();
    expect(byIndex(drawn, 23, 'down')).toBeNull();
  });

  it('follows the search by position at the end of a short last row', () => {
    // 25 titles: the last row holds 21 to 24.
    const drawn = drawnAround(25, 3);
    expect(byIndex(drawn, 24, 'right')).toBe('discover-tile-18');
    expect(byIndex(drawn, 19, 'down')).toBe('discover-tile-24');
    expect(byIndex(drawn, 17, 'down')).toBe('discover-tile-24');
    expect(byIndex(drawn, 16, 'down')).toBe('discover-tile-23');
    expect(byIndex(drawn, 24, 'up')).toBe('discover-tile-17');
  });

  it('never lands on a tile that is not drawn', () => {
    // Rows 2 to 6 drawn: Up from row 2 and Down from row 6 leave the grid.
    const drawn = drawnAround(70, 3);
    expect(byIndex(drawn, 14, 'up')).toBeNull();
    expect(byIndex(drawn, 15, 'up')).toBeNull();
    expect(byIndex(drawn, 41, 'down')).toBe('discover-tile-48');
    expect(byIndex(drawn, 45, 'down')).toBeNull();
    expect(byIndex(drawn, 46, 'down')).toBeNull();
  });

  it('ignores what is not a tile', () => {
    const siblings = [{ focusKey: gridTileKey(0) } as unknown as FocusableComponent];
    expect(nextGridTile('down', 'discover-more-retry', siblings)).toBeNull();
    expect(nextGridTile('right', gridTileKey(0), siblings)).toBeNull();
  });
});

describe('the tile focus lands on in the grid', () => {
  it('without one to go back to, is the first drawn, as the search by position picks', async () => {
    for (const count of [3, 14, 25, 45]) {
      const rows = Math.ceil(count / GRID_COLUMNS);
      for (let anchorRow = 0; anchorRow < rows; anchorRow++) {
        const drawn = drawnAround(count, anchorRow);
        // Try again under the last row, where a later page failed.
        const { left, top } = layoutOf(rows * GRID_COLUMNS);
        const navigation = service(drawn, {
          'discover-more-retry': {
            ...layoutOf(rows * GRID_COLUMNS),
            width: 300,
            height: 72,
            right: left + 300,
            bottom: top + 72,
          },
        });
        expect(await navigation.getNextFocusKey('discover-grid')).toBe(
          gridTileKey(Math.max(0, anchorRow - 1) * GRID_COLUMNS),
        );
      }
    }
  });

  it('is the remembered one only while it is drawn', () => {
    expect(drawnGridTile('discover-tile-15', 7, 35)).toBe('discover-tile-15');
    expect(drawnGridTile('discover-tile-40', 7, 35)).toBeUndefined();
    expect(drawnGridTile('discover-tile-3', 7, 35)).toBeUndefined();
    expect(drawnGridTile('discover-more-retry', 0, 35)).toBeUndefined();
    expect(drawnGridTile(undefined, 0, 35)).toBeUndefined();
  });
});
