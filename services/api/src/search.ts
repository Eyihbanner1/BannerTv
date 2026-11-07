/**
 * Search's routes into TMDB (ADR 0004, item 13 as changed on 6 Nov 2026:
 * Search may ask TMDB; Home and Discover still never do).
 *
 * Each route takes a few checked values, asks TMDB with the adult filter
 * off, and answers with titles by their IMDb ids, ready to draw and to open
 * on Details: TMDB's ids mean nothing to the addons that play titles. That
 * takes one more TMDB call a title, so the Worker makes them, at most
 * MAX_TITLES a route, and the whole answer is cached for a day.
 *
 * Nothing here holds a key: `get` asks TMDB with it.
 */

/** Titles a route answers with at most: one TMDB page. */
export const MAX_TITLES = 20;
/** People and titles /search/multi suggests at most. */
export const MAX_PEOPLE = 5;
export const MAX_SUGGESTED = 8;
/** The longest text a route searches for. */
export const MAX_QUERY_LENGTH = 100;
/** How many TMDB calls a route has open at once: the Workers runtime allows six. */
export const PARALLEL_CALLS = 6;

export type SearchType = 'movie' | 'series';
type TmdbKind = 'movie' | 'tv';

const KIND: Record<SearchType, TmdbKind> = { movie: 'movie', series: 'tv' };
const TYPE: Record<TmdbKind, SearchType> = { movie: 'movie', tv: 'series' };

/** UK ratings a kids profile may allow, as TMDB writes GB film certificates. */
const KIDS_RATINGS = ['U', 'PG', '12'];

/** TMDB's genre names by id, films and series together (their ids do not clash). */
const GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
};
/** Series genres a person's credits leave out: they are guest spots, not their work. */
const APPEARANCES = [10763, 10767];

/** A discover row, as the app asks for it. */
export interface DiscoverCall {
  route: 'discover';
  type: SearchType;
  /** Genre ids a title must all have. */
  genres: number[];
  /** Genre ids a title must have one of. */
  anyGenres: number[];
  /** Keyword ids, any of which will do. */
  keywords: number[];
  language?: string;
  country?: string;
  from?: number;
  to?: number;
  newest: boolean;
  /** A kids profile's limit: only titles rated this or lower in the UK. */
  certification?: string;
}

/** Search's suggestions and people for some words. */
export interface MultiCall {
  route: 'multi';
  query: string;
}

/** Someone's films and series. */
export interface PersonCall {
  route: 'person';
  id: number;
  /** cast: what they acted in; directing or writing: their crew credits in it; any: both. */
  role: 'cast' | 'directing' | 'writing' | 'any';
  ratings: boolean;
}

/** Titles TMDB recommends for one it finds by name. */
export interface LikeCall {
  route: 'like';
  query: string;
  type?: SearchType;
  ratings: boolean;
}

/** Titles TMDB finds by name, for a kids profile's search. */
export interface TitlesCall {
  route: 'titles';
  query: string;
  type?: SearchType;
  ratings: boolean;
}

export type SearchCall = DiscoverCall | MultiCall | PersonCall | LikeCall | TitlesCall;

type Params = Map<string, string>;

const isId = (value: string) => /^\d{1,9}$/.test(value);

/** A comma list of up to `max` ids, none twice, or undefined. */
function idList(value: string | undefined, max: number): number[] | undefined {
  if (value === undefined) return [];
  const items = value.split(',');
  if (items.length > max || !items.every(isId) || new Set(items).size !== items.length) {
    return undefined;
  }
  return items.map(Number);
}

function year(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (!/^(19|20)\d\d$/.test(value)) return null;
  return Number(value);
}

/**
 * The words to search for, folded so the same search shares one cached
 * answer: trimmed, spaces collapsed, lower case. Undefined when empty, too
 * long, or holding control characters.
 */
export function readQueryText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (text === '' || text.length > MAX_QUERY_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

/** Each parameter once, and only those named. */
function readParams(search: string, allowed: readonly string[]): Params | undefined {
  const params: Params = new Map();
  for (const [name, value] of new URLSearchParams(search)) {
    if (allowed.indexOf(name) === -1 || params.has(name)) return undefined;
    params.set(name, value);
  }
  return params;
}

function readType(value: string | undefined): SearchType | null | undefined {
  if (value === undefined) return undefined;
  return value === 'movie' || value === 'series' ? value : null;
}

function readRatings(value: string | undefined): boolean | undefined {
  if (value === undefined) return false;
  return value === '1' ? true : undefined;
}

/**
 * The search call for a path after `/search/` and its query, or undefined
 * when it is not one the Worker answers. Every value is checked here, so
 * nothing the app sends reaches TMDB unchecked.
 */
export function readSearchCall(path: string, search: string): SearchCall | undefined {
  switch (path) {
    case 'discover': {
      const params = readParams(search, [
        'type',
        'genres',
        'any',
        'keywords',
        'language',
        'country',
        'from',
        'to',
        'newest',
        'certification',
      ]);
      if (!params) return undefined;
      const type = readType(params.get('type'));
      if (!type) return undefined;
      const genres = idList(params.get('genres'), 5);
      const anyGenres = idList(params.get('any'), 5);
      const keywords = idList(params.get('keywords'), 8);
      if (!genres || !anyGenres || !keywords) return undefined;
      const call: DiscoverCall = {
        route: 'discover',
        type,
        genres,
        anyGenres,
        keywords,
        newest: false,
      };
      const language = params.get('language');
      if (language !== undefined) {
        if (!/^[a-z]{2}$/.test(language)) return undefined;
        call.language = language;
      }
      const country = params.get('country');
      if (country !== undefined) {
        if (!/^[A-Z]{2}$/.test(country)) return undefined;
        call.country = country;
      }
      const from = year(params.get('from'));
      const to = year(params.get('to'));
      if (from === null || to === null) return undefined;
      if (from !== undefined) call.from = from;
      if (to !== undefined) call.to = to;
      if (from !== undefined && to !== undefined && from > to) return undefined;
      const newest = params.get('newest');
      if (newest !== undefined && newest !== '1') return undefined;
      call.newest = newest === '1';
      const certification = params.get('certification');
      if (certification !== undefined) {
        if (KIDS_RATINGS.indexOf(certification) === -1) return undefined;
        call.certification = certification;
      }
      return call;
    }
    case 'multi': {
      const params = readParams(search, ['query']);
      const query = readQueryText(params?.get('query'));
      return query === undefined ? undefined : { route: 'multi', query };
    }
    case 'person': {
      const params = readParams(search, ['id', 'role', 'ratings']);
      if (!params) return undefined;
      const id = params.get('id');
      const role = params.get('role') ?? 'any';
      const ratings = readRatings(params.get('ratings'));
      if (id === undefined || !isId(id) || ratings === undefined) return undefined;
      if (role !== 'cast' && role !== 'directing' && role !== 'writing' && role !== 'any') {
        return undefined;
      }
      return { route: 'person', id: Number(id), role, ratings };
    }
    case 'like':
    case 'titles': {
      const params = readParams(search, ['query', 'type', 'ratings']);
      if (!params) return undefined;
      const query = readQueryText(params.get('query'));
      const type = readType(params.get('type'));
      const ratings = readRatings(params.get('ratings'));
      if (query === undefined || type === null || ratings === undefined) return undefined;
      const call: LikeCall | TitlesCall = { route: path, query, ratings };
      if (type) call.type = type;
      return call;
    }
    default:
      return undefined;
  }
}

/** The call's query in a fixed order, for the cache key: the same call, the same key. */
export function searchCacheKey(origin: string, call: SearchCall): string {
  const params: [string, string][] = [];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') params.push([name, String(value)]);
  };
  switch (call.route) {
    case 'discover':
      add('any', call.anyGenres.join(','));
      add('certification', call.certification);
      add('country', call.country);
      add('from', call.from);
      add('genres', call.genres.join(','));
      add('keywords', call.keywords.join(','));
      add('language', call.language);
      add('newest', call.newest ? '1' : undefined);
      add('to', call.to);
      add('type', call.type);
      break;
    case 'multi':
      add('query', call.query);
      break;
    case 'person':
      add('id', call.id);
      add('ratings', call.ratings ? '1' : undefined);
      add('role', call.role);
      break;
    case 'like':
    case 'titles':
      add('query', call.query);
      add('ratings', call.ratings ? '1' : undefined);
      add('type', call.type);
      break;
  }
  const query = params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  return `${origin}/search/${call.route}${query ? `?${query}` : ''}`;
}

/** A TMDB call: the path under /3/ and its query, values already encoded. */
export interface TmdbGet {
  path: string;
  query: string;
}

/** TMDB's answer to one call: its status and JSON, or undefined when it could not be reached or read. */
export type TmdbAnswer = { status: number; data: unknown } | undefined;

export type Get = (call: TmdbGet) => Promise<TmdbAnswer>;

function query(params: readonly (readonly [string, string | number])[]): string {
  return params.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join('&');
}

/** Today in UTC as TMDB writes dates, so "new" never means a title not out yet. */
function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * One discover call to TMDB: `genres` all needed, and `oneOf` any one of.
 * Commas need every genre and a pipe any one of them, but mixing the two in
 * one value is not documented, so a call never holds both.
 */
function discoverOne(
  call: DiscoverCall,
  now: number,
  genres: readonly number[],
  oneOf: readonly number[],
): TmdbGet {
  const kind = KIND[call.type];
  const date = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  const params: [string, string | number][] = [
    ['include_adult', 'false'],
    ['language', 'en-GB'],
    ['page', 1],
  ];
  if (kind === 'movie') params.push(['include_video', 'false']);
  if (genres.length > 0) params.push(['with_genres', genres.join(',')]);
  else if (oneOf.length > 0) params.push(['with_genres', oneOf.join('|')]);
  if (call.keywords.length > 0) params.push(['with_keywords', call.keywords.join('|')]);
  if (call.language) params.push(['with_original_language', call.language]);
  if (call.country) params.push(['with_origin_country', call.country]);
  if (call.from !== undefined) params.push([`${date}.gte`, `${call.from}-01-01`]);
  const until = call.to !== undefined ? `${call.to}-12-31` : undefined;
  if (call.newest) {
    const latest = today(now);
    params.push([`${date}.lte`, until !== undefined && until < latest ? until : latest]);
    params.push(['sort_by', `${date}.desc`]);
    // The newest titles with a following, not every one entered yesterday.
    params.push(['vote_count.gte', 20]);
  } else {
    if (until !== undefined) params.push([`${date}.lte`, until]);
    params.push(['sort_by', 'popularity.desc']);
  }
  // TMDB filters films by UK certificate; series it cannot, so their ratings are read one by one.
  if (call.certification && kind === 'movie') {
    params.push(['certification_country', 'GB']);
    params.push(['certification.lte', call.certification]);
  }
  return { path: `discover/${kind}`, query: query(params) };
}

/**
 * The discover calls to TMDB for a row: one, unless it needs some genres and
 * one of several others ("comedy" for a kids profile's series: Comedy, and
 * Family or Kids). Then it is one call for each of those others, with all
 * the needed genres, as TMDB cannot be asked both in one.
 */
export function discoverGets(call: DiscoverCall, now: number): TmdbGet[] {
  const { genres, anyGenres } = call;
  if (genres.length === 0 || anyGenres.some((id) => genres.indexOf(id) !== -1)) {
    return [discoverOne(call, now, genres, genres.length === 0 ? anyGenres : [])];
  }
  if (anyGenres.length === 0) return [discoverOne(call, now, genres, [])];
  return anyGenres.map((id) => discoverOne(call, now, genres.concat([id]), []));
}

/** Several lists of titles as one, taking from each in turn, each title once. */
function interleave(lists: readonly (readonly Listed[])[]): Listed[] {
  const seen = new Set<string>();
  const merged: Listed[] = [];
  const longest = Math.max(0, ...lists.map((items) => items.length));
  for (let index = 0; index < longest; index++) {
    for (const items of lists) {
      const item = items[index];
      if (!item) continue;
      const key = `${item.kind}:${item.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

/** A title as Search draws it: by IMDb id, with TMDB's poster path. */
export interface SearchTitle {
  id: string;
  type: SearchType;
  name: string;
  /** The year it came out or started. */
  year?: string;
  /** TMDB's image path, such as /abc.jpg: the app picks the size. */
  poster?: string;
  genres: string[];
  /** Only when ratings were asked for: the UK's and the US's certificates as TMDB lists them. */
  certificates?: { GB: string[]; US: string[] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** One title from a TMDB list (discover, search, credits, recommendations), before its IMDb id is known. */
interface Listed {
  tmdbId: number;
  kind: TmdbKind;
  name: string;
  year?: string;
  poster?: string;
  genreIds: number[];
}

function isImagePath(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|svg|webp)$/.test(value)
  );
}

/** A listed title, or undefined when it is not a film or series TMDB can say more about. */
function readListed(raw: unknown, kind?: TmdbKind): Listed | undefined {
  if (!isObject(raw) || raw.adult === true) return undefined;
  const as =
    kind ?? (raw.media_type === 'movie' || raw.media_type === 'tv' ? raw.media_type : undefined);
  if (!as) return undefined;
  const id = raw.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
  const name = text(as === 'movie' ? raw.title : raw.name);
  if (!name) return undefined;
  const listed: Listed = {
    tmdbId: id,
    kind: as,
    name,
    genreIds: list(raw.genre_ids).filter((genre): genre is number => typeof genre === 'number'),
  };
  const date = text(as === 'movie' ? raw.release_date : raw.first_air_date);
  if (date && /^\d{4}/.test(date)) listed.year = date.slice(0, 4);
  if (isImagePath(raw.poster_path)) listed.poster = raw.poster_path;
  return listed;
}

/** The certificates TMDB lists for one country, as written: per release for a film, one for a series. */
function certificatesOf(
  kind: TmdbKind,
  details: Record<string, unknown>,
  country: string,
): string[] {
  const block = details[kind === 'movie' ? 'release_dates' : 'content_ratings'];
  const found: string[] = [];
  const keep = (value: unknown) => {
    const certificate = text(value);
    if (certificate && found.indexOf(certificate) === -1) found.push(certificate);
  };
  for (const entry of isObject(block) ? list(block.results) : []) {
    if (!isObject(entry) || entry.iso_3166_1 !== country) continue;
    if (kind === 'tv') keep(entry.rating);
    else
      for (const release of list(entry.release_dates))
        if (isObject(release)) keep(release.certification);
  }
  return found;
}

/** Runs `work` on each item with at most PARALLEL_CALLS at once, keeping their order. */
async function eachLimited<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_CALLS, items.length) }, lane));
  return results;
}

/** What a route answers, and whether it is whole enough to cache. */
export interface SearchAnswer {
  status: number;
  body: unknown;
  /** False when some of TMDB's calls failed: the answer may be fuller next time. */
  complete: boolean;
}

const UPSTREAM: SearchAnswer = { status: 502, body: { error: 'upstream' }, complete: false };

/**
 * Each listed title by its IMDb id, in the same order, leaving out those
 * TMDB has no IMDb id for. With `ratings`, each title's details are read
 * too, for its genres and its UK and US certificates.
 */
async function withImdbIds(
  listed: readonly Listed[],
  ratings: boolean,
  get: Get,
): Promise<{ titles: SearchTitle[]; complete: boolean }> {
  let complete = true;
  const read = await eachLimited(listed.slice(0, MAX_TITLES), async (item) => {
    const answer = await get(
      ratings
        ? {
            path: `${item.kind}/${item.tmdbId}`,
            query: query([
              [
                'append_to_response',
                item.kind === 'movie'
                  ? 'external_ids,release_dates'
                  : 'external_ids,content_ratings',
              ],
              ['language', 'en-GB'],
            ]),
          }
        : { path: `${item.kind}/${item.tmdbId}/external_ids`, query: '' },
    );
    if (!answer || answer.status !== 200 || !isObject(answer.data)) {
      // TMDB not knowing the title is an answer; anything else may go better later.
      if (!answer || answer.status !== 404) complete = false;
      return undefined;
    }
    const data = answer.data;
    const ids = ratings ? data.external_ids : data;
    const imdb = isObject(ids) ? text(ids.imdb_id) : undefined;
    if (!imdb || !/^tt\d{1,10}$/.test(imdb)) return undefined;
    const title: SearchTitle = { id: imdb, type: TYPE[item.kind], name: item.name, genres: [] };
    if (item.year) title.year = item.year;
    if (item.poster) title.poster = item.poster;
    if (ratings) {
      title.genres = list(data.genres)
        .map((genre) => (isObject(genre) ? text(genre.name) : undefined))
        .filter((name): name is string => name !== undefined);
      title.certificates = {
        GB: certificatesOf(item.kind, data, 'GB'),
        US: certificatesOf(item.kind, data, 'US'),
      };
    } else {
      title.genres = item.genreIds
        .map((id) => GENRES[id])
        .filter((name): name is string => name !== undefined);
    }
    return title;
  });
  // A title listed twice (a person's two roles in it) is drawn once.
  const seen = new Set<string>();
  const titles: SearchTitle[] = [];
  for (const title of read) {
    if (!title || seen.has(title.id)) continue;
    seen.add(title.id);
    titles.push(title);
  }
  return { titles, complete };
}

function results(data: unknown): unknown[] {
  return isObject(data) ? list(data.results) : [];
}

function ok(answer: TmdbAnswer): answer is { status: number; data: unknown } {
  return answer !== undefined && answer.status === 200;
}

function searchGet(kind: TmdbKind | 'multi', text_: string): TmdbGet {
  return {
    path: `search/${kind}`,
    query: query([
      ['include_adult', 'false'],
      ['language', 'en-GB'],
      ['page', 1],
      ['query', text_],
    ]),
  };
}

/** A person's credits worth a row: not talk shows or the news, and each title once. */
function creditsOf(data: unknown, role: PersonCall['role']): Listed[] {
  if (!isObject(data)) return [];
  const credits: { item: Listed; votes: number; popularity: number }[] = [];
  const add = (raw: unknown) => {
    const item = readListed(raw);
    if (!item || !isObject(raw)) return;
    if (item.kind === 'tv' && item.genreIds.some((id) => APPEARANCES.indexOf(id) !== -1)) return;
    const character = text(raw.character);
    if (character && /^(self|himself|herself|themselves|narrator)\b/i.test(character)) return;
    credits.push({ item, votes: count(raw.vote_count), popularity: count(raw.popularity) });
  };
  if (role === 'cast' || role === 'any') list(data.cast).forEach(add);
  if (role !== 'cast') {
    for (const raw of list(data.crew)) {
      if (!isObject(raw)) continue;
      const job = text(raw.job) ?? '';
      const department = text(raw.department) ?? '';
      if (role === 'directing' && job !== 'Director') continue;
      if (role === 'writing' && department !== 'Writing' && job !== 'Creator') continue;
      add(raw);
    }
  }
  // Best known first: votes say how many have seen it, popularity breaks ties.
  credits.sort((a, b) => b.votes - a.votes || b.popularity - a.popularity);
  const seen = new Set<string>();
  const listed: Listed[] = [];
  for (const { item } of credits) {
    const key = `${item.kind}:${item.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listed.push(item);
  }
  return listed;
}

/** What /search/multi suggests: people first, then titles' names. */
function suggestionsOf(data: unknown): unknown {
  const people: unknown[] = [];
  const titles: unknown[] = [];
  for (const raw of results(data)) {
    if (!isObject(raw) || raw.adult === true) continue;
    if (raw.media_type === 'person') {
      const name = text(raw.name);
      const id = raw.id;
      if (!name || typeof id !== 'number' || people.length >= MAX_PEOPLE) continue;
      const person: Record<string, unknown> = { id, name, knownFor: [] };
      const department = text(raw.known_for_department);
      if (department) person.department = department;
      if (isImagePath(raw.profile_path)) person.photo = raw.profile_path;
      person.knownFor = list(raw.known_for)
        .map((work) => readListed(work)?.name)
        .filter((name_): name_ is string => name_ !== undefined)
        .slice(0, 3);
      people.push(person);
      continue;
    }
    const item = readListed(raw);
    if (!item || titles.length >= MAX_SUGGESTED) continue;
    const title: Record<string, unknown> = { name: item.name, type: TYPE[item.kind] };
    if (item.year) title.year = item.year;
    titles.push(title);
  }
  return { people, titles };
}

/** Answers a checked search call, asking TMDB through `get`. */
export async function runSearch(call: SearchCall, get: Get, now: number): Promise<SearchAnswer> {
  switch (call.route) {
    case 'discover': {
      const answers = await Promise.all(discoverGets(call, now).map(get));
      if (!answers.some(ok)) return UPSTREAM;
      const listed = interleave(
        answers.map((answer) =>
          ok(answer)
            ? results(answer.data)
                .map((raw) => readListed(raw, KIND[call.type]))
                .filter((item): item is Listed => item !== undefined)
            : [],
        ),
      );
      const found = await withImdbIds(listed, call.certification !== undefined, get);
      return {
        status: 200,
        body: { titles: found.titles },
        complete: found.complete && answers.every(ok),
      };
    }
    case 'multi': {
      const answer = await get(searchGet('multi', call.query));
      if (!ok(answer)) return UPSTREAM;
      return { status: 200, body: suggestionsOf(answer.data), complete: true };
    }
    case 'person': {
      const answer = await get({
        path: `person/${call.id}/combined_credits`,
        query: query([['language', 'en-GB']]),
      });
      if (answer && answer.status === 404)
        return { status: 200, body: { titles: [] }, complete: true };
      if (!ok(answer)) return UPSTREAM;
      const { titles, complete } = await withImdbIds(
        creditsOf(answer.data, call.role),
        call.ratings,
        get,
      );
      return { status: 200, body: { titles }, complete };
    }
    case 'titles': {
      const answer = await get(searchGet(call.type ? KIND[call.type] : 'multi', call.query));
      if (!ok(answer)) return UPSTREAM;
      const kind = call.type ? KIND[call.type] : undefined;
      const listed = results(answer.data)
        .map((raw) => readListed(raw, kind))
        .filter((item): item is Listed => item !== undefined);
      const { titles, complete } = await withImdbIds(listed, call.ratings, get);
      return { status: 200, body: { titles }, complete };
    }
    case 'like': {
      const found = await get(searchGet(call.type ? KIND[call.type] : 'multi', call.query));
      if (!ok(found)) return UPSTREAM;
      const kind = call.type ? KIND[call.type] : undefined;
      const first = results(found.data)
        .map((raw) => readListed(raw, kind))
        .find((item): item is Listed => item !== undefined);
      if (!first) return { status: 200, body: { titles: [] }, complete: true };
      const like: Record<string, unknown> = { name: first.name, type: TYPE[first.kind] };
      if (first.year) like.year = first.year;
      const answer = await get({
        path: `${first.kind}/${first.tmdbId}/recommendations`,
        query: query([
          ['language', 'en-GB'],
          ['page', 1],
        ]),
      });
      if (!ok(answer)) return UPSTREAM;
      const listed = results(answer.data)
        .map((raw) => readListed(raw, first.kind))
        .filter((item): item is Listed => item !== undefined);
      const { titles, complete } = await withImdbIds(listed, call.ratings, get);
      return { status: 200, body: { like, titles }, complete };
    }
  }
}
