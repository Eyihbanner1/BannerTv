import {
  type ContentType,
  type ExtraArg,
  type MetaDetail,
  type MetaPreview,
  parseCatalogResponse,
  parseMetaResponse,
  resourceUrl,
  supportsResource,
} from '@bannertv/protocol';
import type { FetchJson } from '../http';
import type { Limiter } from '../limiter';
import type { CachePolicy, Query, QueryCache } from '../query';
import type { AddonCollection, InstalledAddon } from './collection';

/** Catalog and meta requests give up after this long. */
export const BROWSE_TIMEOUT_MS = 10000;

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

export interface AddonClient {
  catalog(
    addon: InstalledAddon,
    type: ContentType,
    catalogId: string,
    extra?: readonly ExtraArg[],
  ): Query<MetaPreview[]>;
  /** Asks addons that declare meta for this type and ID, in priority order, until one knows it. */
  meta(type: ContentType, id: string): Query<MetaDetail>;
}

export function createAddonClient(options: {
  collection: AddonCollection;
  queries: QueryCache;
  limiter: Limiter;
  fetchJson: FetchJson;
}): AddonClient {
  const { collection, queries, limiter, fetchJson } = options;
  const get = (url: string) => limiter.run(() => fetchJson(url, { timeoutMs: BROWSE_TIMEOUT_MS }));

  return {
    catalog(addon, type, catalogId, extra = []) {
      const url = resourceUrl(addon.transportUrl, 'catalog', type, catalogId, extra);
      return queries.query(url, {
        policy: CATALOG_POLICY,
        persist: true,
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
  };
}
