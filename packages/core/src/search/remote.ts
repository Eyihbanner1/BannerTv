import type { ContentType } from '@bannertv/protocol';
import { kidsTitleAllowed } from '../profiles/kids';
import type { KidsRating } from '../profiles/profiles';
import type { Intent, Understanding } from './understand';
import { closeEnough, keyOf, wordsOf } from './words';

/** The types TMDB knows: films and series. */
export type RemoteType = 'movie' | 'series';

const BOTH: readonly RemoteType[] = ['movie', 'series'];

/** TMDB's Family genre, the same id for films and series. */
export const TMDB_FAMILY = 10751;
/** TMDB's Kids genre, for series only. */
export const TMDB_KIDS = 10762;

/** What TMDB's discover is asked for one row of titles. */
export interface DiscoverFilter {
  type: RemoteType;
  /** TMDB genre ids a title must all have. */
  genres?: readonly number[];
  /** TMDB genre ids a title must have one of, as well as `genres`. */
  anyGenres?: readonly number[];
  /** TMDB keyword ids, any one of which will do. */
  keywords?: readonly number[];
  /** ISO 639-1: the language a title was made in. */
  language?: string;
  /** ISO 3166-1: the country a title comes from. */
  country?: string;
  /** The first and last year of release, inclusive. */
  from?: number;
  to?: number;
  /** Newest first, rather than most popular first. */
  newest?: boolean;
  /** A kids profile's limit: the highest UK rating TMDB may give a title. */
  certification?: KidsRating;
}

/** One row of titles from TMDB's discover, for what the words mean together. */
export interface DiscoverRow {
  /** Unique within the plan, [a-z0-9-] only: safe for focus keys. */
  key: string;
  type: RemoteType;
  filter: DiscoverFilter;
  /** What the titles are, in sentence case ("Korean horror"); undefined for just a time. */
  what?: string;
  /** `what` as it reads mid-sentence: "New horror films", "New Korean films". */
  inline?: string;
  /** A typed year: "from 2024". */
  year?: number;
  /** A typed decade, by its first year: "from the 1990s". */
  decade?: number;
  /** "New": the newest first. */
  newest: boolean;
  /** For a kids profile, so its titles are checked against the limit. */
  kids: boolean;
}

export interface RemotePlanOptions {
  /** A kids profile allowing up to this UK rating. */
  kids?: KidsRating;
}

/** The kinds of intent TMDB's discover can answer. */
const FILTER_KINDS = ['genre', 'mood', 'family', 'language', 'year', 'decade', 'new'];

function genreIds(intent: Intent, type: RemoteType): readonly number[] | undefined {
  return type === 'movie' ? intent.tmdb?.movieGenres : intent.tmdb?.tvGenres;
}

/**
 * "Korean" and "Horror" as "Korean horror": languages keep their capital, as
 * names do. `start` keeps the first word's capital too, to begin a title.
 */
function sentence(intents: readonly Intent[], start: boolean): string | undefined {
  const parts = intents.map((intent, index) => {
    if ((start && index === 0) || intent.kind === 'language') return intent.label;
    return intent.label.charAt(0).toLowerCase() + intent.label.slice(1);
  });
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * The TMDB discover filter for one type, or undefined when TMDB cannot say
 * what every intent asks for in that type: a genre TMDB has no id for, two
 * moods each needing its own keywords, or two times or two languages ("80s
 * 90s", "korean japanese"), which one row cannot be named after.
 */
function filterFor(
  intents: readonly Intent[],
  type: RemoteType,
  kids: KidsRating | undefined,
): DiscoverFilter | undefined {
  const genres: number[] = [];
  let anyGenres: readonly number[] | undefined;
  let keywords: readonly number[] | undefined;
  const filter: DiscoverFilter = { type };
  let time = false;
  let place = false;
  const addGenres = (ids: readonly number[]) => {
    for (const id of ids) if (genres.indexOf(id) === -1) genres.push(id);
  };
  for (const intent of intents) {
    if (intent.types && intent.types.indexOf(type) === -1) return undefined;
    switch (intent.kind) {
      case 'mood':
      case 'genre': {
        // Keywords say a mood best (stand-up specials are tagged so); genres stand in otherwise.
        if (intent.kind === 'mood' && intent.tmdb?.keywords) {
          if (keywords) return undefined;
          keywords = intent.tmdb.keywords;
          break;
        }
        const ids = genreIds(intent, type);
        if (!ids || ids.length === 0) return undefined;
        addGenres(ids);
        break;
      }
      case 'family':
        // Any of the family genres: a children's series is tagged Kids, Family or both.
        anyGenres = genreIds(intent, type) ?? [TMDB_FAMILY];
        break;
      case 'language':
        if (place || (!intent.tmdb?.language && !intent.tmdb?.country)) return undefined;
        place = true;
        if (intent.tmdb.language) filter.language = intent.tmdb.language;
        if (intent.tmdb.country) filter.country = intent.tmdb.country;
        break;
      case 'year':
        if (time) return undefined;
        time = true;
        filter.from = intent.year;
        filter.to = intent.year;
        break;
      case 'decade':
        if (time) return undefined;
        time = true;
        filter.from = intent.year;
        filter.to = intent.year! + 9;
        break;
      case 'new':
        filter.newest = true;
        break;
      default:
        return undefined;
    }
  }
  if (kids !== undefined) {
    filter.certification = kids;
    // Only titles for families: TMDB's own rating check is not enough on its own.
    if (!anyGenres) anyGenres = type === 'movie' ? [TMDB_FAMILY] : [TMDB_FAMILY, TMDB_KIDS];
  }
  if (genres.length > 0) filter.genres = genres;
  if (anyGenres) filter.anyGenres = anyGenres;
  if (keywords) filter.keywords = keywords;
  return filter;
}

/**
 * The rows TMDB's discover adds for what the words mean together, one per
 * type: "Korean horror films", "Stand-up comedy series", "Comedy films from
 * the 1990s". Only what the installed catalogs cannot answer as well: a mood
 * TMDB tags by keyword, a language, a decade, or two things at once. A
 * genre alone ("comedy") or a year alone is left to the catalogs. For a
 * kids profile, every understood search adds rows, limited to family titles
 * within its UK rating, since catalogs rarely say which titles suit children,
 * except for a genre that is not for children ("horror"), whose row a kids
 * profile could never see a title of.
 */
export function planRemote(
  understanding: Understanding,
  options: RemotePlanOptions = {},
): DiscoverRow[] {
  // Each meaning once: "music and musicals" is one genre, not two things at once.
  const intents = understanding.intents.filter(
    (intent, index, all) => all.findIndex((other) => other.id === intent.id) === index,
  );
  if (intents.length === 0) return [];
  if (intents.some((intent) => FILTER_KINDS.indexOf(intent.kind) === -1)) return [];
  const kids = options.kids;
  if (
    kids !== undefined &&
    intents.some(
      (intent) =>
        (intent.kind === 'genre' || intent.kind === 'mood') &&
        !kidsTitleAllowed({ type: 'movie', genres: [...intent.genres, 'Family'] }),
    )
  ) {
    return [];
  }
  const worth =
    kids !== undefined ||
    intents.length >= 2 ||
    intents.some(
      (intent) =>
        (intent.kind === 'mood' && intent.tmdb?.keywords !== undefined) ||
        intent.kind === 'language' ||
        intent.kind === 'decade',
    );
  if (!worth) return [];

  const asked = understanding.types;
  const types = BOTH.filter((type) => asked === null || asked.indexOf(type as ContentType) !== -1);
  const subjects = intents.filter(
    (intent) => intent.kind !== 'year' && intent.kind !== 'decade' && intent.kind !== 'new',
  );
  const year = intents.find((intent) => intent.kind === 'year')?.year;
  const decade = intents.find((intent) => intent.kind === 'decade')?.year;
  const newest = intents.some((intent) => intent.kind === 'new');
  const what = sentence(subjects, true);
  const inline = sentence(subjects, false);
  const name = intents.map((intent) => intent.id).join('-');

  const rows: DiscoverRow[] = [];
  for (const type of types) {
    const filter = filterFor(intents, type, kids);
    if (!filter) continue;
    const row: DiscoverRow = {
      key: `tmdb-${type}-${name}`,
      type,
      filter,
      newest,
      kids: kids !== undefined,
    };
    if (what !== undefined) row.what = what;
    if (inline !== undefined) row.inline = inline;
    if (year !== undefined) row.year = year;
    if (decade !== undefined) row.decade = decade;
    rows.push(row);
  }
  return rows;
}

/** Someone TMDB knows, as its search answers. */
export interface RemotePerson {
  id: number;
  name: string;
  /** What they are known for: Acting, Directing, Writing... */
  department?: string;
  /** TMDB's image path for their photo. */
  photo?: string;
  /** A few titles they are known for, by name. */
  knownFor: readonly string[];
}

/** Whether the words are the name of one of `titles`, as typed or spelt another way ("Some Like It Hot"). */
export function namesTitle(text: string, titles: readonly { name: string }[]): boolean {
  const key = keyOf(wordsOf(text));
  return key !== '' && titles.some((title) => keyOf(wordsOf(title.name)) === key);
}

/**
 * The person the words name, among TMDB's first matches for them: the name
 * as typed, or a typo away when it is two words or more ("tom hanks",
 * "cristopher nolan"). One word close to a name is not enough: "tom" is not
 * Tom Hanks. Nor is a name that is also a title TMDB found by the words
 * ("John Carter", "Erin Brockovich"): the film is the likelier meaning.
 */
export function personFor(
  text: string,
  people: readonly RemotePerson[],
  titles: readonly { name: string }[] = [],
): RemotePerson | undefined {
  const words = wordsOf(text);
  if (words.length === 0) return undefined;
  if (namesTitle(text, titles)) return undefined;
  const key = keyOf(words);
  for (const person of people.slice(0, 3)) {
    const name = keyOf(wordsOf(person.name));
    if (name === key) return person;
    if (words.length >= 2 && closeEnough(key, name)) return person;
  }
  return undefined;
}
