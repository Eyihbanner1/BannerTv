import { languageName, type Resolution, type StreamEntry } from '@bannertv/core';
import type { TFunction } from 'i18next';
import { resolutionLabel, streamsStatus } from './describe';

/**
 * Quick filters on the stream lists (All streams, the player's Sources and
 * the phone's list): a picture size, cached only, one addon, one audio
 * language. Each profile keeps its last filter in its preferences.
 */

/** sd: 576p and below. 1440p counts as 1080p: more than it, short of 4K. */
export type FilterResolution = '2160p' | '1080p' | '720p' | 'sd';

export interface StreamFilter {
  resolution?: FilterResolution;
  cached?: true;
  /** The addon's manifest id. */
  addonId?: string;
  /** ISO 639-1, as StreamFacts.languages names them. */
  language?: string;
}

export const FILTER_RESOLUTIONS: readonly FilterResolution[] = ['2160p', '1080p', '720p', 'sd'];

/** No filter: every stream. One shared object, so an unfiltered profile keeps the same one. */
export const NO_FILTER: StreamFilter = Object.freeze({});

/** The most languages offered, the most common first. */
export const MAX_LANGUAGES = 8;

const ENGLISH = 'en';
const LANGUAGE_CODE = /^[a-z]{2}$/;
const MULTI = 'multi';

export function resolutionGroup(resolution: Resolution | undefined): FilterResolution | undefined {
  switch (resolution) {
    case '2160p':
      return '2160p';
    case '1440p':
    case '1080p':
      return '1080p';
    case '720p':
      return '720p';
    case '576p':
    case '480p':
    case '360p':
      return 'sd';
    default:
      return undefined;
  }
}

/** The audio languages a stream names, without "multi". */
function named(entry: StreamEntry): string[] {
  return entry.facts.languages.filter((code) => code !== MULTI);
}

/**
 * Whether a stream has this audio language. Torrentio flags only languages
 * other than English, so a stream that names none, or says MULTi, counts as
 * English too.
 */
function speaks(entry: StreamEntry, language: string): boolean {
  const codes = named(entry);
  if (codes.indexOf(language) >= 0) return true;
  return language === ENGLISH && (codes.length === 0 || entry.facts.languages.indexOf(MULTI) >= 0);
}

export function isFiltering(filter: StreamFilter): boolean {
  return (
    filter.resolution !== undefined ||
    filter.cached === true ||
    filter.addonId !== undefined ||
    filter.language !== undefined
  );
}

/** A stream of unknown size passes no size filter, and one that says nothing of a cache is not cached. */
export function matchesFilter(entry: StreamEntry, filter: StreamFilter): boolean {
  if (
    filter.resolution !== undefined &&
    resolutionGroup(entry.facts.resolution) !== filter.resolution
  ) {
    return false;
  }
  if (filter.cached === true && entry.facts.cached !== true) return false;
  if (filter.addonId !== undefined && entry.addonId !== filter.addonId) return false;
  if (filter.language !== undefined && !speaks(entry, filter.language)) return false;
  return true;
}

/** The streams the filter keeps, in the order given. */
export function filterStreams(
  entries: readonly StreamEntry[],
  filter: StreamFilter,
): StreamEntry[] {
  if (!isFiltering(filter)) return entries.slice();
  return entries.filter((entry) => matchesFilter(entry, filter));
}

export interface FilteredStreams {
  /** The streams to list, in the order given. */
  entries: StreamEntry[];
  /** A filter is on and no stream matches it, so every stream is listed instead. */
  missed: boolean;
}

/**
 * What a list shows under a filter. A filter kept from another title can name
 * what no stream here has: then every stream shows, rather than none. `keep`
 * names streams listed whatever the filter, such as the one playing.
 */
export function shownStreams(
  entries: readonly StreamEntry[],
  filter: StreamFilter,
  keep?: (entry: StreamEntry) => boolean,
): FilteredStreams {
  if (!isFiltering(filter)) return { entries: entries.slice(), missed: false };
  let matched = 0;
  const shown = entries.filter((entry) => {
    if (matchesFilter(entry, filter)) {
      matched++;
      return true;
    }
    return keep !== undefined && keep(entry);
  });
  if (matched === 0 && entries.length > 0) return { entries: entries.slice(), missed: true };
  return { entries: shown, missed: false };
}

export interface FilterChoices {
  /** Biggest first. */
  resolutions: Array<{ value: FilterResolution; count: number }>;
  /** How many are cached. */
  cached: number;
  /** In the collection's order, by name as the rows show them. */
  addons: Array<{ id: string; name: string; count: number }>;
  /** At most MAX_LANGUAGES, the most common first. */
  languages: Array<{ code: string; count: number }>;
}

/**
 * The values worth offering: only those at least one stream has, with how
 * many have each. A value `current` has is offered too, even when no stream
 * has it, so a menu still shows what is on. English is offered when some
 * stream names a language: with none named, every stream would pass it.
 */
export function filterChoices(
  entries: readonly StreamEntry[],
  names: ReadonlyMap<string, string> = new Map(),
  current: StreamFilter = NO_FILTER,
): FilterChoices {
  const sizes = new Map<FilterResolution, number>();
  let cached = 0;
  const addons = new Map<string, { id: string; rank: number; seen: number; count: number }>();
  const codes: string[] = [];
  entries.forEach((entry, index) => {
    const size = resolutionGroup(entry.facts.resolution);
    if (size) sizes.set(size, (sizes.get(size) ?? 0) + 1);
    if (entry.facts.cached === true) cached++;
    const addon = addons.get(entry.addonId);
    if (addon) {
      addon.count++;
      addon.rank = Math.min(addon.rank, entry.addonRank);
    } else {
      addons.set(entry.addonId, {
        id: entry.addonId,
        rank: entry.addonRank,
        seen: index,
        count: 1,
      });
    }
    for (const code of named(entry)) {
      if (LANGUAGE_CODE.test(code) && codes.indexOf(code) < 0) codes.push(code);
    }
  });

  if (current.resolution !== undefined && !sizes.has(current.resolution)) {
    sizes.set(current.resolution, 0);
  }
  const resolutions = FILTER_RESOLUTIONS.filter((value) => sizes.has(value)).map((value) => ({
    value,
    count: sizes.get(value)!,
  }));

  if (current.addonId !== undefined && !addons.has(current.addonId)) {
    addons.set(current.addonId, {
      id: current.addonId,
      rank: Number.MAX_SAFE_INTEGER,
      seen: entries.length,
      count: 0,
    });
  }
  const addonList = Array.from(addons.values())
    .sort((a, b) => a.rank - b.rank || a.seen - b.seen)
    .map(({ id, count }) => ({ id, name: names.get(id) ?? id, count }));

  if (codes.length > 0 && codes.indexOf(ENGLISH) < 0) codes.push(ENGLISH);
  const counted = codes
    .map((code, index) => ({
      code,
      index,
      count: entries.filter((entry) => speaks(entry, code)).length,
    }))
    .filter((language) => language.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, MAX_LANGUAGES)
    .map(({ code, count }) => ({ code, count }));
  if (current.language !== undefined && !counted.some((l) => l.code === current.language)) {
    counted.push({
      code: current.language,
      count: entries.filter((entry) => speaks(entry, current.language!)).length,
    });
  }

  return { resolutions, cached, addons: addonList, languages: counted };
}

/**
 * Reads a stored filter field by field, so one bad value never loses the
 * rest. Nothing usable reads as NO_FILTER.
 */
export function readStreamFilter(value: unknown): StreamFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NO_FILTER;
  const stored = value as Record<string, unknown>;
  const filter: StreamFilter = {};
  if (FILTER_RESOLUTIONS.indexOf(stored.resolution as FilterResolution) >= 0) {
    filter.resolution = stored.resolution as FilterResolution;
  }
  if (stored.cached === true) filter.cached = true;
  if (typeof stored.addonId === 'string' && stored.addonId.trim() !== '') {
    filter.addonId = stored.addonId;
  }
  if (typeof stored.language === 'string' && LANGUAGE_CODE.test(stored.language)) {
    filter.language = stored.language;
  }
  return isFiltering(filter) ? filter : NO_FILTER;
}

/**
 * The filter as one string, its fields always in the same order: '{}' for
 * none. Two filters are the same when their keys are.
 */
export function filterKey(filter: StreamFilter): string {
  return JSON.stringify({
    resolution: filter.resolution,
    cached: filter.cached,
    addonId: filter.addonId,
    language: filter.language,
  });
}

/** The filter a `filterKey` names; NO_FILTER for anything else. */
export function readFilterKey(value: unknown): StreamFilter {
  if (typeof value !== 'string') return NO_FILTER;
  try {
    return readStreamFilter(JSON.parse(value));
  } catch {
    return NO_FILTER;
  }
}

/** How a picture size reads: "4K", "1080p", "SD". Box names, so not translated. */
export function filterResolutionLabel(value: FilterResolution): string {
  return value === 'sd' ? 'SD' : (resolutionLabel(value) ?? value);
}

/** What is on, for the Filter button: "1080p, cached, Torrentio". Empty for none. */
export function filterSummary(
  t: TFunction,
  filter: StreamFilter,
  names: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  if (filter.resolution) parts.push(filterResolutionLabel(filter.resolution));
  if (filter.cached) parts.push(t('streams.filter.cachedValue'));
  if (filter.addonId !== undefined) parts.push(names.get(filter.addonId) ?? filter.addonId);
  if (filter.language !== undefined) parts.push(languageName(filter.language));
  return parts.join(', ');
}

/** "Filter: 1080p, cached", "Filter: none". */
export function filterButtonLabel(
  t: TFunction,
  filter: StreamFilter,
  names: ReadonlyMap<string, string>,
): string {
  return t('streams.filter.button', {
    value: filterSummary(t, filter, names) || t('streams.filter.none'),
  });
}

/**
 * The line over a list: "Asking 2 addons…" while they answer, then "3 of 12
 * streams" under a filter, or that it matched nothing and all are shown.
 */
export function filteredStatus(
  t: TFunction,
  state: { pending: number; failed: readonly unknown[] },
  shown: FilteredStreams,
  total: number,
): string {
  if (state.pending > 0) return streamsStatus(t, state, total);
  if (shown.missed) return t('streams.filter.missed');
  if (state.failed.length > 0 || shown.entries.length === total) {
    return streamsStatus(t, state, shown.entries.length);
  }
  return t('streams.filter.shown', { shown: shown.entries.length, count: total });
}
