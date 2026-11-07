import { describe, expect, it } from 'vitest';
import { focusedTitle, type HomeRow, initialFocus, move } from './model';
import { play, walkFor, walkMs } from './walk';

const rows: HomeRow[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => ({
  key,
  title: key,
  shape: 'poster',
  items: Array.from({ length: 40 }, (_, i) => ({ id: `${key}${i}`, name: `${key}${i}` })),
}));

describe('walkFor', () => {
  it('first walks down every row once', () => {
    const walk = walkFor(rows);
    expect(walk.firstWalkDown).toHaveLength(rows.length - 1);
    expect(walk.firstWalkDown.every((step) => step.direction === 'down')).toBe(true);
  });

  it('stays on Home and ends in a row, at a pace a viewer could keep', async () => {
    const walk = walkFor(rows);
    let focus = initialFocus(rows);
    const sleep = () => Promise.resolve();
    await play(
      [...walk.firstWalkDown, ...walk.browse],
      (d) => (focus = move(focus, rows, d)),
      sleep,
    );
    expect(focusedTitle(focus, rows)).toBeDefined();
    expect(walkMs(walk.browse)).toBeGreaterThan(10000);
    expect(walkMs(walk.browse)).toBeLessThan(30000);
  });
});
