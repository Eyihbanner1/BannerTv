import type { ContentType } from '@bannertv/protocol';
import { stem, wordsOf } from './words';

/** What "films like The Matrix" asks for: titles like one title. */
export interface LikeQuery {
  /** The title the others should be like, as typed: "The Matrix". */
  title: string;
  /** The type asked for ("shows like Friends"), or undefined when the words say none. */
  type?: ContentType;
}

// Each as its stem, as the typed words are compared.
const stems = (words: readonly string[]) => new Set(words.map(stem));
const FILM_WORDS = stems(['film', 'movie', 'flick']);
const SHOW_WORDS = stems(['show', 'series', 'tv', 'programme', 'program', 'boxset']);
// Words before "like" that say nothing more: "something like", "more like", "anything like".
const LEAD_WORDS = stems(['something', 'anything', 'more', 'other', 'stuff', 'some']);

/**
 * Reads "films like The Matrix", "shows similar to Friends", "something
 * like Inception" or "like The Matrix" as a request for titles like that
 * one. Undefined when the words are not that shape or name no title after
 * "like", for a bare "like" with one word after it, which is more often a
 * title ("Like Crazy") than a request, and for "some like", a title's
 * start ("Some Like It Hot"). Without a type word the words may still be a
 * title ("Something Like Summer"): Search checks TMDB's titles before
 * reading them so.
 */
export function likeOf(text: string): LikeQuery | undefined {
  // The title keeps the case and punctuation it was typed with: TMDB searches it as written.
  const raw = text.trim().replace(/\s+/g, ' ');
  const match = /^(.*?)\b(like|similar to|same as)\s+(.+)$/i.exec(raw);
  if (!match) return undefined;
  const before = wordsOf(match[1]!);
  const title = match[3]!.trim();
  const after = wordsOf(title);
  if (after.length === 0) return undefined;

  let type: ContentType | undefined;
  for (const word of before) {
    const key = stem(word);
    if (FILM_WORDS.has(key)) type = 'movie';
    else if (SHOW_WORDS.has(key)) type = 'series';
    else if (!LEAD_WORDS.has(key)) return undefined;
  }
  // A bare "like" needs two words or more after it. Either way the addons are still asked
  // the words, so "Like Water for Chocolate" is found as a title too.
  if (before.length === 0 && match[2]!.toLowerCase() === 'like' && after.length < 2) {
    return undefined;
  }
  // "Some like" asks for nothing on its own ("some films like" does): "Some Like It Hot".
  if (!type && before.length === 1 && stem(before[0]!) === stem('some')) return undefined;
  return type ? { title, type } : { title };
}
