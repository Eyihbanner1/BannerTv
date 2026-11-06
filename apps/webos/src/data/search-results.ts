import {
  addonPhrases,
  type CatalogSource,
  didYouMean,
  type DiscoverSource,
  type GenreChip,
  genreChips,
  kidsTitleAllowed,
  type PlannedRow,
  planSearch,
  type Query,
  type QueryState,
  topResults,
  understand,
  type Understanding,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { addonClient } from './addons';
import { typeLabel } from './describe';
import { library } from './library';
import { progress } from './playback';
import { isKidsProfile } from './profiles';
import { recentSearches } from './search';

/**
 * The Top results row waits this long for slow addons once Search starts;
 * after that it is drawn from the answers in, and stays as it is, so tiles
 * never move under the focus.
 */
export const TOP_RESULTS_WAIT_MS = 2500;

type Items = readonly MetaPreview[];

/** waiting: not decided yet. none: fewer than two catalogs found titles, so it would only repeat one row. */
export type TopResultsState =
  { status: 'waiting' } | { status: 'none' } | { status: 'shown'; items: Items };

export interface TopResults {
  get(): TopResultsState;
  subscribe(listener: () => void): () => void;
}

const WAITING: TopResultsState = { status: 'waiting' };
const NONE: TopResultsState = { status: 'none' };

function settled(state: QueryState<MetaPreview[]>): boolean {
  return state.status === 'success' || state.status === 'error';
}

/**
 * One row of the best titles from several search queries, decided once: when
 * every query has answered or failed, or `wait` ms after the first listener,
 * whichever is sooner. When every one failed it waits on, for Try again. It is shown only when two or more catalogs found
 * titles. `visible` keeps what the profile may see; `rank` orders them.
 */
export function createTopResults(
  queries: readonly Query<MetaPreview[]>[],
  visible: (items: Items) => Items,
  rank: (groups: readonly Items[]) => MetaPreview[],
  wait = TOP_RESULTS_WAIT_MS,
): TopResults {
  let state: TopResultsState = queries.length < 2 ? NONE : WAITING;
  const listeners = new Set<() => void>();
  let stops: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    for (const unsubscribe of stops) unsubscribe();
    stops = [];
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const allFailed = () =>
    queries.every((query) => {
      const now = query.get();
      return now.status === 'error' && now.data === undefined;
    });

  const decide = () => {
    if (state.status !== 'waiting') return;
    // Every catalog failed: nothing to decide on. Try again may yet bring answers.
    if (allFailed()) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      return;
    }
    const groups = queries.map((query) => visible(query.get().data ?? []));
    const found = groups.filter((group) => group.length > 0).length;
    const items = found >= 2 ? rank(groups) : [];
    state = items.length > 0 ? { status: 'shown', items } : NONE;
    stop();
    for (const listener of Array.from(listeners)) listener();
  };

  const check = () => {
    if (state.status !== 'waiting') return;
    if (queries.every((query) => settled(query.get()))) decide();
    // Asked again after every one failed: wait for them as at the start.
    else if (timer === undefined) timer = setTimeout(decide, wait);
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (state.status === 'waiting' && stops.length === 0) {
        stops = queries.map((query) => query.subscribe(check));
        timer = setTimeout(decide, wait);
        check();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

/** Each query's state, read together; the array keeps its identity until one of them changes. */
export function useQueryStates<T>(queries: readonly Query<T>[]): readonly QueryState<T>[] {
  const last = useRef<readonly QueryState<T>[]>([]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = queries.map((query) => query.subscribe(listener));
      return () => {
        for (const unsubscribe of stops) unsubscribe();
      };
    },
    [queries],
  );
  const get = useCallback(() => {
    const now = queries.map((query) => query.get());
    const before = last.current;
    if (before.length === now.length && now.every((state, index) => state === before[index])) {
      return before;
    }
    last.current = now;
    return now;
  }, [queries]);
  const states = useSyncExternalStore(subscribe, get);
  useEffect(() => {
    for (const query of queries) query.load();
  }, [queries]);
  return states;
}

const NO_ITEMS: Items = [];
// A kids profile's titles for each list, kept so a row that has not changed
// keeps the same list and is not drawn again when another addon answers.
const kidsTitles = new WeakMap<Items, Items>();
const kidsFamilyTitles = new WeakMap<Items, Items>();

/** What a kids profile may see of a row's titles; everything for anyone else. */
export function visibleTitles(items: Items, fromFamilyCatalog = false): Items {
  if (!isKidsProfile()) return items;
  const cache = fromFamilyCatalog ? kidsFamilyTitles : kidsTitles;
  let kept = cache.get(items);
  if (!kept) {
    kept = items.filter((item) => kidsTitleAllowed(item, fromFamilyCatalog));
    cache.set(items, kept);
  }
  return kept;
}

/** Whether the profile has a title in My List, or part watched. */
const rankContext = {
  saved: (id: string) => library.has(id),
  watching: (id: string) => progress.forMeta(id).some((entry) => !entry.watched),
};

/** The search query of one catalog, as both screens ask it. */
export function searchQuery(source: CatalogSource, term: string): Query<MetaPreview[]> {
  return addonClient.catalog(
    source.addon,
    source.catalog.type,
    source.catalog.id,
    [['search', term]],
    {
      persist: false,
    },
  );
}

/** An understood row's catalog query: the same one Home and Discover make, so it shares their cache. */
export function plannedQuery(row: PlannedRow): Query<MetaPreview[]> {
  return addonClient.catalog(row.source.addon, row.type, row.source.catalog.id, row.extra);
}

export interface SmartSearch {
  understanding: Understanding;
  /** Rows for what the words mean, drawn after Top results and before the addons' rows. */
  planned: readonly PlannedRow[];
  /**
   * The words were read only by forgiving typos ("horor", or "Spooks" as
   * spoof): the addons' rows come before the planned ones, since a title
   * they found by those very words is the likelier meaning.
   */
  plannedLast: boolean;
  /** One search query per source, in the sources' order. */
  queries: readonly Query<MetaPreview[]>[];
  /** Per source, its state. */
  states: readonly QueryState<MetaPreview[]>[];
  /** Per source, the titles the profile may see: null while loading, [] when empty or failed. */
  results: readonly (Items | null)[];
  /** Per source, whether it failed with nothing to show. */
  failed: readonly boolean[];
  /** Every source has answered or failed. */
  settled: boolean;
  /** The Top results row. */
  top: TopResultsState;
}

/**
 * Everything Search shows for a term apart from Sports: what the words mean,
 * the rows that answer it from the catalogs in `discover`, each search
 * source's titles, and the Top results row. The TV and the phone both draw
 * from this.
 */
export function useSmartSearch(
  term: string,
  sources: readonly CatalogSource[],
  discover: readonly DiscoverSource[],
): SmartSearch {
  const kids = isKidsProfile();
  const understanding = useMemo(() => understand(term, addonPhrases(discover)), [term, discover]);
  const planned = useMemo(
    () => planSearch(understanding, discover, { kids }),
    [understanding, discover, kids],
  );
  const queries = useMemo(
    () => sources.map((source) => searchQuery(source, term)),
    [sources, term],
  );
  const states = useQueryStates(queries);
  const results = useMemo(
    () =>
      states.map((state) =>
        state.data ? visibleTitles(state.data) : state.status === 'error' ? NO_ITEMS : null,
      ),
    [states],
  );
  const failed = useMemo(
    () => states.map((state) => state.status === 'error' && state.data === undefined),
    [states],
  );
  const top = useMemo(
    () =>
      createTopResults(
        queries,
        // Only titles of the types the words ask for count: "comedy films" with
        // the series catalog finding titles is still one catalog's row.
        (items) => {
          const types = understanding.types;
          const kept = visibleTitles(items);
          return types ? kept.filter((item) => types.indexOf(item.type) !== -1) : kept;
        },
        (groups) => topResults(understanding, groups, rankContext),
      ),
    [queries, understanding],
  );
  const topState = useSyncExternalStore(top.subscribe, top.get);
  const intents = understanding.intents;
  return {
    understanding,
    planned,
    plannedLast: intents.length > 0 && intents.every((intent) => intent.typo),
    queries,
    states,
    results,
    failed,
    settled: states.every(settled),
    top: topState,
  };
}

/** An understood row's title: "Comedy films", "Series from 2024", "New films", or the catalog's name. */
export function plannedTitle(t: TFunction, row: PlannedRow): string {
  if (row.kind === 'catalog') return row.label;
  const type = row.type === 'movie' ? 'Films' : row.type === 'series' ? 'Series' : 'Other';
  const values = { genre: row.label, year: row.label, type: typeLabel(t, row.type) };
  if (row.kind === 'genre') return t(`search.genre${type}`, values);
  if (row.kind === 'year') return t(`search.year${type}`, values);
  return t(`search.new${type}`, values);
}

/** Where an understood row's See all goes: its catalog, with its genre. */
export function plannedCatalog(row: PlannedRow): {
  transportUrl: string;
  type: string;
  catalogId: string;
  genre?: string;
} {
  const genre = row.extra.find(([name]) => name === 'genre');
  const catalog = {
    transportUrl: row.source.addon.transportUrl,
    type: row.type,
    catalogId: row.source.catalog.id,
  };
  return genre ? { ...catalog, genre: genre[1] } : catalog;
}

export interface SearchHelp {
  /** A title or phrase the words were probably meant to be. */
  didYouMean?: string;
  /** Genres to look through instead. */
  chips: GenreChip[];
}

/** What Nothing found offers: a likely spelling from recent searches and My List, and genres. */
export function searchHelp(term: string, discover: readonly DiscoverSource[]): SearchHelp {
  const names = recentSearches.get().concat(library.items().map((item) => item.name));
  const help: SearchHelp = { chips: genreChips(term, discover, { kids: isKidsProfile() }) };
  const meant = didYouMean(term, names);
  if (meant !== undefined) help.didYouMean = meant;
  return help;
}
