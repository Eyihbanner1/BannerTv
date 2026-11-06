import type { MetaPreview } from '@bannertv/protocol';
import { sortStable } from '../sports/sort';
import type { Understanding } from './understand';
import { closeEnough, keyOf, stem, wordsOf } from './words';

/** Titles the Top results row shows at most. */
export const MAX_TOP_RESULTS = 20;

const ARTICLES = new Set(['the', 'a', 'an']);

export interface RankContext {
  /** In the profile's My List. */
  saved?: (id: string) => boolean;
  /** Part watched: in Continue Watching. */
  watching?: (id: string) => boolean;
}

function withoutArticle(words: readonly string[]): readonly string[] {
  return words.length > 1 && ARTICLES.has(words[0]!) ? words.slice(1) : words;
}

/** How well a title's name answers the typed words, from 0 (not at all) to 100 (exactly). */
export function nameScore(name: string, typed: readonly string[]): number {
  const want = withoutArticle(typed);
  const have = withoutArticle(wordsOf(name));
  if (want.length === 0 || have.length === 0) return 0;
  const wantKey = keyOf(want);
  const haveKey = keyOf(have);
  if (haveKey === wantKey) return 100;
  if (haveKey.indexOf(wantKey) === 0) return 80;
  const haveStems = have.map(stem);
  const found = want.filter((word) => haveStems.indexOf(stem(word)) !== -1).length;
  if (found === want.length) return 60;
  if (haveKey.indexOf(wantKey) !== -1) return 50;
  if (closeEnough(wantKey, haveKey)) return 45;
  // A typo in a longer name: "breking" finds "Breaking Bad" by its start.
  if (haveKey.length > wantKey.length && closeEnough(wantKey, haveKey.slice(0, wantKey.length))) {
    return 40;
  }
  return Math.round((found / want.length) * 30);
}

/** The year a title came out, from releaseInfo such as "2019" or "2019-2023". */
function yearOf(item: MetaPreview): number | undefined {
  const match = /^(\d{4})/.exec(item.releaseInfo ?? '');
  return match ? Number(match[1]) : undefined;
}

/**
 * One row of the best answers from every addon's results: each title once
 * (the first addon's copy), best match first. The exact name comes first,
 * then names that start with the words, have all of them, or are a typo
 * away; a typed year and a title in My List or Continue Watching lift a
 * title; equal titles keep the addons' order. `groups` are each catalog's
 * results in the order Search lists catalogs. Types the words asked for
 * ("horror films") keep the row to them.
 */
export function topResults(
  understanding: Understanding,
  groups: readonly (readonly MetaPreview[])[],
  context: RankContext = {},
  max = MAX_TOP_RESULTS,
): MetaPreview[] {
  const seen = new Set<string>();
  const scored: { item: MetaPreview; score: number }[] = [];
  const types = understanding.types;
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (types && types.indexOf(item.type) === -1) continue;
      let score = nameScore(item.name, understanding.titleWords);
      // A typed year can be part of the name: "Blade Runner 2049", "Wonder Woman 1984".
      if (understanding.years.length > 0) {
        score = Math.max(score, nameScore(item.name, understanding.words) + 15);
      }
      const year = yearOf(item);
      if (year !== undefined && understanding.years.indexOf(year) !== -1) score += 15;
      if (context.saved?.(item.id)) score += 8;
      else if (context.watching?.(item.id)) score += 6;
      scored.push({ item, score });
    }
  }
  return sortStable(scored, (a, b) => b.score - a.score)
    .slice(0, max)
    .map((entry) => entry.item);
}
