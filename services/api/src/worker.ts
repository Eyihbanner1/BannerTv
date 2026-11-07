/**
 * BannerTV's service for Trakt and TMDB (ADR 0004, item 9): a Cloudflare
 * Worker that holds the Trakt client id (and secret, for an app old enough
 * to have one) and the TMDB key, so neither the app package nor the
 * repository does.
 *
 * The TV posts Trakt calls to /trakt as a plain-text JSON body and gets
 * Trakt's status and data back as JSON; it asks TMDB through /tmdb/<path>,
 * and Search asks /search/<route> (search.ts), which answers with titles by
 * IMDb id. Only the paths BannerTV uses are passed on, and TMDB's answers
 * are cached for a day at the edge. Requests carry viewers' Trakt tokens, so nothing
 * here logs, and no answer repeats a secret, a token or a request body.
 *
 * A Worker module may export only its handler and Durable Object classes (and
 * types), so the rules the tests check live in rules.ts.
 */
import pkg from '../package.json';
import {
  isJson,
  MAX_BODY_BYTES,
  readRetryAfter,
  readTmdbCall,
  readTraktCall,
  TMDB_CACHE_SECONDS,
  tmdbCacheKey,
  tmdbRequest,
  traktAnswer,
  type TraktCall,
  traktRequest,
  UPSTREAM_TIMEOUT_MS,
  type UpstreamRequest,
} from './rules';
import { readSearchCall, runSearch, searchCacheKey, type TmdbAnswer, type TmdbGet } from './search';

// The Workers runtime's own cache, which the WebWorker types do not know.
declare global {
  interface CacheStorage {
    readonly default: Cache;
  }
}

export interface Env {
  TRAKT_CLIENT_ID?: string;
  /** Optional: Trakt issues no secret to apps made since October 2026. */
  TRAKT_CLIENT_SECRET?: string;
  TMDB_API_KEY?: string;
}

export interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

const USER_AGENT = `BannerTV/${pkg.version}`;
const JSON_TYPE = 'application/json; charset=utf-8';
const CACHED = `public, max-age=${TMDB_CACHE_SECONDS}`;

// The TV app runs from file://, so its calls are cross-origin. They are simple
// requests (GET, or POST with a text body), so browsers send no preflight.
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
};

function answer(body: string, status: number, cacheControl = 'no-store'): Response {
  return new Response(body, {
    status,
    headers: { ...HEADERS, 'Cache-Control': cacheControl, 'Content-Type': JSON_TYPE },
  });
}

function json(value: unknown, status = 200): Response {
  return answer(JSON.stringify(value), status);
}

/** A secret as set, or undefined when it is missing or blank. */
function secret(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}

/** The request's body as text, or undefined when it is longer than `limit` bytes. */
async function readBody(request: Request, limit: number): Promise<string | undefined> {
  if (Number(request.headers.get('Content-Length')) > limit) return undefined;
  if (!request.body) return '';
  // Read in chunks, so a body sent without a length is not read whole before it is refused.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

interface Upstream {
  status: number;
  text: string;
  headers: Headers;
}

/** Trakt's or TMDB's answer, or undefined when none came within the timeout. */
async function send(request: UpstreamRequest): Promise<Upstream | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    // The timeout covers the body too, which a slow server can trickle.
    return { status: response.status, text: await response.text(), headers: response.headers };
  } catch {
    // The error can quote the address, which carries the TMDB key, so it goes nowhere.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function trakt(request: Request, env: Env): Promise<Response> {
  const clientId = secret(env.TRAKT_CLIENT_ID);
  if (!clientId) return json({ error: 'unconfigured' }, 503);
  const clientSecret = secret(env.TRAKT_CLIENT_SECRET);

  let call: TraktCall | undefined;
  try {
    const text = await readBody(request, MAX_BODY_BYTES);
    call = text === undefined ? undefined : readTraktCall(JSON.parse(text));
  } catch {
    call = undefined;
  }
  if (!call) return json({ error: 'path' }, 400);

  const upstream = await send(traktRequest(call, { clientId, clientSecret }, USER_AGENT));
  if (!upstream) return json({ error: 'upstream' }, 502);
  const retryAfter = readRetryAfter(upstream.headers.get('Retry-After'), Date.now());
  return answer(traktAnswer(upstream.status, upstream.text, retryAfter), 200);
}

/** The edge cache, when this runtime has one. */
function edgeCache(): Cache | undefined {
  try {
    return caches.default;
  } catch {
    return undefined;
  }
}

async function cached(cache: Cache | undefined, key: Request): Promise<string | undefined> {
  try {
    const hit = await cache?.match(key);
    return hit ? await hit.text() : undefined;
  } catch {
    // A cache that fails is a miss.
    return undefined;
  }
}

/** One TMDB call for Search: its status and JSON, or undefined when none came or it is not JSON. */
async function tmdbGet(call: TmdbGet, key: string): Promise<TmdbAnswer> {
  const upstream = await send(tmdbRequest(call, key, USER_AGENT));
  if (!upstream) return undefined;
  try {
    return { status: upstream.status, data: JSON.parse(upstream.text) as unknown };
  } catch {
    return undefined;
  }
}

async function search(request: Request, env: Env, ctx: Context): Promise<Response> {
  const key = secret(env.TMDB_API_KEY);
  if (!key) return json({ error: 'unconfigured' }, 503);
  const url = new URL(request.url);
  const call = readSearchCall(url.pathname.slice('/search/'.length), url.search);
  if (!call) return json({ error: 'path' }, 400);

  const cache = edgeCache();
  const cacheKey = new Request(searchCacheKey(url.origin, call));
  const hit = await cached(cache, cacheKey);
  if (hit !== undefined) return answer(hit, 200, CACHED);

  const result = await runSearch(call, (get) => tmdbGet(get, key), Date.now());
  if (result.status !== 200) return json(result.body, result.status);
  // An answer missing titles TMDB failed to give is not kept, and says so, so the app does
  // not keep it either: the next search may do better.
  if (!result.complete) {
    return answer(JSON.stringify({ ...(result.body as object), partial: true }), 200);
  }
  const body = JSON.stringify(result.body);
  if (cache) {
    const copy = new Response(body, {
      headers: { 'Cache-Control': CACHED, 'Content-Type': JSON_TYPE },
    });
    ctx.waitUntil(cache.put(cacheKey, copy).catch(() => undefined));
  }
  return answer(body, 200, CACHED);
}

async function tmdb(request: Request, env: Env, ctx: Context): Promise<Response> {
  const key = secret(env.TMDB_API_KEY);
  if (!key) return json({ error: 'unconfigured' }, 503);
  const url = new URL(request.url);
  const call = readTmdbCall(url.pathname.slice('/tmdb/'.length), url.search);
  if (!call) return json({ error: 'path' }, 400);

  const cache = edgeCache();
  const cacheKey = new Request(tmdbCacheKey(url.origin, call));
  const hit = await cached(cache, cacheKey);
  if (hit !== undefined) return answer(hit, 200, CACHED);

  const upstream = await send(tmdbRequest(call, key, USER_AGENT));
  if (!upstream || !isJson(upstream.text)) return json({ error: 'upstream' }, 502);
  if (upstream.status !== 200) return answer(upstream.text, upstream.status);
  if (cache) {
    const copy = new Response(upstream.text, {
      headers: { 'Cache-Control': CACHED, 'Content-Type': JSON_TYPE },
    });
    ctx.waitUntil(cache.put(cacheKey, copy).catch(() => undefined));
  }
  return answer(upstream.text, 200, CACHED);
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const { pathname } = new URL(request.url);

    // The TV never sends a preflight, but answer one in case another client does.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...HEADERS,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method === 'GET' && pathname === '/status') {
      return json({
        trakt: Boolean(secret(env.TRAKT_CLIENT_ID)),
        tmdb: Boolean(secret(env.TMDB_API_KEY)),
        // This Worker answers /search: an app finding it false or missing does not ask.
        search: Boolean(secret(env.TMDB_API_KEY)),
      });
    }
    if (request.method === 'POST' && pathname === '/trakt') return trakt(request, env);
    if (request.method === 'GET' && pathname.startsWith('/tmdb/')) return tmdb(request, env, ctx);
    if (request.method === 'GET' && pathname.startsWith('/search/')) {
      return search(request, env, ctx);
    }
    return json({ error: 'not-found' }, 404);
  },
};
