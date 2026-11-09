import { phone } from '../../../../brand/tokens/design';
import { describe, expect, it } from 'vitest';
import { clearOf, moreAt, offsetToShow } from './chip-row';

/** ChipRow keeps a chosen pill this far from either edge: past the 28-wide fade. */
const MARGIN = 28;

/**
 * Sports' eight days on a 360-wide phone: 16 in from the edge, 8 between, each about 80 wide.
 * The row is 16 + 8 * 80 + 7 * 8 + 16 = 728 long.
 */
const day = (index: number) => ({ x: 16 + index * 88, width: 80 });
const strip = (offset: number) => ({ offset, width: 360, contentWidth: 728 });

describe('scrolling a chosen pill into view', () => {
  it('leaves the row alone while the pill already shows clear of the fades', () => {
    expect(offsetToShow(day(0), strip(0), MARGIN)).toBeUndefined();
    expect(offsetToShow(day(2), strip(0), MARGIN)).toBeUndefined();
  });

  it('moves only as far as it must to show a pill past the end', () => {
    // Day 6 ends at 624: 624 + 28 - 360 along.
    expect(offsetToShow(day(6), strip(0), MARGIN)).toBe(292);
  });

  it('moves back for a pill before the start', () => {
    expect(offsetToShow(day(1), strip(300), MARGIN)).toBe(day(1).x - MARGIN);
  });

  it('never scrolls past either end of the row', () => {
    // The last day wants 712 + 28 - 360 = 380, but the row stops at 728 - 360.
    expect(offsetToShow(day(7), strip(0), MARGIN)).toBe(368);
    expect(offsetToShow(day(0), strip(200), MARGIN)).toBe(0);
  });

  it('starts a row inset by the gutter at the start, not a few pixels along', () => {
    const first = { x: phone.gutter, width: 125 };
    expect(offsetToShow(first, { offset: 0, width: 360, contentWidth: 900 }, MARGIN)).toBe(
      undefined,
    );
  });

  it('has nothing to do when the whole row fits', () => {
    expect(offsetToShow(day(2), { offset: 0, width: 360, contentWidth: 300 }, MARGIN)).toBe(
      undefined,
    );
  });
});

describe('which ends fade', () => {
  it('fades the end only while pills are past it', () => {
    expect(moreAt(strip(0))).toEqual({ before: false, after: true });
    expect(moreAt(strip(100))).toEqual({ before: true, after: true });
    expect(moreAt(strip(368))).toEqual({ before: true, after: false });
  });

  it('fades neither end of a row that fits, nor for a pixel of rounding', () => {
    expect(moreAt({ offset: 0, width: 360, contentWidth: 326 })).toEqual({
      before: false,
      after: false,
    });
    expect(moreAt({ offset: 0.5, width: 360, contentWidth: 360.5 })).toEqual({
      before: false,
      after: false,
    });
  });
});

describe('the clear end of a fade', () => {
  it('is the same colour with nothing of it showing', () => {
    expect(clearOf('#0B0815')).toBe('rgba(11, 8, 21, 0)');
    expect(clearOf('#140f26')).toBe('rgba(20, 15, 38, 0)');
  });

  it('falls back to transparent for a colour that is not #RRGGBB', () => {
    expect(clearOf('rgba(0, 0, 0, 0.5)')).toBe('transparent');
  });
});
