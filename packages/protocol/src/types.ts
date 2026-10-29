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
  /**
   * As the addon sent it, not normalised: sports addons put kick-off times
   * here, and a time with seconds set tells a fetch time from a kick-off.
   */
  released?: string;
  /** Fields only sports addons send, read by packages/core/src/sports. */
  sport?: SportHints;
}

/** Non-standard fields seen on sports addons' items (docs/PLAN.md, Sports addons). */
export interface SportHints {
  /** A start time under another key (`eventStart`, `startTime`): ISO text or epoch digits. */
  start?: string;
  home?: string;
  away?: string;
  /** The `logo` of a `{ name, logo }` team, an http(s) address of the addon's choosing. */
  homeLogo?: string;
  awayLogo?: string;
  /** A non-standard `isLive`. */
  live?: boolean;
  /** A non-standard `category`, usually the sport. */
  category?: string;
  /** A `league`, `competition` or `tournament` field. */
  league?: string;
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

/** Request headers a stream needs, which a `<video>` element cannot send. */
export interface ProxyHeaders {
  request: Record<string, string>;
  response: Record<string, string>;
}

/**
 * Where a stream's media comes from. Exactly one kind per stream, picked in
 * the order stremio-core uses: url, then ytId, then infoHash, then externalUrl.
 */
export type StreamSource =
  /** Plays in BannerTV's own player. */
  | { kind: 'url'; url: string }
  /** A YouTube video, handed to the TV's YouTube app. */
  | { kind: 'youtube'; ytId: string }
  /** A torrent. Needs a streaming server, which BannerTV does not have yet. */
  | { kind: 'torrent'; infoHash: string; fileIdx?: number; trackers: string[] }
  /** A web page or app link, opened outside BannerTV. */
  | { kind: 'external'; url: string };

export interface Stream {
  source: StreamSource;
  /** The addon's short label, often two lines such as "Torrentio\n4k". */
  name?: string;
  /** The longer text: `description`, or the legacy `title`. Often several lines. */
  description?: string;
  /** Subtitles the addon sends with the stream itself. */
  subtitles: Subtitle[];
  behaviorHints: {
    /** Streams in the same group play one after another, for next-episode matching. */
    bingeGroup?: string;
    /** Stremio's desktop hint. BannerTV still tries these: the TV plays MKV, HEVC and AC-3. */
    notWebReady: boolean;
    /** ISO 3166-1 alpha-3 codes, lower case. */
    countryWhitelist?: string[];
    proxyHeaders?: ProxyHeaders;
    filename?: string;
    videoHash?: string;
    /** In bytes. */
    videoSize?: number;
  };
}

export interface StreamResponse {
  streams: Stream[];
  /** Streams that were left out because they could not be read or played from any source. */
  dropped: number;
  cache: CacheHints;
}

export interface Subtitle {
  /** Unique within one response. Addons that leave it out get the URL instead. */
  id: string;
  url: string;
  /** As the addon sent it: usually ISO 639-2 (eng, fre, pob), sometimes ISO 639-1 or a name. */
  lang: string;
  /** Some addons name the file or the release it matches. */
  label?: string;
}

export interface SubtitlesResponse {
  subtitles: Subtitle[];
  dropped: number;
  cache: CacheHints;
}
