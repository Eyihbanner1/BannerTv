/** How long the Worker waits for Trakt or TMDB, reading the answer included. */
export const UPSTREAM_TIMEOUT_MS = 30 * 1000;
/** The most the TV sends in one Trakt call; a big watchlist or history change fits easily. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Trakt's tokens are 64 characters, so this is plenty and still keeps headers small. */
export const MAX_TOKEN_LENGTH = 4096;
/** TMDB's answers are kept at the edge for a day. */
export const TMDB_CACHE_SECONDS = 24 * 60 * 60;

export const TRAKT_ORIGIN = 'https://api.trakt.tv';
/** Trakt takes every OAuth call (device codes, tokens, refresh, revoke) here, not on the API host. */
export const TRAKT_AUTH_ORIGIN = 'https://auth.trakt.tv';
export const TMDB_BASE = 'https://api.themoviedb.org/3';
/** The redirect URI of a Trakt app without a web page, as registered with BannerTV's. */
export const TRAKT_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

export type TraktMethod = 'GET' | 'POST' | 'DELETE';

/** Every Trakt call BannerTV makes, as method and path without the query. */
const TRAKT_ROUTES = new Set([
  'POST /oauth/device/code',
  'POST /oauth/device/token',
  'POST /oauth/token',
  'POST /oauth/revoke',
  'GET /users/settings',
  'POST /scrobble/start',
  'POST /scrobble/pause',
  'POST /scrobble/stop',
  'GET /sync/last_activities',
  'GET /sync/playback',
  'GET /sync/playback/movies',
  'GET /sync/playback/episodes',
  'GET /sync/watched/movies',
  'GET /sync/watched/shows',
  'GET /sync/watchlist',
  'GET /sync/watchlist/movies',
  'GET /sync/watchlist/shows',
  'POST /sync/watchlist',
  'POST /sync/watchlist/remove',
  'POST /sync/history',
  'POST /sync/history/remove',
]);

/**
 * The one field the TV sends to each OAuth path (none for a new device code).
 * The Worker builds the rest of the body itself, so the TV cannot change the
 * client id, the secret or the grant.
 */
const OAUTH_FIELDS = new Map<string, string | undefined>([
  ['/oauth/device/code', undefined],
  ['/oauth/device/token', 'code'],
  ['/oauth/token', 'refresh_token'],
  ['/oauth/revoke', 'token'],
]);

type Check = (value: string) => boolean;

const isCount: Check = (value) => /^\d{1,6}$/.test(value);

const TRAKT_QUERY = new Map<string, Check>([
  ['extended', (value) => /^[a-z_]{1,32}(,[a-z_]{1,32}){0,7}$/.test(value)],
  ['page', isCount],
  ['limit', isCount],
]);

/** Every TMDB path BannerTV asks for, under TMDB's /3/. */
const TMDB_PATHS = [
  /^find\/tt\d{1,10}$/,
  /^movie\/\d{1,10}$/,
  /^tv\/\d{1,10}$/,
  /^tv\/\d{1,10}\/season\/\d{1,4}$/,
  /^movie\/\d{1,10}\/external_ids$/,
  /^tv\/\d{1,10}\/external_ids$/,
];

const TMDB_APPENDS = new Set([
  'images',
  'credits',
  'aggregate_credits',
  'release_dates',
  'content_ratings',
  'external_ids',
]);

/** A comma-separated list of items that each pass `check`, none twice. */
function isList(value: string, check: Check): boolean {
  const items = value.split(',');
  return items.every(check) && new Set(items).size === items.length;
}

const TMDB_QUERY = new Map<string, Check>([
  ['append_to_response', (value) => isList(value, (item) => TMDB_APPENDS.has(item))],
  // "null" asks for images with no text in them, the backdrops Details wants.
  ['include_image_language', (value) => isList(value, (item) => /^([a-z]{2}|null)$/.test(item))],
  ['language', (value) => /^[a-z]{2}(-[A-Z]{2})?$/.test(value)],
  ['external_source', (value) => value === 'imdb_id'],
]);

/**
 * The parameters of a query when each is allowed, given once and has a value
 * its check accepts. The checks let through only letters, digits, `_`, `-`
 * and `,`, so the values can go into a query again without encoding.
 */
function readQuery(search: string, allowed: Map<string, Check>): Map<string, string> | undefined {
  const params = new Map<string, string>();
  for (const [name, value] of new URLSearchParams(search)) {
    const check = allowed.get(name);
    if (!check || params.has(name) || !check(value)) return undefined;
    params.set(name, value);
  }
  return params;
}

/** A query in name order, without the `?`. Names are unique, so the sort cannot tie. */
function queryString(params: Map<string, string>): string {
  return Array.from(params.keys())
    .sort()
    .map((name) => `${name}=${params.get(name)}`)
    .join('&');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A token or code as a header or OAuth field can carry it: printable ASCII, no spaces. */
function isToken(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7e]+$/.test(value)
  );
}

/** A Trakt call the TV asked for, checked against the allow-list. */
export interface TraktCall {
  method: TraktMethod;
  /** The path without its query. */
  path: string;
  /** The checked query in name order, without the `?`; empty when there is none. */
  query: string;
  /** The viewer's access token, for the Authorization header. */
  token?: string;
  /** What goes to Trakt as JSON. For an OAuth path, only the field the TV may set there. */
  body?: unknown;
}

/**
 * The TV's `{method, path, token?, body?}`, or undefined when it asks for
 * anything the Worker does not pass on. A null token or body counts as none.
 */
export function readTraktCall(value: unknown): TraktCall | undefined {
  if (!isObject(value)) return undefined;
  const { method, path, token, body } = value;
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') return undefined;
  if (typeof path !== 'string') return undefined;
  const mark = path.indexOf('?');
  const pathname = mark === -1 ? path : path.slice(0, mark);
  if (!TRAKT_ROUTES.has(`${method} ${pathname}`)) return undefined;
  const params = readQuery(mark === -1 ? '' : path.slice(mark + 1), TRAKT_QUERY);
  if (!params) return undefined;
  if (token !== undefined && token !== null && !isToken(token)) return undefined;

  const call: TraktCall = { method, path: pathname, query: queryString(params) };
  if (isToken(token)) call.token = token;
  if (OAUTH_FIELDS.has(pathname)) {
    const field = OAUTH_FIELDS.get(pathname);
    call.body = {};
    if (field) {
      const sent = isObject(body) ? body[field] : undefined;
      if (!isToken(sent)) return undefined;
      call.body = { [field]: sent };
    }
  } else if (method === 'POST' && body !== undefined && body !== null) {
    call.body = body;
  }
  return call;
}

export interface TraktSecrets {
  clientId: string;
  /**
   * Only apps made before October 2026 have one: Trakt issues none to newer
   * apps, and their device sign-in, refresh and revoke need the client id alone.
   */
  clientSecret?: string;
}

/** A request for Trakt or TMDB, ready for fetch. */
export interface UpstreamRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * The request to Trakt for a checked call. OAuth paths go to Trakt's auth
 * host and take the app's keys in the body (the secret only when the app has
 * one); every other path takes the client id as a header, with the viewer's
 * token when the TV sent one.
 */
export function traktRequest(
  call: TraktCall,
  secrets: TraktSecrets,
  userAgent: string,
): UpstreamRequest {
  const oauth = OAUTH_FIELDS.has(call.path);
  const origin = oauth ? TRAKT_AUTH_ORIGIN : TRAKT_ORIGIN;
  const url = `${origin}${call.path}${call.query ? `?${call.query}` : ''}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
  };

  if (oauth) {
    const body: Record<string, unknown> = isObject(call.body) ? { ...call.body } : {};
    body.client_id = secrets.clientId;
    if (secrets.clientSecret && call.path !== '/oauth/device/code') {
      body.client_secret = secrets.clientSecret;
    }
    if (call.path === '/oauth/token') {
      body.redirect_uri = TRAKT_REDIRECT_URI;
      body.grant_type = 'refresh_token';
    }
    return { method: call.method, url, headers, body: JSON.stringify(body) };
  }

  headers['trakt-api-version'] = '2';
  headers['trakt-api-key'] = secrets.clientId;
  if (call.token) headers.Authorization = `Bearer ${call.token}`;
  const request: UpstreamRequest = { method: call.method, url, headers };
  if (call.method === 'POST') request.body = JSON.stringify(call.body ?? {});
  return request;
}

/** A TMDB call the TV asked for, checked against the allow-list. */
export interface TmdbCall {
  /** The path under TMDB's /3/, such as `movie/603`. */
  path: string;
  /** The checked query in name order, without the key or the `?`; empty when there is none. */
  query: string;
}

/**
 * The TMDB call for the path after `/tmdb/` and the query (with or without
 * its `?`), or undefined when it is not one the Worker passes on.
 */
export function readTmdbCall(path: string, search: string): TmdbCall | undefined {
  if (!TMDB_PATHS.some((pattern) => pattern.test(path))) return undefined;
  const params = readQuery(search, TMDB_QUERY);
  if (!params) return undefined;
  // Without it TMDB cannot tell which kind of id it was given.
  if (path.startsWith('find/') && !params.has('external_source')) return undefined;
  return { path, query: queryString(params) };
}

/**
 * The request to TMDB for a checked call. A v4 read access token (a JWT, so
 * it starts "eyJ") goes in the Authorization header; a v3 API key goes in the
 * query, as TMDB asks.
 */
export function tmdbRequest(call: TmdbCall, key: string, userAgent: string): UpstreamRequest {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': userAgent };
  let query = call.query;
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else query += `${query ? '&' : ''}api_key=${encodeURIComponent(key)}`;
  return { method: 'GET', url: `${TMDB_BASE}/${call.path}${query ? `?${query}` : ''}`, headers };
}

/** Where a TMDB answer is cached: the Worker's own address for the call, so never the key. */
export function tmdbCacheKey(origin: string, call: TmdbCall): string {
  return `${origin}/tmdb/${call.path}${call.query ? `?${call.query}` : ''}`;
}

/** Retry-After in seconds, from seconds or an HTTP date; undefined when missing or unreadable. */
export function readRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^\d{1,9}$/.test(text)) return Number(text);
  // Only the HTTP date format: Date.parse alone takes "-5" as a year.
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    return undefined;
  }
  const date = Date.parse(text);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The TV's answer to a Trakt call as JSON text: Trakt's status, its body as
 * data (null when empty or not JSON) and Retry-After when Trakt sent one.
 * The body goes in as Trakt wrote it once it parses, rather than parsed and
 * written out again, since a long history would cost CPU time twice.
 */
export function traktAnswer(status: number, text: string, retryAfter?: number): string {
  const data = isJson(text) ? text : 'null';
  const retry = retryAfter === undefined ? '' : `,"retryAfter":${retryAfter}`;
  return `{"status":${status},"data":${data}${retry}}`;
}
