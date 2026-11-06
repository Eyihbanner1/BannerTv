import type { ContentType } from '@bannertv/protocol';
import { type DiscoverSource, orderedTypes } from './sources';

/**
 * What Discover (TV) and Browse (phone) show: a type, one catalog of it, and
 * maybe a genre. Kept by addon URL and catalog id, which survive the viewer
 * reordering addons.
 */
export interface DiscoverSelection {
  type: string;
  transportUrl: string;
  catalogId: string;
  genre?: string;
}

/** A selection as the addons can answer it now. */
export interface DiscoverResolved {
  /** Every type a catalog offers, movies and series first. */
  types: ContentType[];
  /** The catalogs of the chosen type, in addon order. */
  ofType: DiscoverSource[];
  source: DiscoverSource;
  genre: string | undefined;
}

/**
 * Turns a wish into what the addons can do now: an unknown type falls back
 * to the first, an unknown catalog to the first of its type, and a genre the
 * catalog does not list to none, or to its first when it needs one. Null
 * when no addon has a catalog to browse.
 */
export function resolveDiscover(
  sources: readonly DiscoverSource[],
  wanted: DiscoverSelection | undefined,
): DiscoverResolved | null {
  const types = orderedTypes(sources);
  if (types.length === 0) return null;
  const type = wanted && types.indexOf(wanted.type) !== -1 ? wanted.type : types[0]!;
  const ofType = sources.filter((s) => s.catalog.type === type);
  const source =
    (wanted &&
      ofType.find(
        (s) => s.addon.transportUrl === wanted.transportUrl && s.catalog.id === wanted.catalogId,
      )) ||
    ofType[0]!;
  let genre = wanted?.genre;
  if (genre !== undefined && source.genres.indexOf(genre) === -1) genre = undefined;
  if (genre === undefined && source.genreRequired) genre = source.genres[0];
  return { types, ofType, source, genre };
}

/** The selection that shows `source`, with `genre` or none. */
export function discoverSelection(
  source: DiscoverSource,
  genre: string | undefined,
): DiscoverSelection {
  const selection: DiscoverSelection = {
    type: source.catalog.type,
    transportUrl: source.addon.transportUrl,
    catalogId: source.catalog.id,
  };
  if (genre !== undefined) selection.genre = genre;
  return selection;
}

/**
 * Whether the catalog pickers should name each catalog's addon too: the
 * type's catalogs come from more than one addon.
 */
export function catalogsFromManyAddons(resolved: DiscoverResolved): boolean {
  return resolved.ofType.some((s) => s.addon !== resolved.ofType[0]!.addon);
}
