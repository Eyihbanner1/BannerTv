import { createPersisted, type Persisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { BoardRow } from './board';

const KEY = 'homeLayout';
/** Rows remembered at most, shown or hidden. */
const MAX_ROWS = 300;

/** The order and visibility of Home's rows chosen in Settings. */
export interface HomeLayout {
  /** Row identities in the chosen order. Rows not listed follow, in the board's order. */
  order: readonly string[];
  hidden: readonly string[];
}

export const EMPTY_LAYOUT: HomeLayout = { order: [], hidden: [] };

/**
 * A row's identity for the layout: the addon's id, the catalog and its genre.
 * Unlike BoardRow.key it does not change when addons are reordered.
 */
export function rowIdentity(row: BoardRow): string {
  const genre = row.extra.find(([name]) => name === 'genre');
  return [row.addon.manifest.id, row.type, row.catalog.id, genre ? genre[1] : ''].join('|');
}

/** A short name for one install, so the layout never keeps its manifest URL, which can hold keys. */
function installTag(transportUrl: string): string {
  // FNV-1a: stable across launches, and the same for every profile.
  let hash = 0x811c9dc5;
  for (let index = 0; index < transportUrl.length; index++) {
    hash = Math.imul(hash ^ transportUrl.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

interface RowNames {
  /** What the layout saves for the row now. */
  id: string;
  /** Every name the layout may hold for it: its install's first, then the shared one. */
  known: string[];
}

/**
 * The same addon installed twice with different settings gives rows with the
 * same identity. While both are installed, each such row is told apart by
 * its install, which moving addons does not change. Settings saved under the
 * shared identity keep applying to both until one of them is changed, and an
 * install left on its own keeps the settings it had as one of two.
 */
function rowNames(rows: readonly BoardRow[]): Map<BoardRow, RowNames> {
  const copies = new Map<string, number>();
  for (const row of rows) {
    const base = rowIdentity(row);
    copies.set(base, (copies.get(base) ?? 0) + 1);
  }
  const taken = new Set<string>();
  const names = new Map<BoardRow, RowNames>();
  for (const row of rows) {
    const base = rowIdentity(row);
    const own = `${base}#${installTag(row.addon.transportUrl)}`;
    let id = copies.get(base)! > 1 ? own : base;
    // An addon that lists one catalog twice: the later one is numbered.
    for (let count = 2; taken.has(id); count++) id = `${own}-${count}`;
    taken.add(id);
    names.set(row, { id, known: id === own || id === base ? [own, base] : [id] });
  }
  return names;
}

/** Each board row's identity, to save in the layout: unique on the board, and the same after addons move. */
export function rowIdentities(rows: readonly BoardRow[]): Map<BoardRow, string> {
  const ids = new Map<BoardRow, string>();
  rowNames(rows).forEach((names, row) => ids.set(row, names.id));
  return ids;
}

/** Every row, hidden ones too, in the chosen order: rows the layout has not seen follow in the board's order. */
export function orderedRows(rows: readonly BoardRow[], layout: HomeLayout): BoardRow[] {
  if (layout.order.length === 0) return rows.slice();
  const names = rowNames(rows);
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  const rankOf = (row: BoardRow) => {
    for (const id of names.get(row)!.known) {
      const found = rank.get(id);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  // Chromium 68 sorts unstably, so ties fall back to the board's order by hand.
  return rows
    .map((row, index) => ({ row, index, rank: rankOf(row) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank || a.index - b.index;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/** The identities (from rowIdentities) of the board's hidden rows. */
export function hiddenRowIds(rows: readonly BoardRow[], layout: HomeLayout): Set<string> {
  const ids = new Set<string>();
  if (layout.hidden.length === 0) return ids;
  const hidden = new Set(layout.hidden);
  rowNames(rows).forEach((names) => {
    if (names.known.some((id) => hidden.has(id))) ids.add(names.id);
  });
  return ids;
}

/** The rows Home draws: the chosen order, without hidden rows. */
export function arrangeBoard(rows: readonly BoardRow[], layout: HomeLayout): BoardRow[] {
  const ordered = orderedRows(rows, layout);
  const hidden = hiddenRowIds(rows, layout);
  if (hidden.size === 0) return ordered;
  const ids = rowIdentities(rows);
  return ordered.filter((row) => !hidden.has(ids.get(row)!));
}

function readLayout(saved: unknown): HomeLayout {
  if (typeof saved !== 'object' || saved === null) return EMPTY_LAYOUT;
  const raw = saved as Record<string, unknown>;
  const ids = (value: unknown) =>
    Array.from(
      new Set(
        (Array.isArray(value) ? value : []).filter(
          (id): id is string => typeof id === 'string' && id !== '',
        ),
      ),
    ).slice(0, MAX_ROWS);
  return { order: ids(raw.order), hidden: ids(raw.hidden) };
}

export type HomeLayoutStore = Persisted<HomeLayout>;

/** One profile's Home layout, kept in the key-value store. */
export function createHomeLayout(options: { storage: KeyValueStore }): HomeLayoutStore {
  return createPersisted<HomeLayout>({
    storage: options.storage,
    key: KEY,
    initial: EMPTY_LAYOUT,
    read: readLayout,
    write: (layout) => ({ order: layout.order.slice(), hidden: layout.hidden.slice() }),
  });
}

/** The layout with row `id` (from rowIdentities) moved one place up (-1) or down (1) among all the rows. */
export function moveRow(
  rows: readonly BoardRow[],
  layout: HomeLayout,
  id: string,
  by: -1 | 1,
): HomeLayout {
  const ids = rowIdentities(rows);
  const order = orderedRows(rows, layout).map((row) => ids.get(row)!);
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return layout;
  order.splice(to, 0, order.splice(from, 1)[0]!);
  return { order, hidden: layout.hidden };
}

/**
 * The layout with row `id` (from rowIdentities) hidden or shown. The board's
 * hidden rows are saved by their identities now; rows of addons not
 * installed keep what was saved for them.
 */
export function setRowHidden(
  rows: readonly BoardRow[],
  layout: HomeLayout,
  id: string,
  hidden: boolean,
): HomeLayout {
  const now = hiddenRowIds(rows, layout);
  if (now.has(id) === hidden) return layout;
  if (hidden) now.add(id);
  else now.delete(id);
  const onBoard = new Set<string>();
  rowNames(rows).forEach((names) => names.known.forEach((known) => onBoard.add(known)));
  const elsewhere = layout.hidden.filter((row) => !onBoard.has(row));
  return { order: layout.order, hidden: elsewhere.concat(Array.from(now)) };
}
