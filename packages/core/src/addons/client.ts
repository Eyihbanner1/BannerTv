import {
  type ContentType,
  type ExtraArg,
  type MetaDetail,
  type MetaPreview,
  parseCatalogResponse,
  parseMetaResponse,
  parseStreamResponse,
  parseSubtitlesResponse,
  resourceUrl,
  type Stream,
  type Subtitle,
  supportsResource,
} from '@bannertv/protocol';
import type { FetchJson } from '../http';
import type { Limiter } from '../limiter';
import type { CachePolicy, Query, QueryCache } from '../query';
import type { AddonCollection, InstalledAddon } from './collection';

/** Catalog and meta requests give up after this long. */
export const BROWSE_TIMEOUT_MS = 10000;
/** Stream and subtitle requests fan out to every addon at once, each with this long. */
export const PLAY_TIMEOUT_MS = 15000;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Used when an addon sends no cache hints of its own. */
export const CATALOG_POLICY: CachePolicy = {
  freshFor: 60 * MINUTE,
  revalidateFor: 3 * DAY,
  errorFor: 14 * DAY,
};
export const META_POLICY: CachePolicy = {
  freshFor: 12 * 60 * MINUTE,
  revalidateFor: 14 * DAY,
  errorFor: 60 * DAY,
};

/**
 * Stream links expire (debrid links especially), so a stream list is reused
 * for a few minutes at most and never kept across launches.
 */
export const STREAM_POLICY: CachePolicy = { freshFor: 5 * MINUTE, revalidateFor: 0, errorFor: 0 };
export const SUBTITLES_POLICY: CachePolicy = {
  freshFor: 60 * MINUTE,
  revalidateFor: 0,
  errorFor: 0,
};

const METAHUB = 'https://images.metahub.space';

/**
 * Fills in a missing backdrop or title logo for IMDb titles from Metahub, the
 * public image service Cinemeta itself points to. A URL that turns out not to
 * exist simply fails to load, and the screen falls back to the name.
 */
export function withArtwork<T extends MetaPreview>(item: T): T {
  if (!/^tt\d+$/.test(item.id) || (item.background && item.logo)) return item;
  return {
    ...item,
    background: item.background ?? `${METAHUB}/background/medium/${item.id}/img`,
    logo: item.logo ?? `${METAHUB}/logo/medium/${item.id}/img`,
  };
}

export class NotFoundError extends Error {
  constructor() {
    super('No addon knows this title');
    this.name = 'NotFoundError';
  }
}

export interface CatalogOptions {
  /**
   * Keep the response across launches (the default). Searches pass false:
   * every term typed would otherwise push Home's rows out of storage.
   */
  persist?: boolean;
}

/** One addon's answer to a fan-out request. */
export interface AddonAnswer<T> {
  addon: InstalledAddon;
  query: Query<T>;
}

/** What the subtitles request can say about the file, so addons can match it exactly. */
export interface SubtitleHints {
  videoHash?: string;
  /** Bytes. */
  videoSize?: number;
  filename?: string;
}

export interface AddonClient {
  catalog(
    addon: InstalledAddon,
    type: ContentType,
    catalogId: string,
    extra?: readonly ExtraArg[],
    options?: CatalogOptions,
  ): Query<MetaPreview[]>;
  /** Asks addons that declare meta for this type and ID, in priority order, until one knows it. */
  meta(type: ContentType, id: string): Query<MetaDetail>;
  /**
   * One query per addon that declares streams for this type and video ID, in
   * priority order. They all run at once, so the picker fills as they answer.
   */
  streams(type: ContentType, videoId: string): Array<AddonAnswer<Stream[]>>;
  /** The same for subtitles. */
  subtitles(
    type: ContentType,
    videoId: string,
    hints?: SubtitleHints,
  ): Array<AddonAnswer<Subtitle[]>>;
}

function subtitleExtra(hints: SubtitleHints): ExtraArg[] {
  const extra: ExtraArg[] = [];
  if (hints.videoHash) extra.push(['videoHash', hints.videoHash]);
  if (hints.videoSize) extra.push(['videoSize', String(hints.videoSize)]);
  if (hints.filename) extra.push(['filename', hints.filename]);
  return extra;
}

export function createAddonClient(options: {
  collection: AddonCollection;
  queries: QueryCache;
  limiter: Limiter;
  fetchJson: FetchJson;
}): AddonClient {
  const { collection, queries, limiter, fetchJson } = options;
  const get = (url: string) => limiter.run(() => fetchJson(url, { timeoutMs: BROWSE_TIMEOUT_MS }));
  const getForPlay = (url: string) =>
    limiter.run(() => fetchJson(url, { timeoutMs: PLAY_TIMEOUT_MS }));

  return {
    catalog(addon, type, catalogId, extra = [], options = {}) {
      const url = resourceUrl(addon.transportUrl, 'catalog', type, catalogId, extra);
      return queries.query(url, {
        policy: CATALOG_POLICY,
        persist: options.persist !== false,
        fetch: async () => {
          const response = parseCatalogResponse(await get(url), type);
          return { value: response.metas.map(withArtwork), hints: response.cache };
        },
      });
    },

    meta(type, id) {
      return queries.query(`meta:${type}:${id}`, {
        policy: META_POLICY,
        persist: true,
        fetch: async () => {
          const addons = collection
            .get()
            .addons.filter((addon) => supportsResource(addon.manifest, 'meta', type, id));
          let failure: unknown;
          for (const addon of addons) {
            try {
              const url = resourceUrl(addon.transportUrl, 'meta', type, id);
              const response = parseMetaResponse(await get(url), type);
              if (response.meta) {
                return { value: withArtwork(response.meta), hints: response.cache };
              }
            } catch (error) {
              failure = error;
            }
          }
          throw failure ?? new NotFoundError();
        },
      });
    },

    streams(type, videoId) {
      return collection
        .get()
        .addons.filter((addon) => supportsResource(addon.manifest, 'stream', type, videoId))
        .map((addon) => {
          const url = resourceUrl(addon.transportUrl, 'stream', type, videoId);
          return {
            addon,
            query: queries.query(url, {
              policy: STREAM_POLICY,
              persist: false,
              fetch: async () => {
                const response = parseStreamResponse(await getForPlay(url));
                // The addon's own cache hints are ignored: links can expire long before them.
                return { value: response.streams, hints: {} };
              },
            }),
          };
        });
    },

    subtitles(type, videoId, hints = {}) {
      const extra = subtitleExtra(hints);
      return collection
        .get()
        .addons.filter((addon) => supportsResource(addon.manifest, 'subtitles', type, videoId))
        .map((addon) => {
          const url = resourceUrl(addon.transportUrl, 'subtitles', type, videoId, extra);
          return {
            addon,
            query: queries.query(url, {
              policy: SUBTITLES_POLICY,
              persist: false,
              fetch: async () => {
                const response = parseSubtitlesResponse(await getForPlay(url));
                return { value: response.subtitles, hints: {} };
              },
            }),
          };
        });
    },
  };
}
