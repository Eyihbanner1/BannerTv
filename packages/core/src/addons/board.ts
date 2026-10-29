import {
  boardCatalogs,
  type ContentType,
  type ExtraArg,
  findExtra,
  type ManifestCatalog,
} from '@bannertv/protocol';
import type { InstalledAddon } from './collection';

export type RowStyle = 'poster' | 'landscape';

export interface BoardRow {
  /** Stable while the collection does not change, safe for focus keys: [a-z0-9-] only. */
  key: string;
  addon: InstalledAddon;
  catalog: ManifestCatalog;
  extra: readonly ExtraArg[];
  /** The catalog's name, or the genre for a genre row. */
  name: string;
  type: ContentType;
  kind: 'catalog' | 'genre';
  style: RowStyle;
}

/**
 * Genre rows added under the first addon that can filter its catalogs by
 * genre, in this order. Each name is used only when the catalog lists it.
 */
export const GENRE_PICKS: ReadonlyArray<readonly [type: ContentType, genre: string]> = [
  ['movie', 'Action'],
  ['series', 'Crime'],
  ['movie', 'Comedy'],
  ['series', 'Drama'],
  ['movie', 'Sci-Fi'],
  ['series', 'Animation'],
];

// Catalogs with these words in their name or id get wide backdrop tiles.
const SPOTLIGHT = /featured|trending|spotlight|new releases/i;

/** Lower-case letters, digits and dashes, for keys that also become focus keys. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function rowStyle(catalog: ManifestCatalog): RowStyle {
  return SPOTLIGHT.test(catalog.name) || SPOTLIGHT.test(catalog.id) ? 'landscape' : 'poster';
}

function genreRows(
  addon: InstalledAddon,
  index: number,
  used: Set<string>,
  leaveOut: CatalogFilter | undefined,
): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const [type, genre] of GENRE_PICKS) {
    if (used.has(type)) continue;
    // The first board catalog of this type that can filter by this genre.
    const catalog = boardCatalogs(addon.manifest).find((c) => {
      if (leaveOut?.(addon, c)) return false;
      const extra = c.type === type ? findExtra(c, 'genre') : undefined;
      return extra !== undefined && !extra.isRequired && extra.options.indexOf(genre) !== -1;
    });
    if (!catalog) continue;
    rows.push({
      key: `${index}-${slug(type)}-${slug(catalog.id)}-genre-${slug(genre)}`,
      addon,
      catalog,
      extra: [['genre', genre]],
      name: genre,
      type,
      kind: 'genre',
      style: 'poster',
    });
  }
  return rows;
}

/** A catalog Home or Search leaves out, such as a sports catalog the Sports screen shows. */
export type CatalogFilter = (addon: InstalledAddon, catalog: ManifestCatalog) => boolean;

/**
 * The rows of Home, in collection order: every catalog that needs no extra,
 * then the genre rows of the first addon able to make them for each type.
 * Catalogs `leaveOut` names get no row.
 */
export function buildBoard(
  addons: readonly InstalledAddon[],
  leaveOut?: CatalogFilter,
): BoardRow[] {
  const rows: BoardRow[] = [];
  const typesWithGenres = new Set<string>();
  addons.forEach((addon, index) => {
    for (const catalog of boardCatalogs(addon.manifest)) {
      if (leaveOut?.(addon, catalog)) continue;
      rows.push({
        key: `${index}-${slug(catalog.type)}-${slug(catalog.id)}`,
        addon,
        catalog,
        extra: [],
        name: catalog.name,
        type: catalog.type,
        kind: 'catalog',
        style: rowStyle(catalog),
      });
    }
    const genres = genreRows(addon, index, typesWithGenres, leaveOut);
    for (const row of genres) rows.push(row);
    for (const row of genres) typesWithGenres.add(row.type);
  });
  // Two catalog ids can slug the same way; keep keys unique.
  const seen = new Set<string>();
  for (const row of rows) {
    let key = row.key;
    for (let n = 2; seen.has(key); n++) key = `${row.key}-${n}`;
    row.key = key;
    seen.add(key);
  }
  return rows;
}
