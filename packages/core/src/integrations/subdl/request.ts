import { subdlCodeFor } from './languages';

/**
 * What BannerTV asks SubDL (https://subdl.com), with the viewer's own key:
 * the IMDb id, the season and episode, and one or two languages. Never the
 * file name, the hash or the stream's link (ADR 0003, step D).
 */

export const SUBDL_API = 'https://api.subdl.com';
export const SUBDL_DOWNLOADS = 'https://dl.subdl.com';

/** v2 with the key in a header (it needs a preflight), or v1 with the key in the query. */
export type SubdlRoute = 'v2-header' | 'v1-query';
/** Chosen by the keyed test on the TV (ADR 0003, step D, needs a real key: a). */
export const SUBDL_ROUTE: SubdlRoute = 'v2-header';
/** Files listed by their unpacked address rather than the row's ZIP (needs a real key: c). */
export const SUBDL_PREFER_UNPACK = true;

export interface SubdlAsk {
  type: 'movie' | 'tv';
  /** "tt0111161". */
  imdbId: string;
  season?: number;
  episode?: number;
  /** SubDL codes, 1 or 2, upper case, in asking order. */
  languages: string[];
}

export type SubdlSkip = 'not imdb' | 'special' | 'subtitles off';

const FILM_ID = /^tt\d{1,10}$/;
const EPISODE_ID = /^(tt\d{1,10}):(\d{1,4}):(\d{1,5})$/;
const MAX_LANGUAGES = 2;

/** What to ask SubDL for a video, or why it is not asked. */
export function subdlAskFor(
  type: string,
  videoId: string,
  wanted: readonly string[],
): SubdlAsk | { skip: SubdlSkip } {
  const askType = type === 'series' ? 'tv' : 'movie';
  let ask: SubdlAsk;
  const episode = EPISODE_ID.exec(videoId);
  if (episode) {
    const season = Number(episode[2]);
    if (season === 0) return { skip: 'special' };
    ask = {
      type: askType,
      imdbId: episode[1]!,
      season,
      episode: Number(episode[3]),
      languages: [],
    };
  } else if (FILM_ID.test(videoId)) {
    ask = { type: askType, imdbId: videoId, languages: [] };
  } else {
    return { skip: 'not imdb' };
  }
  for (const language of wanted) {
    const code = subdlCodeFor(language);
    if (code === undefined || ask.languages.indexOf(code) !== -1) continue;
    ask.languages.push(code);
    if (ask.languages.length === MAX_LANGUAGES) break;
  }
  if (ask.languages.length === 0) return { skip: 'subtitles off' };
  return ask;
}

/**
 * The answer's place in the query cache. Never holds the key. Version 2:
 * answers saved before links signed with the key were read listed no files.
 */
export function subdlCacheKey(ask: SubdlAsk): string {
  return [
    'subdl:2',
    ask.type,
    ask.imdbId,
    ask.season ?? '',
    ask.episode ?? '',
    ask.languages.join(','),
  ].join('|');
}

export interface SubdlRequest {
  url: string;
  headers: Record<string, string>;
}

const query = (pairs: ReadonlyArray<readonly [string, string | number]>) =>
  pairs.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join('&');

const codes = (languages: readonly string[], lower: boolean) =>
  languages.map((code) => encodeURIComponent(lower ? code.toLowerCase() : code)).join(',');

/**
 * The search. With v1 the key is in the URL, which goes to the request and
 * nowhere else.
 */
export function subdlSearchRequest(
  ask: SubdlAsk,
  key: string,
  route: SubdlRoute = SUBDL_ROUTE,
): SubdlRequest {
  const episode = ask.season !== undefined && ask.episode !== undefined;
  if (route === 'v1-query') {
    const head = query([
      ['api_key', key],
      ['imdb_id', ask.imdbId],
      ['type', ask.type],
      ...(episode
        ? ([
            ['season_number', ask.season!],
            ['episode_number', ask.episode!],
          ] as const)
        : []),
    ]);
    const tail = query([
      ['subs_per_page', 30],
      ['releases', 1],
      ['unpack', 1],
    ]);
    return {
      url: `${SUBDL_API}/api/v1/subtitles?${head}&languages=${codes(ask.languages, false)}&${tail}`,
      headers: {},
    };
  }
  const head = query([
    ['imdb_id', ask.imdbId],
    ['type', ask.type],
    ...(episode
      ? ([
          ['season', ask.season!],
          ['episode', ask.episode!],
        ] as const)
      : []),
  ]);
  const tail = query([
    ['subs_per_page', 30],
    ['releases', 1],
    ['unpack', 1],
  ]);
  return {
    url: `${SUBDL_API}/api/v2/subtitles/search?${head}&languages=${codes(ask.languages, true)}&${tail}`,
    headers: { 'X-API-Key': key },
  };
}

/** Whether a key works: SubDL's account check, which counts no search. */
export function subdlKeyCheckRequest(key: string): SubdlRequest {
  return { url: `${SUBDL_API}/api/v2/me`, headers: { 'X-API-Key': key } };
}
