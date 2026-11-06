import { kidsTitleAllowed } from '../profiles/kids';
import type { DiscoverSource } from '../addons/sources';
import { vocabulary, type VocabularyEntry } from './vocabulary';
import { distance, keyOf, typosAllowed, wordsOf } from './words';

/** Genres offered when nothing is found and nothing is close, most asked for first. */
const FALLBACK_GENRES = ['comedy', 'action', 'drama', 'horror', 'scifi', 'documentary'];
/** For a kids profile, genres that hold titles for children. */
const KIDS_GENRES = ['family', 'animation', 'comedy', 'adventure', 'fantasy'];

/** The most a "Did you mean" may change: a long title can carry a typo per word. */
function typosFor(length: number): number {
  return length >= 14 ? 3 : typosAllowed(length);
}

/**
 * What the words were probably meant to be, when one of `candidates` (titles
 * already known on this screen: My List, Continue Watching, recent searches,
 * results so far) or a phrase Search understands is a typo or two away.
 * Ties go to the earlier candidate; phrases come after every candidate.
 */
export function didYouMean(text: string, candidates: readonly string[]): string | undefined {
  const key = keyOf(wordsOf(text));
  if (key === '') return undefined;
  let best: string | undefined;
  let bestDistance = Infinity;
  const consider = (candidate: string) => {
    const other = keyOf(wordsOf(candidate));
    if (other === '' || other === key) return;
    const max = typosFor(Math.min(key.length, other.length));
    if (max === 0) return;
    const d = distance(key, other, max);
    if (d <= max && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  };
  for (const candidate of candidates) consider(candidate);
  for (const entry of vocabulary()) {
    for (const phrase of entry.phrases) consider(phrase);
  }
  return best;
}

export interface GenreChip {
  /** As shown: "Comedy". */
  label: string;
  /** What searching the chip types. */
  query: string;
}

/**
 * Genres to offer when a search finds nothing: those whose phrases are
 * closest to the words, else the most asked-for, and only genres some
 * installed catalog of a type the profile sees filters by.
 */
export function genreChips(
  text: string,
  sources: readonly DiscoverSource[],
  options: { kids?: boolean; max?: number } = {},
): GenreChip[] {
  const max = options.max ?? 5;
  const filtered = new Set<string>();
  for (const source of sources) {
    if (options.kids && source.catalog.type !== 'movie' && source.catalog.type !== 'series')
      continue;
    for (const genre of source.genres) filtered.add(keyOf(wordsOf(genre)));
  }
  const genres = vocabulary().filter(
    (entry) =>
      (entry.kind === 'genre' || entry.kind === 'family') &&
      entry.genres.length > 0 &&
      entry.genres.every((genre) => filtered.has(keyOf(wordsOf(genre)))) &&
      // A kids profile sees no title of a genre not for children: offering it leads nowhere.
      (!options.kids || kidsTitleAllowed({ type: 'movie', genres: [...entry.genres] }, true)),
  );
  // Close means one typo more than Search forgives, so "horrrorr" still offers Horror.
  const key = keyOf(wordsOf(text));
  const scored: { entry: VocabularyEntry; score: number }[] = [];
  for (const entry of key.length < 4 ? [] : genres) {
    let score = Infinity;
    for (const phrase of entry.phrases) {
      const other = keyOf(wordsOf(phrase));
      const limit = typosFor(Math.min(key.length, other.length)) + 1;
      const d = distance(key, other, limit);
      if (d <= limit) score = Math.min(score, d);
    }
    if (score !== Infinity) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || genres.indexOf(a.entry) - genres.indexOf(b.entry));
  const chosen = scored.map((item) => item.entry);
  for (const id of options.kids ? KIDS_GENRES : FALLBACK_GENRES) {
    const entry = genres.find((item) => item.id === id);
    if (entry && chosen.indexOf(entry) === -1) chosen.push(entry);
  }
  return chosen.slice(0, max).map((entry) => ({ label: entry.label, query: entry.label }));
}
