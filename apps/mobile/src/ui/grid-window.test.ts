import { describe, expect, it } from 'vitest';
import { FIRST_RENDER_TILES, rowsForTiles } from './grid-window';

describe("a poster grid's window", () => {
  it('turns a count of tiles into the rows FlatList counts', () => {
    expect(rowsForTiles(FIRST_RENDER_TILES, 3)).toBe(7);
    expect(rowsForTiles(12, 3)).toBe(4);
    // A part row still takes a row.
    expect(rowsForTiles(13, 3)).toBe(5);
    expect(rowsForTiles(5, 1)).toBe(5);
  });

  it('always draws at least one row', () => {
    expect(rowsForTiles(0, 3)).toBe(1);
    expect(rowsForTiles(2, 0)).toBe(2);
  });
});
