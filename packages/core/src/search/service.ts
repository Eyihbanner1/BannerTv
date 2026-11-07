import type { ContentType, MetaPreview } from '@bannertv/protocol';
import { BROWSE_TIMEOUT_MS } from '../addons/client';
import type { FetchJson } from '../http';
import { isImagePath } from '../integrations/tmdb/details';
import { type TmdbImageSize, tmdbImageUrl } from '../integrations/tmdb/client';
import type { Limiter } from '../limiter';
import { strictestUkRating } from '../profiles/kids';
import type { CachePolicy, Query, QueryCache } from '../query';
import type { DiscoverFilter, RemotePerson, RemoteType } from './remote';

const HOUR = 60 * 60 * 1000;

/** The Worker keeps TMDB's answers a day; the app keeps them as long while it runs. */
export const SEARCH_POLICY: CachePolicy = {
  freshFor: 24 * HOUR,
  revalidateFor: 24 * HOUR,
  errorFor: 0,
};

// Cached as read, so a build that reads them differently does not get the old shape.
const KEY = 'search:1';

/** A title from TMDB, by IMDb id, as Search draws and opens it. */
export interface RemoteTitle extends MetaPreview {
  /** The strictest UK rating TMDB lists for it, when ratings were asked for and it has one. */
  certificate?: string;
}

/** What one of Search's TMDB rows holds. */
export interface RemoteAnswer {
  titles: readonly RemoteTitle[];
  /** For titles like another: the title TMDB found by the words. */
  like?: { name: string; type: RemoteType; year?: string };
}

/** What TMDB knows by some words: people, and the names of titles. */
export interface MultiAnswer {
  people: readonly RemotePerson[];
  titles: readonly { name: string; type: RemoteType; year?: string }[];
}

/** Which of someone's credits make their row. */
export type PersonRole = 'cast' | 'directing' | 'writing' | 'any';

export interface SearchServiceOptions {
  /** BannerTV's service's search route, such as https://api.bannertv.workers.dev/search. */
  baseUrl: string;
  fetchJson: FetchJson;
  queries: QueryCache;
  limiter?: Limiter;
  /** The poster size tiles draw: w500 for a sharp 4K TV, w342 otherwise. */
  posterSize?: TmdbImageSize;
}

/** Search's routes into TMDB, through BannerTV's service. */
export interface SearchService {
  /** A row for what the words mean together: "Stand-up comedy films". */
  discover(filter: DiscoverFilter): Query<RemoteAnswer>;
  /** People and titles TMDB knows by these words, for suggestions and person rows. */
  multi(text: string): Query<MultiAnswer>;
  /** Someone's best-known work. With `ratings`, each title's UK rating too. */
  person(id: number, role: PersonRole, ratings: boolean): Query<RemoteAnswer>;
  /** Titles like the one TMDB finds by these words. */
  like(text: string, type: RemoteType | undefined, ratings: boolean): Query<RemoteAnswer>;
  /** Titles TMDB finds by name, for a kids profile: always with ratings. */
  titles(text: string): Query<RemoteAnswer>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function readType(value: unknown): RemoteType | undefined {
  return value === 'movie' || value === 'series' ? value : undefined;
}

function readTitle(raw: unknown, posterSize: TmdbImageSize): RemoteTitle | undefined {
  if (!isObject(raw)) return undefined;
  const id = text(raw.id);
  const type = readType(raw.type);
  const name = text(raw.name);
  if (!id || !/^tt\d+$/.test(id) || !type || !name) return undefined;
  const title: RemoteTitle = {
    id,
    type: type as ContentType,
    name,
    posterShape: 'poster',
    genres: strings(raw.genres),
    trailers: [],
  };
  const year = text(raw.year);
  if (year && /^\d{4}$/.test(year)) title.releaseInfo = year;
  const poster = isImagePath(raw.poster) ? tmdbImageUrl(raw.poster, posterSize) : undefined;
  if (poster) title.poster = poster;
  if (isObject(raw.certificates)) {
    const certificate = strictestUkRating(
      strings(raw.certificates.GB),
      strings(raw.certificates.US),
    );
    if (certificate) title.certificate = certificate;
  }
  return title;
}

/** The Worker's titles, keeping only those it could read, each once. */
export function readRemoteAnswer(data: unknown, posterSize: TmdbImageSize = 'w342'): RemoteAnswer {
  if (!isObject(data)) return { titles: [] };
  const seen = new Set<string>();
  const titles: RemoteTitle[] = [];
  for (const raw of Array.isArray(data.titles) ? data.titles : []) {
    const title = readTitle(raw, posterSize);
    if (!title || seen.has(title.id)) continue;
    seen.add(title.id);
    titles.push(title);
  }
  const answer: RemoteAnswer = { titles };
  if (isObject(data.like)) {
    const name = text(data.like.name);
    const type = readType(data.like.type);
    if (name && type) {
      answer.like = { name, type };
      const year = text(data.like.year);
      if (year) answer.like.year = year;
    }
  }
  return answer;
}

/** The Worker's people and title names. */
export function readMultiAnswer(data: unknown): MultiAnswer {
  if (!isObject(data)) return { people: [], titles: [] };
  const people: RemotePerson[] = [];
  for (const raw of Array.isArray(data.people) ? data.people : []) {
    if (!isObject(raw)) continue;
    const id = raw.id;
    const name = text(raw.name);
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !name) continue;
    const person: RemotePerson = { id, name, knownFor: strings(raw.knownFor) };
    const department = text(raw.department);
    if (department) person.department = department;
    if (isImagePath(raw.photo)) person.photo = raw.photo;
    people.push(person);
  }
  const titles: MultiAnswer['titles'][number][] = [];
  for (const raw of Array.isArray(data.titles) ? data.titles : []) {
    if (!isObject(raw)) continue;
    const name = text(raw.name);
    const type = readType(raw.type);
    if (!name || !type) continue;
    const title: { name: string; type: RemoteType; year?: string } = { name, type };
    const year = text(raw.year);
    if (year) title.year = year;
    titles.push(title);
  }
  return { people, titles };
}

/** A discover filter as the Worker's query, in a fixed order so the same row shares one cache entry. */
export function discoverQuery(filter: DiscoverFilter): string {
  const params: [string, string][] = [['type', filter.type]];
  if (filter.genres && filter.genres.length > 0) params.push(['genres', filter.genres.join(',')]);
  if (filter.anyGenres && filter.anyGenres.length > 0) {
    params.push(['any', filter.anyGenres.join(',')]);
  }
  if (filter.keywords && filter.keywords.length > 0) {
    params.push(['keywords', filter.keywords.join(',')]);
  }
  if (filter.language) params.push(['language', filter.language]);
  if (filter.country) params.push(['country', filter.country]);
  if (filter.from !== undefined) params.push(['from', String(filter.from)]);
  if (filter.to !== undefined) params.push(['to', String(filter.to)]);
  if (filter.newest) params.push(['newest', '1']);
  if (filter.certification) params.push(['certification', filter.certification]);
  return params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
}

/** The words as the Worker folds them, so two spellings of one search share a query. */
function folded(words: string): string {
  return words.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Search's routes into TMDB through BannerTV's service, which holds the key
 * and answers with titles by IMDb id. Answers are kept for this run only:
 * searches are many and each is asked once or twice.
 */
export function createSearchService(options: SearchServiceOptions): SearchService {
  const { fetchJson, queries, limiter } = options;
  const base = options.baseUrl.replace(/\/+$/, '');
  const posterSize = options.posterSize ?? 'w342';

  function get(path: string): Promise<unknown> {
    const request = () => fetchJson(`${base}/${path}`, { timeoutMs: BROWSE_TIMEOUT_MS });
    return limiter ? limiter.run(request) : request();
  }

  function titles(path: string): Query<RemoteAnswer> {
    return queries.query(`${KEY}:${path}`, {
      policy: SEARCH_POLICY,
      persist: false,
      fetch: async () => {
        const data = await get(path);
        // Some titles were missing (TMDB failed to say who some are): shown, and asked again next time.
        const partial = isObject(data) && data.partial === true;
        return {
          value: readRemoteAnswer(data, posterSize),
          hints: partial ? { cacheMaxAge: 0 } : {},
        };
      },
    });
  }

  return {
    discover: (filter) => titles(`discover?${discoverQuery(filter)}`),

    multi(words) {
      const path = `multi?query=${encodeURIComponent(folded(words))}`;
      return queries.query(`${KEY}:${path}`, {
        policy: SEARCH_POLICY,
        persist: false,
        fetch: async () => ({ value: readMultiAnswer(await get(path)), hints: {} }),
      });
    },

    person: (id, role, ratings) =>
      titles(`person?id=${id}&role=${role}${ratings ? '&ratings=1' : ''}`),

    like: (words, type, ratings) =>
      titles(
        `like?query=${encodeURIComponent(folded(words))}${type ? `&type=${type}` : ''}${
          ratings ? '&ratings=1' : ''
        }`,
      ),

    titles: (words) => titles(`titles?query=${encodeURIComponent(folded(words))}&ratings=1`),
  };
}

/** Which credits make a person's row, from what TMDB says they are known for. */
export function roleOf(department: string | undefined): PersonRole {
  if (department === 'Acting') return 'cast';
  if (department === 'Directing') return 'directing';
  if (department === 'Writing') return 'writing';
  return 'any';
}
