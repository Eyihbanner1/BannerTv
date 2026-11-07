import { describe, expect, it } from 'vitest';
import {
  focusedTitle,
  type HomeRow,
  initialFocus,
  LAYOUT,
  move,
  rowHeight,
  rowOffsets,
  tilesX,
  tileStep,
  trackY,
} from './model';

const titles = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}` }));

const ROWS: HomeRow[] = [
  { key: 'a', title: 'A', shape: 'poster', items: titles('a', 3) },
  { key: 'b', title: 'B', shape: 'landscape', items: titles('b', 5) },
  { key: 'c', title: 'C', shape: 'poster', items: titles('c', 2) },
];

describe('move', () => {
  it('walks along a row and stops at its ends', () => {
    let focus = initialFocus(ROWS);
    expect(move(focus, ROWS, 'left')).toBe(focus);
    focus = move(move(focus, ROWS, 'right'), ROWS, 'right');
    expect(focusedTitle(focus, ROWS)?.id).toBe('a2');
    expect(move(focus, ROWS, 'right')).toBe(focus);
  });

  it('remembers where each row was left', () => {
    let focus = initialFocus(ROWS);
    focus = move(focus, ROWS, 'right');
    focus = move(focus, ROWS, 'down');
    focus = move(move(focus, ROWS, 'right'), ROWS, 'right');
    expect(focusedTitle(focus, ROWS)?.id).toBe('b2');
    focus = move(focus, ROWS, 'up');
    expect(focusedTitle(focus, ROWS)?.id).toBe('a1');
    focus = move(focus, ROWS, 'down');
    expect(focusedTitle(focus, ROWS)?.id).toBe('b2');
  });

  it('stops at the first and last rows', () => {
    const top = initialFocus(ROWS);
    expect(move(top, ROWS, 'up')).toBe(top);
    const bottom = move(move(top, ROWS, 'down'), ROWS, 'down');
    expect(move(bottom, ROWS, 'down')).toBe(bottom);
  });
});

describe('geometry', () => {
  it('slides the focused row to the top of the rows area', () => {
    const offsets = rowOffsets(ROWS);
    expect(offsets).toEqual([0, rowHeight('poster'), rowHeight('poster') + rowHeight('landscape')]);
    const focus = move(initialFocus(ROWS), ROWS, 'down');
    expect(trackY(focus, offsets) + offsets[1]!).toBe(LAYOUT.rowsTop);
  });

  it('keeps the focused tile at the left edge', () => {
    expect(tilesX(0, 'poster')).toBe(LAYOUT.left);
    expect(tilesX(3, 'landscape') + 3 * tileStep('landscape')).toBe(LAYOUT.left);
  });
});
