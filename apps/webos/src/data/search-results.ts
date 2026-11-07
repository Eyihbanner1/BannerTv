import {
  addonPhrases,
  type CatalogSource,
  didYouMean,
  type DiscoverRow,
  type DiscoverSource,
  type GenreChip,
  genreChips,
  kidsDetailsAllowed,
  type KidsRating,
  kidsTitleAllowed,
  type LikeQuery,
  likeOf,
  type MultiAnswer,
  namesTitle,
  type PersonRole,
  personFor,
  type PlannedRow,
  planRemote,
  planSearch,
  type Query,
  type QueryState,
  type RemoteAnswer,
  type RemotePerson,
  type RemoteTitle,
  type RemoteType,
  roleOf,
  type Suggestion,
  suggestions,
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
import { activeProfile, isKidsProfile } from './profiles';
import { recentSearches } from './search';
import { searchService, useSearchTmdbOn } from './tmdb';
import { useQuery } from './use-query';

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

function settled(state: QueryState<unknown>): boolean {
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

/** One of Search's rows from TMDB. Its titles are by IMDb id, so they open on Details as any other. */
export type RemoteRow =
  | {
      kind: 'person';
      key: string;
      query: Query<RemoteAnswer>;
      person: RemotePerson;
      role: PersonRole;
    }
  | { kind: 'like'; key: string; query: Query<RemoteAnswer>; like: LikeQuery }
  /** A kids profile's titles by name, each checked against its UK rating limit. */
  | { kind: 'titles'; key: string; query: Query<RemoteAnswer> }
  /** What the words mean together: "Stand-up comedy films", "Korean horror films". */
  | { kind: 'discover'; key: string; query: Query<RemoteAnswer>; row: DiscoverRow };

export interface SmartSearch {
  understanding: Understanding;
  /**
   * TMDB's rows for who or what the words name: someone's work ("With Tom
   * Hanks"), titles like one ("Films like The Matrix"), or a kids profile's
   * titles checked against its rating. Drawn first, above Top results.
   */
  named: readonly RemoteRow[];
  /** TMDB's rows for what the words mean together, drawn before the planned rows. */
  remote: readonly RemoteRow[];
  /** What TMDB knows by the words, for suggestions; undefined until it answers, or when not asked. */
  multi: MultiAnswer | undefined;
  /** The query for `multi`, for Try again; null when TMDB is not asked who the words name. */
  multiQuery: Query<MultiAnswer> | null;
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
  /** Every source has answered or failed, and TMDB has said who the words name. */
  settled: boolean;
  /** The Top results row. */
  top: TopResultsState;
}

/**
 * Everything Search shows for a term apart from Sports: what the words mean,
 * the rows that answer it from the catalogs in `discover` and from TMDB,
 * each search source's titles, and the Top results row. The TV and the
 * phone both draw from this.
 */
export function useSmartSearch(
  term: string,
  sources: readonly CatalogSource[],
  discover: readonly DiscoverSource[],
): SmartSearch {
  const kids = isKidsProfile();
  const understanding = useMemo(() => understand(term, addonPhrases(discover)), [term, discover]);
  const asked = useRemoteRows(term, understanding);
  // TMDB's rows stand for the moods it tags by keyword only while they may yet
  // show titles: when every one fails or finds nothing, the catalogs' genres stand in.
  const remoteQueries = useMemo(() => asked.remote.map((row) => row.query), [asked.remote]);
  const remoteStates = useQueryStates(remoteQueries);
  const remoteMoods = remoteStates.some((state) =>
    state.data ? remoteTitles(state.data).length > 0 : state.status !== 'error',
  );
  const planned = useMemo(
    () => planSearch(understanding, discover, { kids, remoteMoods }),
    [understanding, discover, kids, remoteMoods],
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
    named: asked.named,
    remote: asked.remote,
    multi: asked.multi,
    multiQuery: asked.multiQuery,
    planned,
    plannedLast: intents.length > 0 && intents.every((intent) => intent.typo),
    queries,
    states,
    results,
    failed,
    settled: states.every(settled) && asked.settled,
    top: topState,
  };
}

function remoteType(type: string | undefined): RemoteType | undefined {
  return type === 'movie' || type === 'series' ? type : undefined;
}

interface AskedRows {
  named: readonly RemoteRow[];
  remote: readonly RemoteRow[];
  multi: MultiAnswer | undefined;
  multiQuery: Query<MultiAnswer> | null;
  /** TMDB has said who the words name, or was not asked. */
  settled: boolean;
}

const NO_ROWS: readonly RemoteRow[] = [];

/**
 * The rows Search asks TMDB for, when it may: who the words name, titles
 * like one, what they mean together, and for a kids profile its titles
 * checked by rating when nothing else is asked. People are looked for only
 * when the words are not otherwise understood, and never for a kids
 * profile. "Like" words without a type ("Something Like Summer") may be a
 * title's name: TMDB is asked what it knows by them first, and when it
 * knows a title of that very name, it is that title the words mean.
 */
function useRemoteRows(term: string, understanding: Understanding): AskedRows {
  const on = useSearchTmdbOn();
  const max: KidsRating | undefined = activeProfile()?.kids;
  const kids = max !== undefined;
  const like = useMemo(() => (on ? likeOf(term) : undefined), [on, term]);
  const understood = understanding.intents.length > 0;
  const askMulti = on && !kids && !understood && (!like || like.type === undefined);
  const multiQuery = useMemo(
    () => (askMulti ? searchService().multi(term) : null),
    [askMulti, term],
  );
  const multiState = useQuery(multiQuery);
  const multi = multiState.data;
  const multiSettled = multiQuery === null || settled(multiState);
  const person = useMemo(
    () => (multi ? personFor(term, multi.people, multi.titles) : undefined),
    [multi, term],
  );
  // A "like" read held until TMDB says whether the words are a title's own name.
  const likeRead = useMemo(() => {
    if (!like || multiQuery === null) return like;
    if (!multiSettled) return undefined;
    return multi && namesTitle(term, multi.titles) ? undefined : like;
  }, [like, multiQuery, multiSettled, multi, term]);
  const remote = useMemo(() => {
    if (!on || like) return NO_ROWS;
    const service = searchService();
    return planRemote(understanding, kids ? { kids: max } : {}).map((row): RemoteRow => ({
      kind: 'discover',
      key: row.key,
      query: service.discover(row.filter),
      row,
    }));
  }, [on, like, understanding, kids, max]);
  const named = useMemo(() => {
    if (!on) return NO_ROWS;
    const rows: RemoteRow[] = [];
    const service = searchService();
    if (person) {
      const role = roleOf(person.department);
      rows.push({
        kind: 'person',
        key: `tmdb-person-${person.id}`,
        query: service.person(person.id, role, false),
        person,
        role,
      });
    }
    if (likeRead) {
      rows.push({
        kind: 'like',
        key: 'tmdb-like',
        query: service.like(likeRead.title, remoteType(likeRead.type), kids),
        like: likeRead,
      });
    } else if (kids && !like && remote.length === 0) {
      // Nothing else asked of TMDB: a kids profile's titles by name, each checked by rating.
      rows.push({ kind: 'titles', key: 'tmdb-titles', query: service.titles(term) });
    }
    return rows.length === 0 ? NO_ROWS : rows;
  }, [on, person, likeRead, like, kids, remote.length, term]);
  return {
    named,
    remote,
    multi: multi ?? undefined,
    multiQuery,
    settled: multiSettled,
  };
}

const kidsRemoteTitles = new WeakMap<readonly RemoteTitle[], Items>();

/**
 * What a TMDB row shows the profile: all of it, or for a kids profile the
 * titles Details would let it play, by genre and by TMDB's UK rating.
 */
export function remoteTitles(answer: RemoteAnswer): Items {
  const max = activeProfile()?.kids;
  if (max === undefined) return answer.titles;
  let kept = kidsRemoteTitles.get(answer.titles);
  if (!kept) {
    kept = answer.titles.filter((title) =>
      kidsDetailsAllowed(
        title,
        title.certificate === undefined ? undefined : { certificate: title.certificate },
        max,
      ),
    );
    kidsRemoteTitles.set(answer.titles, kept);
  }
  return kept;
}

/**
 * A TMDB row's title: "With Tom Hanks", "Films like The Matrix", "Stand-up
 * comedy series", "Korean horror films from the 1990s".
 */
export function remoteTitle(t: TFunction, row: RemoteRow, answer?: RemoteAnswer): string {
  switch (row.kind) {
    case 'person': {
      const name = row.person.name;
      if (row.role === 'cast') return t('search.personCast', { name });
      if (row.role === 'directing') return t('search.personDirecting', { name });
      if (row.role === 'writing') return t('search.personWriting', { name });
      return name;
    }
    case 'like': {
      const found = answer?.like;
      const name = found ? found.name : row.like.title;
      const type = found ? found.type : remoteType(row.like.type);
      if (type === 'movie') return t('search.likeFilms', { name });
      if (type === 'series') return t('search.likeSeries', { name });
      return t('search.like', { name });
    }
    case 'titles':
      return t('search.kidsTitles');
    case 'discover': {
      const { what, inline, newest, year, decade, type } = row.row;
      const films = type === 'movie';
      let name: string;
      if (newest) {
        name = inline
          ? t(films ? 'search.newWhatFilms' : 'search.newWhatSeries', { what: inline })
          : t(films ? 'search.newFilms' : 'search.newSeries');
      } else if (what) {
        name = t(films ? 'search.genreFilms' : 'search.genreSeries', { genre: what });
      } else {
        name = typeLabel(t, type);
      }
      if (year !== undefined) return t('search.fromYear', { row: name, year });
      if (decade !== undefined) return t('search.fromDecade', { row: name, decade });
      return name;
    }
  }
}

/** The type a TMDB row's titles are all of, when they are of one: for the phone's Films and Series chips. */
export function remoteRowType(row: RemoteRow, answer?: RemoteAnswer): RemoteType | undefined {
  if (row.kind === 'discover') return row.row.type;
  if (row.kind === 'like') return answer?.like?.type ?? remoteType(row.like.type);
  return undefined;
}

/**
 * What to offer while the words are typed: recent searches, people and
 * titles TMDB knows by the last searched words, phrases Search understands,
 * and titles in My List.
 */
export function searchSuggestions(
  text: string,
  multi: MultiAnswer | undefined,
  max: number,
): Suggestion[] {
  return suggestions(text, {
    recent: recentSearches.get(),
    known: library.items().map((item) => item.name),
    remote: multi,
    kids: isKidsProfile(),
    max,
  });
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
