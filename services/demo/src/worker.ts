/**
 * BannerTV Demo: a Stremio-protocol addon of a few Blender open movies.
 *
 * The films, artwork and captions are static assets (see wrangler.toml), which
 * Cloudflare serves without running this code. Anything that isn't a file
 * comes here: the manifest, the catalog and its search, title details, stream
 * lists, and the credits page at the root. Nothing here logs, and nothing is
 * stored.
 *
 * A Worker module may export only its handler (and types), so the answers
 * themselves live in addon.ts.
 */
import { CATALOG_ID, catalog, creditsPage, findFilm, manifest, meta, streams } from './addon';

// The TV app runs from file://, so every answer is cross-origin. Its requests
// are simple GETs, but answer preflights too, for other clients.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, maxAge: number, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function notFound(): Response {
  return json({ error: 'Not found' }, 60, 404);
}

/** A path segment as the client sent it: the app encodes ids, so `bannertv:x` arrives as `bannertv%3Ax`. */
function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Stremio extras: `search=big%20buck&skip=0`, the last path segment before `.json`. */
function readExtra(segment: string | undefined): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  if (segment === undefined) return extra;
  for (const pair of segment.split('&')) {
    const at = pair.indexOf('=');
    if (at < 1) return undefined;
    const key = decode(pair.slice(0, at));
    const value = decode(pair.slice(at + 1).replace(/\+/g, ' '));
    if (key === undefined || value === undefined) return undefined;
    extra[key] = value;
  }
  return extra;
}

function route(url: URL): Response {
  const path = url.pathname;
  const origin = url.origin;
  if (path === '/') {
    return new Response(creditsPage(origin), {
      headers: {
        ...CORS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (path === '/manifest.json') return json(manifest(origin), 3600);
  if (!path.endsWith('.json')) return notFound();

  // /{resource}/{type}/{id}.json or /{resource}/{type}/{id}/{extra}.json
  const parts = path.slice(1, -'.json'.length).split('/');
  if (parts.length < 3 || parts.length > 4) return notFound();
  const [resource, type, rawId, rawExtra] = parts as [string, string, string, string | undefined];
  const id = decode(rawId);
  const extra = readExtra(rawExtra);
  if (id === undefined || extra === undefined) return notFound();

  if (resource === 'catalog') {
    if (type !== 'movie' || id !== CATALOG_ID) return notFound();
    return json(catalog(origin, extra), extra.search === undefined ? 3600 : 600);
  }
  if (resource === 'meta') {
    const film = type === 'movie' ? findFilm(id) : undefined;
    // A null meta tells the app this addon doesn't know the title, without an error.
    return json({ meta: film ? meta(origin, film) : null }, 3600);
  }
  if (resource === 'stream') {
    // An empty list, not a 404, so the player doesn't report this addon as failing.
    return json(streams(origin, type === 'movie' ? findFilm(id) : undefined), 300);
  }
  return notFound();
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { ...CORS, Allow: 'GET, HEAD, OPTIONS' } });
    }
    const response = route(new URL(request.url));
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  },
};
