import {
  catalogAccepts,
  type ContentType,
  findExtra,
  type ManifestCatalog,
} from '@bannertv/protocol';
import { slug } from './board';
import type { InstalledAddon } from './collection';

/** One catalog of one addon, as a screen lists it. */
export interface CatalogSource {
  /** Unique, stable while the collection does not change, safe for focus keys: [a-z0-9-] only. */
  key: string;
  addon: InstalledAddon;
  catalog: ManifestCatalog;
}

// Movies and series come first wherever types are listed; other types follow as addons name them.
const LEADING_TYPES: readonly ContentType[] = ['movie', 'series'];

/** The distinct types of these catalogs, movies and series first. */
export function orderedTypes(sources: readonly CatalogSource[]): ContentType[] {
  const types = LEADING_TYPES.filter((type) => sources.some((s) => s.catalog.type === type));
  for (const source of sources) {
    if (types.indexOf(source.catalog.type) === -1) types.push(source.catalog.type);
  }
  return types;
}

function collect(
  addons: readonly InstalledAddon[],
  accept: (catalog: ManifestCatalog) => boolean,
): CatalogSource[] {
  const sources: CatalogSource[] = [];
  addons.forEach((addon, index) => {
    for (const catalog of addon.manifest.catalogs) {
      if (!accept(catalog)) continue;
      sources.push({ key: `${index}-${slug(catalog.type)}-${slug(catalog.id)}`, addon, catalog });
    }
  });
  return sources;
}

// Array.prototype.sort is not stable before Chromium 70, so group instead of sorting.
function groupByType<T extends CatalogSource>(sources: readonly T[]): T[] {
  const grouped: T[] = [];
  for (const type of orderedTypes(sources)) {
    for (const source of sources) if (source.catalog.type === type) grouped.push(source);
  }
  return grouped;
}

/**
 * The catalogs a search goes to, one result row each: every catalog that
 * takes a search term and needs nothing else, grouped by type, then in addon
 * priority order.
 */
export function searchSources(addons: readonly InstalledAddon[]): CatalogSource[] {
  return groupByType(collect(addons, (catalog) => catalogAccepts(catalog, ['search'])));
}

export interface DiscoverSource extends CatalogSource {
  /** What the genre picker offers. Empty when the catalog cannot filter by genre. */
  genres: readonly string[];
  /** The catalog only answers for a genre (Cinemeta's New needs a year), so "All" is not offered. */
  genreRequired: boolean;
  /** The catalog takes `skip`, so Discover can load more as the user scrolls. */
  pageable: boolean;
}

/**
 * The catalogs Discover can show, in addon priority order: those that need
 * no extra, or only a genre picked from the options they list.
 */
export function discoverSources(addons: readonly InstalledAddon[]): DiscoverSource[] {
  const sources: DiscoverSource[] = [];
  for (const source of collect(addons, (catalog) =>
    catalog.extra.every((e) => !e.isRequired || (e.name === 'genre' && e.options.length > 0)),
  )) {
    const genre = findExtra(source.catalog, 'genre');
    sources.push({
      ...source,
      genres: genre ? genre.options : [],
      genreRequired: genre !== undefined && genre.isRequired,
      pageable: findExtra(source.catalog, 'skip') !== undefined,
    });
  }
  return sources;
}
