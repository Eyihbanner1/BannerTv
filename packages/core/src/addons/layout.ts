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

/** Every row, hidden ones too, in the chosen order: rows the layout has not seen follow in the board's order. */
export function orderedRows(rows: readonly BoardRow[], layout: HomeLayout): BoardRow[] {
  if (layout.order.length === 0) return rows.slice();
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  // Chromium 68 sorts unstably, so ties fall back to the board's order by hand.
  return rows
    .map((row, index) => ({ row, index, rank: rank.get(rowIdentity(row)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/** The rows Home draws: the chosen order, without hidden rows. */
export function arrangeBoard(rows: readonly BoardRow[], layout: HomeLayout): BoardRow[] {
  const ordered = orderedRows(rows, layout);
  if (layout.hidden.length === 0) return ordered;
  const hidden = new Set(layout.hidden);
  return ordered.filter((row) => !hidden.has(rowIdentity(row)));
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

/** The layout with row `id` moved one place up (-1) or down (1) among all the rows. */
export function moveRow(
  rows: readonly BoardRow[],
  layout: HomeLayout,
  id: string,
  by: -1 | 1,
): HomeLayout {
  const order = orderedRows(rows, layout).map(rowIdentity);
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return layout;
  order.splice(to, 0, order.splice(from, 1)[0]!);
  return { order, hidden: layout.hidden };
}

export function setRowHidden(layout: HomeLayout, id: string, hidden: boolean): HomeLayout {
  const isHidden = layout.hidden.indexOf(id) !== -1;
  if (isHidden === hidden) return layout;
  return {
    order: layout.order,
    hidden: hidden ? layout.hidden.concat(id) : layout.hidden.filter((row) => row !== id),
  };
}
