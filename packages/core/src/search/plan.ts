import type { ContentType } from '@bannertv/protocol';
import { slug } from '../addons/board';
import type { DiscoverSource } from '../addons/sources';
import { KIDS_GENRE, KIDS_TYPES } from '../profiles/kids';
import type { AddonPhrase, Intent, Understanding } from './understand';
import { vocabulary } from './vocabulary';
import { keyOf, wordsOf } from './words';

/** Understood rows Search shows at most, so the addons' own rows stay in reach. */
export const MAX_UNDERSTOOD_ROWS = 6;

const BOTH_TYPES: readonly ContentType[] = ['movie', 'series'];

// Catalog names that say nothing on their own: "popular" must not open
// every addon's Popular catalog.
const PLAIN_NAMES = new Set(
  [
    'popular',
    'featured',
    'new',
    'top',
    'trending',
    'latest',
    'recent',
    'best',
    'search',
    'catalog',
    'movies',
    'series',
    'films',
    'shows',
    'tv',
    'last videos',
    'calendar videos',
  ].map((name) => keyOf(wordsOf(name))),
);

/** One row Search adds for what the words mean, drawn like a Home row. */
export interface PlannedRow {
  /** Unique within the plan, [a-z0-9-] only: safe for focus keys. */
  key: string;
  /**
   * genre: a catalog asked for a genre ("Comedy films"); year: Cinemeta's New
   * catalog for one year; new: that catalog for its newest year; catalog: an
   * installed catalog whose name was typed.
   */
  kind: 'genre' | 'year' | 'new' | 'catalog';
  /** What the row is named after: the genre ("Sci-fi"), the year, or the catalog's name. */
  label: string;
  type: ContentType;
  source: DiscoverSource;
  /** The extra to ask the catalog with: the genre, or nothing. */
  extra: readonly (readonly [string, string])[];
  /** Asked for Family titles, so a kids profile need not see Family on each one. */
  family: boolean;
  /** The intent the row answers. */
  intent: Intent;
}

export interface PlanOptions {
  /** A kids profile: films and series only, from addons not marked adult. */
  kids?: boolean;
  /** At most this many rows; MAX_UNDERSTOOD_ROWS when not given. */
  max?: number;
  /**
   * TMDB answers the moods it tags by keyword (stand-up comedy), so they get
   * no stand-in genre rows from the catalogs.
   */
  remoteMoods?: boolean;
}

function same(a: string, b: string): boolean {
  return keyOf(wordsOf(a)) === keyOf(wordsOf(b));
}

/** The label the bundled list gives a catalog genre ("Sci-Fi" is "Sci-fi"), else the genre. */
function genreLabel(genre: string): string {
  for (const entry of vocabulary()) {
    if (entry.kind === 'genre' && entry.genres.length === 1 && same(entry.genres[0]!, genre)) {
      return entry.label;
    }
  }
  return genre;
}

function isYearList(options: readonly string[]): boolean {
  return options.length > 0 && options.every((option) => /^\d{4}$/.test(option));
}

/**
 * The phrases the installed catalogs bring, for `understand`: the genres
 * they filter by (other than years) and the names of catalogs that can be
 * shown on their own, other than plain ones such as "Popular".
 */
export function addonPhrases(sources: readonly DiscoverSource[]): AddonPhrase[] {
  const phrases: AddonPhrase[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!isYearList(source.genres)) {
      for (const genre of source.genres) {
        const key = `genre:${keyOf(wordsOf(genre))}`;
        if (seen.has(key)) continue;
        seen.add(key);
        phrases.push({ kind: 'genre', text: genre });
      }
    }
    const name = keyOf(wordsOf(source.catalog.name));
    if (source.genreRequired || name === '' || PLAIN_NAMES.has(name)) continue;
    phrases.push({ kind: 'catalog', text: source.catalog.name, sourceKey: source.key });
  }
  return phrases;
}

function allowed(source: DiscoverSource, kids: boolean): boolean {
  if (!kids) return true;
  return (
    KIDS_TYPES.indexOf(source.catalog.type) !== -1 && !source.addon.manifest.behaviorHints.adult
  );
}

/**
 * The types an intent's rows are for, in order: those typed, else films,
 * series, then any other type the catalogs list (an anime addon's "anime").
 */
function typesFor(
  intent: Intent,
  asked: readonly ContentType[] | null,
  sources: readonly DiscoverSource[],
): readonly ContentType[] {
  let types: readonly ContentType[] = asked ?? BOTH_TYPES;
  if (!asked) {
    const all = types.slice();
    for (const source of sources) {
      if (all.indexOf(source.catalog.type) === -1) all.push(source.catalog.type);
    }
    types = all;
  }
  return intent.types ? types.filter((type) => intent.types!.indexOf(type) !== -1) : types;
}

/**
 * The rows that answer what the words mean, from the catalogs already
 * installed: for each genre, the first catalog of each type that filters by
 * it (Cinemeta's Popular, normally); a typed year from a catalog that lists
 * years (Cinemeta's New); "new" from its newest year; a typed catalog name,
 * that catalog. Moods with no catalog genre (stand-up comedy) get their
 * nearest genre's rows, unless TMDB answers them. Languages and decades need
 * TMDB (planRemote), so add none here.
 */
export function planSearch(
  understanding: Understanding,
  sources: readonly DiscoverSource[],
  options: PlanOptions = {},
): PlannedRow[] {
  const kids = options.kids === true;
  const max = options.max ?? MAX_UNDERSTOOD_ROWS;
  const usable = sources.filter((source) => allowed(source, kids));
  const rows: PlannedRow[] = [];
  const seen = new Set<string>();

  const add = (row: Omit<PlannedRow, 'key'>, value: string) => {
    const key = `${row.source.key}-${row.kind}-${slug(value) || 'all'}`;
    if (seen.has(key) || rows.length >= max) return;
    seen.add(key);
    rows.push({ ...row, key });
  };

  for (const intent of understanding.intents) {
    const types = typesFor(intent, understanding.types, usable);
    switch (intent.kind) {
      case 'genre':
      case 'mood':
      case 'family':
        if (options.remoteMoods && intent.kind === 'mood' && intent.tmdb?.keywords) break;
        for (const genre of intent.genres) {
          for (const type of types) {
            const source = usable.find(
              (s) =>
                s.catalog.type === type &&
                !s.genreRequired &&
                s.genres.some((option) => same(option, genre)),
            );
            if (!source) continue;
            const value = source.genres.find((option) => same(option, genre))!;
            add(
              {
                kind: 'genre',
                label: genreLabel(value),
                type,
                source,
                extra: [['genre', value]],
                family: same(value, KIDS_GENRE),
                intent,
              },
              value,
            );
          }
        }
        break;
      case 'year':
      case 'new':
        for (const type of types) {
          const year = intent.kind === 'year' ? String(intent.year) : undefined;
          const source = usable.find(
            (s) =>
              s.catalog.type === type &&
              s.genreRequired &&
              isYearList(s.genres) &&
              (year === undefined || s.genres.indexOf(year) !== -1),
          );
          if (!source) continue;
          const value = year ?? String(Math.max(...source.genres.map(Number)));
          add(
            {
              kind: intent.kind,
              label: value,
              type,
              source,
              extra: [['genre', value]],
              family: false,
              intent,
            },
            value,
          );
        }
        break;
      case 'catalog': {
        const source = usable.find((s) => s.key === intent.sourceKey);
        if (
          !source ||
          (understanding.types && understanding.types.indexOf(source.catalog.type) === -1)
        ) {
          break;
        }
        add(
          {
            kind: 'catalog',
            label: source.catalog.name,
            type: source.catalog.type,
            source,
            extra: [],
            family: false,
            intent,
          },
          'all',
        );
        break;
      }
      // Languages and decades need TMDB's discover: planRemote.
      case 'language':
      case 'decade':
        break;
    }
  }
  return rows;
}
