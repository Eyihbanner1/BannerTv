import { HttpError } from '../../http';
import { ukRating } from '../../profiles/kids';

/** Cast shown on Details at most. */
export const MAX_CAST = 12;

/** Image paths here are TMDB's, such as /abc.jpg, for tmdbImageUrl. */
export interface TmdbPerson {
  name: string;
  character?: string;
  profilePath?: string;
}

/** What TMDB knows about a film or series that the addon may have left out. */
export interface TmdbDetails {
  tmdbId: number;
  kind: 'movie' | 'tv';
  /** An English title logo, PNG where there is one. */
  logoPath?: string;
  /** A backdrop without text where TMDB has one, else its main backdrop. */
  backdropPath?: string;
  /** At most MAX_CAST, in billing order. */
  cast: TmdbPerson[];
  /** A UK rating (U, PG, 12, 15, 18 or R18): the UK's certificate, else the US one mapped. */
  certificate?: string;
  /** A series' first network, or a film's first production company. */
  network?: string;
  tagline?: string;
  /** A series' season numbers, lowest first; 0 holds the specials. */
  seasons?: number[];
}

export interface TmdbEpisode {
  name?: string;
  overview?: string;
  stillPath?: string;
}

type TmdbKind = TmdbDetails['kind'];
type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A non-empty trimmed string. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function score(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** An image path as TMDB gives it: a slash, then no spaces. */
export function isImagePath(value: unknown): value is string {
  return typeof value === 'string' && /^\/\S+$/.test(value);
}

export function isTmdbId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** A season or episode number. */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function unreadable(): HttpError {
  return new HttpError('invalid', 'TMDB sent an answer BannerTV cannot read');
}

/**
 * The first film (or series) in TMDB's answer to an IMDb id, or undefined
 * when it has none. Throws when the answer is not an object at all.
 */
export function readFoundId(kind: TmdbKind, value: unknown): number | undefined {
  const raw = asObject(value);
  if (!raw) throw unreadable();
  for (const item of list(kind === 'tv' ? raw.tv_results : raw.movie_results)) {
    const id = asObject(item)?.id;
    if (isTmdbId(id)) return id;
  }
  return undefined;
}

interface Image {
  path: string;
  language: unknown;
  votes: number;
  count: number;
}

function readImages(value: unknown): Image[] {
  const images: Image[] = [];
  for (const item of list(value)) {
    const raw = asObject(item);
    if (!raw || !isImagePath(raw.file_path)) continue;
    images.push({
      path: raw.file_path,
      language: raw.iso_639_1,
      votes: score(raw.vote_average),
      count: score(raw.vote_count),
    });
  }
  return images;
}

/** The best by `compare` (negative when the first is better). Of equals the first wins. */
function best<T>(items: readonly T[], compare: (a: T, b: T) => number): T | undefined {
  let winner: T | undefined;
  for (const item of items) {
    if (winner === undefined || compare(item, winner) < 0) winner = item;
  }
  return winner;
}

const byVotes = (a: Image, b: Image) => b.votes - a.votes || b.count - a.count;
const pngFirst = (image: Image) => (/\.png$/i.test(image.path) ? 0 : 1);

/** English logos only; a PNG beats any SVG, which costs the TV more to draw. */
function chooseLogo(images: Json | undefined): string | undefined {
  const logos = readImages(images?.logos).filter((image) => image.language === 'en');
  return best(logos, (a, b) => pngFirst(a) - pngFirst(b) || byVotes(a, b))?.path;
}

/** A backdrop with no language has no text on it, which suits the title drawn over it. */
function chooseBackdrop(raw: Json, images: Json | undefined): string | undefined {
  const textless = readImages(images?.backdrops).filter((image) => image.language === null);
  const chosen = best(textless, byVotes)?.path;
  if (chosen) return chosen;
  return isImagePath(raw.backdrop_path) ? raw.backdrop_path : undefined;
}

function readCast(kind: TmdbKind, credits: unknown): TmdbPerson[] {
  const people: Array<{ person: TmdbPerson; order: number; index: number }> = [];
  list(asObject(credits)?.cast).forEach((item, index) => {
    const raw = asObject(item);
    const name = raw && text(raw.name);
    if (!raw || !name) return;
    const person: TmdbPerson = { name };
    // A series' aggregate credits list every role; the first is the main one.
    const character = text(kind === 'tv' ? asObject(list(raw.roles)[0])?.character : raw.character);
    if (character) person.character = character;
    if (isImagePath(raw.profile_path)) person.profilePath = raw.profile_path;
    const order =
      typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : Infinity;
    people.push({ person, order, index });
  });
  // Chromium 68 sorts unstably, so equal billing keeps TMDB's order by hand.
  return people
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .slice(0, MAX_CAST)
    .map(({ person }) => person);
}

const COUNTRIES = ['GB', 'US'] as const;

/** The first certificate that reads as a UK rating, trying the UK's before the US's. */
function firstRating(certificates: (country: string) => string[]): string | undefined {
  for (const country of COUNTRIES) {
    for (const certificate of certificates(country)) {
      const rating = ukRating(certificate, country);
      if (rating) return rating;
    }
  }
  return undefined;
}

/** A film is certified per release; a cinema release's certificate comes first. */
function filmCertificate(releaseDates: unknown): string | undefined {
  const results = list(asObject(releaseDates)?.results);
  return firstRating((country) => {
    const cinema: string[] = [];
    const other: string[] = [];
    for (const item of results) {
      const entry = asObject(item);
      if (entry?.iso_3166_1 !== country) continue;
      for (const release of list(entry.release_dates)) {
        const raw = asObject(release);
        const certificate = raw && text(raw.certification);
        if (!raw || !certificate) continue;
        (raw.type === 3 ? cinema : other).push(certificate);
      }
    }
    return cinema.concat(other);
  });
}

function seriesCertificate(contentRatings: unknown): string | undefined {
  const results = list(asObject(contentRatings)?.results);
  return firstRating((country) => {
    const ratings: string[] = [];
    for (const item of results) {
      const entry = asObject(item);
      const rating = entry?.iso_3166_1 === country ? text(entry.rating) : undefined;
      if (rating) ratings.push(rating);
    }
    return ratings;
  });
}

function firstName(value: unknown): string | undefined {
  for (const item of list(value)) {
    const name = text(asObject(item)?.name);
    if (name) return name;
  }
  return undefined;
}

function readSeasons(value: unknown): number[] {
  const numbers: number[] = [];
  for (const item of list(value)) {
    const number = asObject(item)?.season_number;
    if (isCount(number) && numbers.indexOf(number) === -1) numbers.push(number);
  }
  // The numbers are distinct, so this sort has no ties to keep in order.
  return numbers.sort((a, b) => a - b);
}

/**
 * TMDB's details of a film (with images, credits and release_dates appended)
 * or series (with images, aggregate_credits and content_ratings). Anything
 * unreadable in it is left out; an answer that is not an object throws.
 */
export function readDetails(kind: TmdbKind, tmdbId: number, value: unknown): TmdbDetails {
  const raw = asObject(value);
  if (!raw) throw unreadable();
  const images = asObject(raw.images);
  const tv = kind === 'tv';
  const details: TmdbDetails = {
    tmdbId,
    kind,
    cast: readCast(kind, tv ? raw.aggregate_credits : raw.credits),
  };
  const logoPath = chooseLogo(images);
  if (logoPath) details.logoPath = logoPath;
  const backdropPath = chooseBackdrop(raw, images);
  if (backdropPath) details.backdropPath = backdropPath;
  const certificate = tv
    ? seriesCertificate(raw.content_ratings)
    : filmCertificate(raw.release_dates);
  if (certificate) details.certificate = certificate;
  const network = firstName(tv ? raw.networks : raw.production_companies);
  if (network) details.network = network;
  const tagline = text(raw.tagline);
  if (tagline) details.tagline = tagline;
  if (tv) {
    const seasons = readSeasons(raw.seasons);
    if (seasons.length > 0) details.seasons = seasons;
  }
  return details;
}

/**
 * A season's episodes by episode number. Episodes with nothing to add are
 * left out; an answer that is not an object throws.
 */
export function readSeason(value: unknown): Record<number, TmdbEpisode> {
  const raw = asObject(value);
  if (!raw) throw unreadable();
  const episodes: Record<number, TmdbEpisode> = {};
  for (const item of list(raw.episodes)) {
    const entry = asObject(item);
    const number = entry?.episode_number;
    if (!entry || !isCount(number) || episodes[number] !== undefined) continue;
    const episode: TmdbEpisode = {};
    const name = text(entry.name);
    if (name) episode.name = name;
    const overview = text(entry.overview);
    if (overview) episode.overview = overview;
    if (isImagePath(entry.still_path)) episode.stillPath = entry.still_path;
    if (Object.keys(episode).length > 0) episodes[number] = episode;
  }
  return episodes;
}
