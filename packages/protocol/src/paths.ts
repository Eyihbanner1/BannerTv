import type { ContentType, ResourceName } from './types';

const MANIFEST_SUFFIX = '/manifest.json';

/** One catalog extra, for example ['search', 'game of thrones'] or ['skip', '100']. */
export type ExtraArg = readonly [name: string, value: string];

/**
 * Turns what a user typed or scanned into a manifest URL: trims it, maps the
 * stremio:// deep-link scheme to https, adds https:// when no scheme is given
 * and /manifest.json when it is missing. Returns undefined when it cannot be
 * an addon URL at all.
 */
export function normalizeManifestUrl(input: string): string | undefined {
  let url = input.trim();
  if (url === '') return undefined;
  if (/^stremio:\/\//i.test(url)) url = `https://${url.slice('stremio://'.length)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\/[^\s/?#]+/i.test(url) || /\s/.test(url)) return undefined;
  url = url.replace(/[?#].*$/, '');
  if (!url.endsWith(MANIFEST_SUFFIX)) url = `${url.replace(/\/+$/, '')}${MANIFEST_SUFFIX}`;
  return url;
}

/** The base every resource path hangs off: the manifest URL without /manifest.json. */
export function addonBaseUrl(transportUrl: string): string {
  return transportUrl.endsWith(MANIFEST_SUFFIX)
    ? transportUrl.slice(0, -MANIFEST_SUFFIX.length)
    : transportUrl.replace(/\/+$/, '');
}

/** Extras as one path segment, e.g. `search=game%20of%20thrones&skip=100`. */
export function encodeExtra(extra: readonly ExtraArg[]): string {
  return extra
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * The URL of one resource request, for example
 * `{base}/catalog/movie/top/genre=Action.json` or `{base}/meta/series/tt0944947.json`.
 * Path parts are encoded like stremio-core does, so `tt0944947:1:1` becomes
 * `tt0944947%3A1%3A1`.
 */
export function resourceUrl(
  transportUrl: string,
  resource: ResourceName,
  type: ContentType,
  id: string,
  extra: readonly ExtraArg[] = [],
): string {
  const parts = [resource, type, id].map((part) => encodeURIComponent(part));
  const extraPart = extra.length > 0 ? `/${encodeExtra(extra)}` : '';
  return `${addonBaseUrl(transportUrl)}/${parts.join('/')}${extraPart}.json`;
}
