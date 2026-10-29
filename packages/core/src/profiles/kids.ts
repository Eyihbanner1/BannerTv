import { boardCatalogs, type ContentType, findExtra, type MetaPreview } from '@bannertv/protocol';
import { type BoardRow, slug } from '../addons/board';
import type { InstalledAddon } from '../addons/collection';
import type { CatalogSource, DiscoverSource } from '../addons/sources';
import type { KidsRating } from './profiles';

/** The only kinds of title a kids profile sees. */
export const KIDS_TYPES: readonly ContentType[] = ['movie', 'series'];
/** The genre kids Home rows ask catalogs for. */
export const KIDS_GENRE = 'Family';

// IMDb's and TMDB's genre names, compared in lower case.
const FOR_CHILDREN = ['family', 'kids', 'children'];
const NOT_FOR_CHILDREN = ['horror', 'thriller', 'crime', 'war', 'adult', 'erotic', 'erotica'];

/**
 * Whether a kids profile may see a title, from what catalogs say about it.
 * Its genres must name it as for families or children and nothing that is
 * not. A title with no genres is left out: the filter fails closed. Titles
 * from a catalog already asked for Family titles (kids Home rows) need only
 * avoid the genres that are not for children, since catalog pages often
 * leave genres out.
 */
export function kidsTitleAllowed(
  item: Pick<MetaPreview, 'type' | 'genres'>,
  fromFamilyCatalog = false,
): boolean {
  if (KIDS_TYPES.indexOf(item.type) === -1) return false;
  const genres = item.genres.map((genre) => genre.trim().toLowerCase());
  if (genres.some((genre) => NOT_FOR_CHILDREN.indexOf(genre) !== -1)) return false;
  return fromFamilyCatalog || genres.some((genre) => FOR_CHILDREN.indexOf(genre) !== -1);
}

/** BBFC ratings, lowest first. 12 and 12A count the same. */
const UK_ORDER = ['U', 'PG', '12', '15', '18', 'R18'];

/** US film and TV ratings as the nearest UK rating, rounded up where they differ. */
const FROM_US: Record<string, string> = {
  G: 'U',
  PG: 'PG',
  'PG-13': '12',
  R: '15',
  'NC-17': '18',
  'TV-Y': 'U',
  'TV-Y7': 'U',
  'TV-Y7-FV': 'U',
  'TV-G': 'U',
  'TV-PG': 'PG',
  'TV-14': '15',
  'TV-MA': '18',
};

/**
 * A certificate as a UK rating (U, PG, 12, 15, 18 or R18), from a UK one or
 * a US one. Undefined when it is neither, or empty.
 */
export function ukRating(certificate: string, country: 'GB' | 'US'): string | undefined {
  const value = certificate.trim().toUpperCase();
  if (value === '') return undefined;
  if (country === 'US') return FROM_US[value];
  const uk = value === '12A' ? '12' : value;
  return UK_ORDER.indexOf(uk) !== -1 ? uk : undefined;
}

/** Whether a title rated `rating` (a UK rating) may play in a kids profile allowing `max`. */
export function ratingAllowed(rating: string, max: KidsRating): boolean {
  const index = UK_ORDER.indexOf(rating);
  return index !== -1 && index <= UK_ORDER.indexOf(max);
}

/** The addons a kids profile uses: none marked adult. */
export function kidsAddons(addons: readonly InstalledAddon[]): InstalledAddon[] {
  return addons.filter((addon) => !addon.manifest.behaviorHints.adult);
}

/**
 * A kids profile's Home: for each addon not marked adult, every film and
 * series catalog that can filter by the Family genre, filtered by it. Other
 * catalogs have no way to say a title suits children, so they add no rows.
 * Keys follow buildBoard's genre rows.
 */
export function buildKidsBoard(addons: readonly InstalledAddon[]): BoardRow[] {
  const rows: BoardRow[] = [];
  const seen = new Set<string>();
  addons.forEach((addon, index) => {
    if (addon.manifest.behaviorHints.adult) return;
    for (const catalog of boardCatalogs(addon.manifest)) {
      if (KIDS_TYPES.indexOf(catalog.type) === -1) continue;
      const genre = findExtra(catalog, 'genre');
      if (!genre || genre.isRequired || genre.options.indexOf(KIDS_GENRE) === -1) continue;
      const base = `${index}-${slug(catalog.type)}-${slug(catalog.id)}-genre-${slug(KIDS_GENRE)}`;
      let key = base;
      for (let n = 2; seen.has(key); n++) key = `${base}-${n}`;
      seen.add(key);
      rows.push({
        key,
        addon,
        catalog,
        extra: [['genre', KIDS_GENRE]],
        name: catalog.name,
        type: catalog.type,
        kind: 'genre',
        style: 'poster',
      });
    }
  });
  return rows;
}

/**
 * Discover for a kids profile: film and series catalogs that can filter by
 * Family, always asked for Family titles.
 */
export function kidsDiscoverSources(sources: readonly DiscoverSource[]): DiscoverSource[] {
  return sources
    .filter(
      (source) =>
        KIDS_TYPES.indexOf(source.catalog.type) !== -1 &&
        !source.addon.manifest.behaviorHints.adult &&
        source.genres.indexOf(KIDS_GENRE) !== -1,
    )
    .map((source) => ({ ...source, genres: [KIDS_GENRE], genreRequired: true }));
}

/** Search for a kids profile: film and series catalogs only; results are checked one by one. */
export function kidsSearchSources<S extends CatalogSource>(sources: readonly S[]): S[] {
  return sources.filter(
    (source) =>
      KIDS_TYPES.indexOf(source.catalog.type) !== -1 && !source.addon.manifest.behaviorHints.adult,
  );
}
