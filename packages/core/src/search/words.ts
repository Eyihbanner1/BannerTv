import { foldText } from '../sports/text';

/**
 * Reading what someone typed into Search the same way every time: folded
 * case and accents, punctuation and hyphens as spaces, and each word in one
 * form for singular and plural, so "Stand-up", "standup" and "stand ups"
 * compare equal. Plain ES2017 only: this runs on webOS 5 and Hermes.
 */

// Words whose trailing s is not a plural.
const KEEP_S = new Set(['news', 'series', 'species', 'chaos', 'christmas', 'boss', 'class']);

// For an engine without String.prototype.normalize, where foldText leaves
// accents on: the common accented Latin letters, so "comédie" stays one word.
const ACCENTED: readonly (readonly [RegExp, string])[] = [
  [/[àáâãäåā]/g, 'a'],
  [/[çćč]/g, 'c'],
  [/[èéêëēė]/g, 'e'],
  [/[ìíîïī]/g, 'i'],
  [/[ñń]/g, 'n'],
  [/[òóôõöō]/g, 'o'],
  [/[ùúûüū]/g, 'u'],
  [/[ýÿ]/g, 'y'],
  [/[šś]/g, 's'],
  [/[žźż]/g, 'z'],
];

/** The typed text as lower-case words: accents folded, `&` as "and", punctuation gone. */
export function wordsOf(text: string): string[] {
  let folded = foldText(text);
  if (/[^ -~]/.test(folded)) {
    for (const [letters, plain] of ACCENTED) folded = folded.replace(letters, plain);
  }
  folded = folded
    .replace(/&/g, ' and ')
    // An apostrophe joins: "rock'n'roll", "'90s" and "kids' films" stay one word.
    .replace(/['\u2019\u2018`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return folded === '' ? [] : folded.split(' ');
}

/**
 * One form of a word for singular and plural alike: "comedies" and "comedy"
 * both read "comedy", "movies" and "movie" both "movy". It is a key for
 * comparing, never shown, so it need not be a real word.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 3 && w.charAt(w.length - 1) === 's' && !KEEP_S.has(w) && !/ss$/.test(w)) {
    w = w.slice(0, -1);
    // "witches", "boxes", "heroes": the e came with the plural.
    if (/(ch|sh|x|z|o)e$/.test(w)) w = w.slice(0, -1);
  }
  if (w.length > 4 && /ie$/.test(w)) w = `${w.slice(0, -2)}y`;
  return w;
}

/** The words as one key without spaces, so "stand up" and "standup" are the same. */
export function keyOf(words: readonly string[]): string {
  return words.map(stem).join('');
}

/** How many typos a key of this length may carry and still match: none when short. */
export function typosAllowed(length: number): number {
  if (length < 5) return 0;
  return length < 9 ? 1 : 2;
}

/**
 * The optimal string alignment distance between two strings (Damerau-
 * Levenshtein, where a swap of two neighbours counts as one typo), or
 * `max + 1` as soon as it is certain to be more than `max`.
 */
export function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let previous: number[] = [];
  for (let j = 0; j <= b.length; j++) previous.push(j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let value = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost);
      if (
        i > 1 &&
        j > 1 &&
        a.charAt(i - 1) === b.charAt(j - 2) &&
        a.charAt(i - 2) === b.charAt(j - 1)
      ) {
        value = Math.min(value, before[j - 2]! + 1);
      }
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    before = previous;
    previous = row;
  }
  return Math.min(previous[b.length]!, max + 1);
}

/** Whether two keys are the same but for typos their length allows. */
export function closeEnough(typed: string, known: string): boolean {
  const max = typosAllowed(Math.min(typed.length, known.length));
  return max > 0 && distance(typed, known, max) <= max;
}
