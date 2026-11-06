import type { BoardRow } from './board';
import {
  type HomeLayout,
  hiddenRowIds,
  orderedRows,
  rowIdentities,
  rowIdentity,
  setRowHidden,
} from './layout';

/**
 * Home's own lines, kept in the same layout as the addons' rows by these
 * names, so Settings > Home rows can move and hide them on every screen.
 */
export const CONTINUE_LINE = 'bannertv:continue';
export const LIVE_SPORT_LINE = 'bannertv:live-sport';
export const MY_LIST_LINE = 'bannertv:my-list';

/** A line of Home's own that the screen can show now. */
export interface OwnLine {
  id: string;
  /** How many of the addons' rows come before it, until the viewer moves it. */
  place: number;
  /** First on Home, whatever else moves: it can be hidden, not moved (Continue Watching). */
  fixed?: boolean;
}

/** One line of Home, in Settings > Home rows order: an addon's row, or one of Home's own. */
export interface HomeLine {
  id: string;
  /** The addon's row; none for a line of Home's own. */
  row?: BoardRow;
  hidden: boolean;
}

function isOwn(id: string): boolean {
  return id.indexOf('bannertv:') === 0;
}

/**
 * Every line, hidden ones too, in the chosen order. A line of Home's own
 * that was moved keeps its place among the rows; one never moved sits after
 * `place` rows, and fixed ones come first.
 */
export function homeLines(
  rows: readonly BoardRow[],
  layout: HomeLayout,
  own: readonly OwnLine[],
): HomeLine[] {
  const ids = rowIdentities(rows);
  const hiddenRows = hiddenRowIds(rows, layout);
  const hiddenOwn = new Set(layout.hidden.filter(isOwn));
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  const rankOf = (line: HomeLine) =>
    line.row ? (rank.get(line.id) ?? rank.get(rowIdentity(line.row))) : rank.get(line.id);
  const lines: HomeLine[] = orderedRows(rows, layout).map((row) => {
    const id = ids.get(row)!;
    return { id, row, hidden: hiddenRows.has(id) };
  });
  const ownLine = (line: OwnLine): HomeLine => ({ id: line.id, hidden: hiddenOwn.has(line.id) });

  // Moved ones go before the first line the layout puts after them. Ranked
  // rows lead the list in rank order, so that is where they were.
  const moved = own
    .filter((line) => !line.fixed && rank.has(line.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  for (const line of moved) {
    const at = rank.get(line.id)!;
    const before = lines.findIndex((other) => {
      const otherRank = rankOf(other);
      return otherRank === undefined || otherRank > at;
    });
    lines.splice(before < 0 ? lines.length : before, 0, ownLine(line));
  }
  // The rest go before the addons' row at their place, after Home's own already there.
  for (const line of own) {
    if (line.fixed || rank.has(line.id)) continue;
    let seen = 0;
    let before = lines.length;
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.row) continue;
      if (seen === line.place) {
        before = index;
        break;
      }
      seen += 1;
    }
    lines.splice(before, 0, ownLine(line));
  }
  const fixed = own.filter((line) => line.fixed).map(ownLine);
  return fixed.concat(lines);
}

/**
 * Where Home draws its own lines among the rows it shows: for each one not
 * hidden, how many of the shown rows come before it. Rows that are hidden
 * are left out of the count.
 */
export function ownLinePlaces(lines: readonly HomeLine[]): Map<string, number> {
  const places = new Map<string, number>();
  let rows = 0;
  for (const line of lines) {
    if (line.hidden) continue;
    if (line.row) rows += 1;
    else places.set(line.id, rows);
  }
  return places;
}

/**
 * The layout with line `id` moved one place up (-1) or down (1) among the
 * lines that can move. Every such line is then saved in order, Home's own
 * included, so each keeps its place among the rows.
 */
export function moveLine(
  rows: readonly BoardRow[],
  layout: HomeLayout,
  own: readonly OwnLine[],
  id: string,
  by: -1 | 1,
): HomeLayout {
  const fixed = new Set(own.filter((line) => line.fixed).map((line) => line.id));
  const order = homeLines(rows, layout, own)
    .filter((line) => !fixed.has(line.id))
    .map((line) => line.id);
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return layout;
  order.splice(to, 0, order.splice(from, 1)[0]!);
  return { order, hidden: layout.hidden };
}

/** The layout with line `id` hidden or shown: an addon's row, or one of Home's own. */
export function setLineHidden(
  rows: readonly BoardRow[],
  layout: HomeLayout,
  id: string,
  hidden: boolean,
): HomeLayout {
  if (!isOwn(id)) return setRowHidden(rows, layout, id, hidden);
  const was = layout.hidden.indexOf(id) !== -1;
  if (was === hidden) return layout;
  return {
    order: layout.order,
    hidden: hidden ? layout.hidden.concat([id]) : layout.hidden.filter((other) => other !== id),
  };
}
