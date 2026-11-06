import type { ContentType } from '@bannertv/protocol';
import { type IntentKind, type TmdbHint, vocabulary, type VocabularyEntry } from './vocabulary';
import { distance, keyOf, stem, typosAllowed, wordsOf } from './words';

/** The longest phrase, in words, that is looked up as one. */
const LONGEST_PHRASE = 5;

/** A phrase an installed addon brings: a genre its catalogs filter by, or a catalog's name. */
export interface AddonPhrase {
  kind: 'genre' | 'catalog';
  /** As the addon writes it: "Mecha", "Anime Trending". */
  text: string;
  /** For a catalog: its source key, so the plan can find it again. */
  sourceKey?: string;
}

/** One thing the words were read as. */
export interface Intent {
  /** Stable, [a-z0-9-] only. */
  id: string;
  kind: IntentKind | 'catalog';
  /** As a row names it. */
  label: string;
  /** Catalog genres that stand for it, best first; none for a language, year or catalog. */
  genres: readonly string[];
  /** The only types it applies to, when not every type. */
  types?: readonly ContentType[];
  tmdb?: TmdbHint;
  /** For a year: the year. For a decade: its first year (1990 for "90s"). */
  year?: number;
  /** For a catalog phrase: the source it names. */
  sourceKey?: string;
  /** The typed words it was read from, folded. */
  words: string;
  /** Read with a typo forgiven, so it was not written quite like this. */
  typo: boolean;
}

export interface Understanding {
  /** The typed words, folded: lower case, no accents or punctuation. */
  words: readonly string[];
  /**
   * What the words mean, in the order typed. Empty unless every word is
   * understood, so "star wars" never reads as the War genre.
   */
  intents: readonly Intent[];
  /** The types the words ask for ("horror films"), or null for every type. Null without intents. */
  types: readonly ContentType[] | null;
  /** Every year typed ("dune 2021"), understood or not, for ranking titles. */
  years: readonly number[];
  /** The typed words without years: what a title's name is compared with. */
  titleWords: readonly string[];
}

const TYPE_WORDS: Record<string, ContentType> = {};
for (const word of ['film', 'movie', 'flick', 'cinema']) TYPE_WORDS[stem(word)] = 'movie';
for (const word of [
  'series',
  'show',
  'tv',
  'telly',
  'television',
  'programme',
  'program',
  'boxset',
  'miniseries',
]) {
  TYPE_WORDS[stem(word)] = 'series';
}

// Words that say nothing about what to find. "like" is not one: "shows like
// Friends" means something Search cannot answer yet.
const FILLERS = new Set(
  [
    'the',
    'a',
    'an',
    'of',
    'and',
    'or',
    'in',
    'on',
    'with',
    'about',
    'for',
    'to',
    'me',
    'my',
    'some',
    'any',
    'all',
    'best',
    'good',
    'great',
    'greatest',
    'top',
    'popular',
    'classic',
    'famous',
    'show me',
    'i',
    'want',
    'watch',
    'something',
    'that',
    'are',
    'is',
    'from',
    'more',
    'most',
    'really',
    'very',
  ].map((word) => keyOf(wordsOf(word))),
);

const DECADE_WORDS: Record<string, number> = {
  twenties: 1920,
  thirties: 1930,
  forties: 1940,
  fifties: 1950,
  sixties: 1960,
  seventies: 1970,
  eighties: 1980,
  nineties: 1990,
  noughties: 2000,
};

function yearOf(word: string): number | undefined {
  return /^(19|20)\d\d$/.test(word) ? Number(word) : undefined;
}

/** "90s" 1990, "1990s" 1990, "00s" 2000, "20s" 2020, "nineties" 1990. */
function decadeOf(word: string): number | undefined {
  if (DECADE_WORDS[word] !== undefined) return DECADE_WORDS[word];
  const full = /^((?:19|20)\d0)s$/.exec(word);
  if (full) return Number(full[1]);
  const short = /^(\d)0s$/.exec(word);
  if (!short) return undefined;
  const tens = Number(short[1]);
  return tens <= 2 ? 2000 + tens * 10 : 1900 + tens * 10;
}

interface Indexed {
  key: string;
  entry: VocabularyEntry | AddonEntry;
}

interface AddonEntry {
  id: string;
  kind: 'genre' | 'catalog';
  label: string;
  genres: readonly string[];
  sourceKey?: string;
  phrases: readonly string[];
}

interface PhraseIndex {
  exact: Map<string, Indexed>;
  all: Indexed[];
}

function addTo(index: PhraseIndex, entry: VocabularyEntry | AddonEntry): void {
  for (const phrase of entry.phrases) {
    const words = wordsOf(phrase);
    if (words.length === 0) continue;
    const key = keyOf(words);
    const item = { key, entry };
    // The first entry to claim a phrase keeps it: the bundled list before addons'.
    if (!index.exact.has(key)) index.exact.set(key, item);
    index.all.push(item);
  }
}

let bundled: PhraseIndex | undefined;

function bundledIndex(): PhraseIndex {
  if (!bundled) {
    bundled = { exact: new Map(), all: [] };
    for (const entry of vocabulary()) addTo(bundled, entry);
  }
  return bundled;
}

function slugOf(text: string): string {
  return wordsOf(text).join('-');
}

/** The bundled index with the installed addons' phrases after it. */
function indexWith(phrases: readonly AddonPhrase[]): PhraseIndex {
  const base = bundledIndex();
  if (phrases.length === 0) return base;
  const index: PhraseIndex = { exact: new Map(base.exact), all: base.all.slice() };
  for (const phrase of phrases) {
    if (wordsOf(phrase.text).length === 0) continue;
    const entry: AddonEntry =
      phrase.kind === 'genre'
        ? {
            id: `genre-${slugOf(phrase.text)}`,
            kind: 'genre',
            label: phrase.text,
            genres: [phrase.text],
            phrases: [phrase.text],
          }
        : {
            id: `catalog-${phrase.sourceKey ?? slugOf(phrase.text)}`,
            kind: 'catalog',
            label: phrase.text,
            genres: [],
            phrases: [phrase.text],
          };
    if (phrase.sourceKey !== undefined) entry.sourceKey = phrase.sourceKey;
    addTo(index, entry);
  }
  return index;
}

function intentOf(item: Indexed, words: string, typo: boolean): Intent {
  const { entry } = item;
  const intent: Intent = {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    genres: entry.genres,
    words,
    typo,
  };
  if ('types' in entry && entry.types) intent.types = entry.types;
  if ('tmdb' in entry && entry.tmdb) intent.tmdb = entry.tmdb;
  if ('sourceKey' in entry && entry.sourceKey !== undefined) intent.sourceKey = entry.sourceKey;
  return intent;
}

/**
 * The closest phrase to these words, within the typos the shorter of the two
 * allows; the bundled list's phrase when two are as close.
 */
function nearest(index: PhraseIndex, key: string): Indexed | undefined {
  let best: Indexed | undefined;
  let bestDistance = Infinity;
  for (const item of index.all) {
    const max = typosAllowed(Math.min(key.length, item.key.length));
    if (max === 0) continue;
    const d = distance(key, item.key, max);
    if (d <= max && d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Reads typed words as genres, moods, languages, years and types, forgiving
 * a typo in longer words: "scary movies" is the Horror genre in films,
 * "documentries" the Documentary genre. `phrases` adds what the installed
 * addons offer: their catalogs' genres and names.
 */
export function understand(text: string, phrases: readonly AddonPhrase[] = []): Understanding {
  const words = wordsOf(text);
  const years: number[] = [];
  const titleWords: string[] = [];
  for (const word of words) {
    const year = yearOf(word);
    if (year === undefined) titleWords.push(word);
    else years.push(year);
  }
  const none: Understanding = { words, intents: [], types: null, years, titleWords };
  if (words.length === 0) return none;

  const index = indexWith(phrases);
  const intents: Intent[] = [];
  const types: ContentType[] = [];
  let i = 0;
  read: while (i < words.length) {
    const longest = Math.min(LONGEST_PHRASE, words.length - i);
    // The longest phrase written exactly.
    for (let n = longest; n >= 1; n--) {
      const item = index.exact.get(keyOf(words.slice(i, i + n)));
      if (item) {
        intents.push(intentOf(item, words.slice(i, i + n).join(' '), false));
        i += n;
        continue read;
      }
    }
    // Words that say nothing, as two ("show me") or one.
    if (i + 1 < words.length && FILLERS.has(keyOf(words.slice(i, i + 2)))) {
      i += 2;
      continue;
    }
    // A type, as one word or two ("box set").
    for (let n = Math.min(2, words.length - i); n >= 1; n--) {
      const type = TYPE_WORDS[keyOf(words.slice(i, i + n))];
      if (type) {
        if (types.indexOf(type) === -1) types.push(type);
        i += n;
        continue read;
      }
    }
    const word = words[i]!;
    if (FILLERS.has(stem(word))) {
      i += 1;
      continue;
    }
    const year = yearOf(word);
    if (year !== undefined) {
      intents.push({
        id: `year-${year}`,
        kind: 'year',
        label: word,
        genres: [],
        year,
        words: word,
        typo: false,
      });
      i += 1;
      continue;
    }
    const decade = decadeOf(word);
    if (decade !== undefined) {
      intents.push({
        id: `decade-${decade}`,
        kind: 'decade',
        label: `${decade}s`,
        genres: [],
        year: decade,
        words: word,
        typo: false,
      });
      i += 1;
      continue;
    }
    // The longest phrase within a typo or two.
    for (let n = longest; n >= 1; n--) {
      const item = nearest(index, keyOf(words.slice(i, i + n)));
      if (item) {
        intents.push(intentOf(item, words.slice(i, i + n).join(' '), true));
        i += n;
        continue read;
      }
    }
    // A word nothing explains: the words are a title, or something Search cannot read.
    return none;
  }
  if (intents.length === 0) return none;
  return { words, intents, types: types.length > 0 ? types : null, years, titleWords };
}
