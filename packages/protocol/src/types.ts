/**
 * Stremio addon protocol v3, as BannerTV reads it. These are the parsed,
 * normalised shapes: legacy fields are folded into their current names, and
 * every optional value is either valid or absent.
 *
 * Reference: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api
 */

/** Usually movie, series, channel or tv, but addons may declare any type. */
export type ContentType = string;

export type ResourceName = 'catalog' | 'meta' | 'stream' | 'subtitles' | 'addon_catalog' | string;

export interface ManifestResource {
  name: ResourceName;
  /** Overrides the manifest's types for this resource when present. */
  types?: ContentType[];
  /** Overrides the manifest's idPrefixes for this resource when present. */
  idPrefixes?: string[];
}

export interface CatalogExtra {
  name: string;
  isRequired: boolean;
  /** Allowed values, for example the genres a catalog can filter by. */
  options: string[];
}

export interface ManifestCatalog {
  type: ContentType;
  id: string;
  name: string;
  extra: CatalogExtra[];
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  types: ContentType[];
  /** Absent means the addon answers for any ID. */
  idPrefixes?: string[];
  resources: ManifestResource[];
  catalogs: ManifestCatalog[];
  behaviorHints: {
    adult: boolean;
    p2p: boolean;
    configurable: boolean;
    configurationRequired: boolean;
  };
}

export type PosterShape = 'poster' | 'square' | 'landscape';

export interface MetaLink {
  name: string;
  /** For example Cast, Directors, Writers, Genres, imdb or share. */
  category: string;
  url?: string;
}

export interface MetaPreview {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  posterShape: PosterShape;
  background?: string;
  /** The title as artwork, drawn instead of the name where it fits. */
  logo?: string;
  description?: string;
  /** A year, or a span such as "2011–2019". */
  releaseInfo?: string;
  imdbRating?: string;
  runtime?: string;
  genres: string[];
  /** YouTube IDs. */
  trailers: string[];
}

export interface Video {
  /** For series, `{imdbId}:{season}:{episode}`. */
  id: string;
  title: string;
  /** ISO date and time. */
  released?: string;
  season?: number;
  episode?: number;
  thumbnail?: string;
  overview?: string;
}

export interface MetaDetail extends MetaPreview {
  videos: Video[];
  cast: string[];
  directors: string[];
  writers: string[];
  links: MetaLink[];
  country?: string;
  behaviorHints: {
    defaultVideoId?: string;
    hasScheduledVideos: boolean;
  };
}

/**
 * Cache hints an addon may add to any response, in seconds. See
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md
 */
export interface CacheHints {
  cacheMaxAge?: number;
  staleRevalidate?: number;
  staleError?: number;
}

export interface CatalogResponse {
  metas: MetaPreview[];
  /** Items that were left out because they could not be read. */
  dropped: number;
  cache: CacheHints;
}

export interface MetaResponse {
  meta: MetaDetail | null;
  cache: CacheHints;
}
