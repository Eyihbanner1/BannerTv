/**
 * ChipRow's sums, kept apart from React Native so they can be tested: where to scroll so a pill
 * shows, and which ends have more pills past them.
 */

/** Where a pill is along its row, from the row's own start. */
export interface Spot {
  x: number;
  width: number;
}

/** The row as it scrolls: how far along it is, how much of it shows, and how long it is. */
export interface Scrolled {
  offset: number;
  width: number;
  contentWidth: number;
}

/**
 * How far along to scroll so the whole pill shows with `margin` clear on both sides, moving as
 * little as it can. Undefined when it already shows.
 */
export function offsetToShow(spot: Spot, row: Scrolled, margin: number): number | undefined {
  let target = row.offset;
  if (spot.x - margin < row.offset) target = spot.x - margin;
  else if (spot.x + spot.width + margin > row.offset + row.width) {
    target = spot.x + spot.width + margin - row.width;
  }
  target = Math.min(Math.max(0, target), Math.max(0, row.contentWidth - row.width));
  return Math.abs(target - row.offset) < 1 ? undefined : target;
}

/** Which ends have pills past them, a pixel's rounding aside. */
export function moreAt(row: Scrolled): { before: boolean; after: boolean } {
  return {
    before: row.offset > 1,
    after: row.offset + row.width < row.contentWidth - 1,
  };
}

/** The colour with none of it showing, so a fade into it does not pass through grey. */
export function clearOf(colour: string): string {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!hex) return 'transparent';
  const [red, green, blue] = hex.slice(1).map((part) => parseInt(part, 16));
  return `rgba(${red}, ${green}, ${blue}, 0)`;
}
