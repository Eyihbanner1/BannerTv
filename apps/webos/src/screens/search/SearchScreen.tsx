import {
  type CatalogSource,
  type DiscoverSource,
  discoverSources,
  kidsSearchSources,
  type PlannedRow,
  type Query,
  searchSources,
  type Suggestion,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { Row } from '../../components/Row';
import { slideTrack } from '../../components/row-track';
import { TextField } from '../../components/TextField';
import { addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { isKidsProfile } from '../../data/profiles';
import { loadRecentSearches, recentSearches } from '../../data/search';
import {
  plannedCatalog,
  plannedQuery,
  plannedTitle,
  type RemoteRow,
  remoteTitle,
  remoteTitles,
  type SearchHelp,
  searchHelp,
  searchSuggestions,
  useSmartSearch,
  visibleTitles,
} from '../../data/search-results';
import { sportsState } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { forgetFocus } from '../../navigation/focus-memory';
import { focusedKey } from '../../navigation/spatial';
import { canSlide } from '../../platform/input-mode';
import { openDetails } from '../home/Hero';
import { SportsResults } from './SportsResults';
import { TmdbLogo } from './TmdbLogo';
import styles from './SearchScreen.module.css';

/** Searching starts once typing pauses this long. */
const TYPING_PAUSE_MS = 500;
/** Shorter terms match too much to be useful. */
const MIN_TERM_LENGTH = 2;
const RESULT_PREFIX = 'search-res-';
/** Rows of what the words mean. Not search-res-sports-, which is the Sports group's. */
const PLANNED_PREFIX = `${RESULT_PREFIX}u-`;
/** Rows from TMDB. */
const REMOTE_PREFIX = `${RESULT_PREFIX}t-`;
/** What to search for, offered while typing: kept apart from the results' focus. */
const SUGGEST_PREFIX = 'search-suggest-';
const SUGGEST_SLOT = 'suggest';
/** As many as fit across the TV on one line. */
const MAX_SUGGESTIONS = 4;
// One element for every TMDB row, so a row is not drawn again for a new one.
const TMDB_TAG = <TmdbLogo />;
const TOP_KEY = `${RESULT_PREFIX}top`;
const HELP_PREFIX = `${RESULT_PREFIX}help-`;
const HELP_MEANT = `${HELP_PREFIX}meant`;
const HELP_RETRY = `${HELP_PREFIX}retry`;
const HELP_SLOT = 'help';
const NO_HELP: SearchHelp = { chips: [] };
const NO_SOURCES: readonly CatalogSource[] = [];
const NO_DISCOVER: readonly DiscoverSource[] = [];

export const SEARCH_FIELD = 'search-field';

// Kept for this session, so Back from a title returns to the same results.
const memory = { text: '', term: '', slideRow: undefined as string | undefined };

/** Search opens next on `term`, as if typed: a name from a title's cast, say. */
export function searchFor(term: string): void {
  forgetFocus(RESULT_PREFIX);
  memory.text = term;
  memory.term = termOf(term);
  memory.slideRow = undefined;
}

function termOf(text: string): string {
  const term = text.trim().replace(/\s+/g, ' ');
  return term.length >= MIN_TERM_LENGTH ? term : '';
}

type Items = readonly MetaPreview[];

/** A row about to go while focus is in it says so, before its tiles unregister. */
function useHandOff(focusKey: string, gone: boolean, onGone: (rowKey: string) => void) {
  useLayoutEffect(() => {
    if (gone && focusedKey().indexOf(`${focusKey}-`) === 0) onGone(focusKey);
  }, [gone, focusKey, onGone]);
}

interface ResultRowProps {
  source: CatalogSource;
  query: Query<MetaPreview[]>;
  /** Null while the addon is asked. */
  items: Items | null;
  /** The addon failed with nothing to show: its row says so, with Try again. */
  failed: boolean;
  error: Error | undefined;
  /** Every addon failed: one message says so instead of a row each. */
  hidden: boolean;
  tag: string;
  onGone: (rowKey: string) => void;
  onItemFocus: (rowKey: string) => void;
  onItemPress: (item: MetaPreview) => void;
}

/** One addon's own search results, titled by type and tagged with the addon. */
const ResultRow = memo(function ResultRow({
  source,
  query,
  items,
  failed,
  error,
  hidden,
  tag,
  onGone,
  onItemFocus,
  onItemPress,
}: ResultRowProps) {
  const { t } = useTranslation();
  const { addon, catalog } = source;
  const focusKey = `${RESULT_PREFIX}${source.key}`;
  const gone = hidden || (!failed && items !== null && items.length === 0);
  useHandOff(focusKey, gone, onGone);
  const onFocus = useCallback(() => onItemFocus(focusKey), [onItemFocus, focusKey]);
  const onRetry = useCallback(() => query.retry(), [query]);
  if (gone) return null;
  return (
    <Row
      focusKey={focusKey}
      title={typeLabel(t, catalog.type)}
      tag={tag}
      shape="poster"
      items={failed ? [] : items}
      error={failed ? describeAddonError(t, error, addon.manifest.name) : undefined}
      onRetry={onRetry}
      onItemFocus={onFocus}
      onItemPress={onItemPress}
    />
  );
});

interface PlannedResultRowProps {
  row: PlannedRow;
  /** How many titles the row shows: -1 while it is asked, 0 when it found none or failed. */
  onCount: (key: string, count: number) => void;
  onGone: (rowKey: string) => void;
  onItemFocus: (rowKey: string) => void;
  onItemPress: (item: MetaPreview) => void;
}

/**
 * A row for what the words mean, such as "Comedy films": the catalog Home and
 * Discover ask, so it shares their copy. See all opens it in Discover.
 */
const PlannedResultRow = memo(function PlannedResultRow({
  row,
  onCount,
  onGone,
  onItemFocus,
  onItemPress,
}: PlannedResultRowProps) {
  const { t } = useTranslation();
  const query = useMemo(() => plannedQuery(row), [row]);
  const state = useQuery(query);
  const items = useMemo(
    () => (state.data ? visibleTitles(state.data, row.family) : null),
    [state.data, row.family],
  );
  // It only adds to what the addons found, so it goes quietly when it has nothing.
  const count = items ? items.length : state.status === 'error' ? 0 : -1;
  const focusKey = `${PLANNED_PREFIX}${row.key}`;
  useLayoutEffect(() => onCount(row.key, count), [onCount, row.key, count]);
  useHandOff(focusKey, count === 0, onGone);
  const onFocus = useCallback(() => onItemFocus(focusKey), [onItemFocus, focusKey]);
  const onSeeAll = useCallback(() => push({ name: 'catalog', ...plannedCatalog(row) }), [row]);
  // A kids profile's Discover shows Family catalogs only, so See all would not open
  // this row's genre: a kids profile gets it on Family rows alone.
  const seeAll = !isKidsProfile() || row.family;
  if (count === 0) return null;
  return (
    <Row
      focusKey={focusKey}
      title={plannedTitle(t, row)}
      tag={row.source.addon.manifest.name}
      shape="poster"
      items={items}
      onItemFocus={onFocus}
      onItemPress={onItemPress}
      onSeeAll={seeAll ? onSeeAll : undefined}
    />
  );
});

interface RemoteResultRowProps {
  row: RemoteRow;
  /** How many titles the row shows: -1 while it is asked, 0 when it found none or failed. */
  onCount: (key: string, count: number) => void;
  onGone: (rowKey: string) => void;
  onItemFocus: (rowKey: string) => void;
  onItemPress: (item: MetaPreview) => void;
}

/** The key a TMDB row's count goes under, apart from the planned rows'. */
const remoteCount = (row: RemoteRow) => `t-${row.key}`;

/**
 * A row from TMDB, such as "With Tom Hanks" or "Stand-up comedy films",
 * with TMDB's logo. Its titles are by IMDb id, so they open on Details as
 * any other; a kids profile sees only those within its rating.
 */
const RemoteResultRow = memo(function RemoteResultRow({
  row,
  onCount,
  onGone,
  onItemFocus,
  onItemPress,
}: RemoteResultRowProps) {
  const { t } = useTranslation();
  const state = useQuery(row.query);
  const items = useMemo(() => (state.data ? remoteTitles(state.data) : null), [state.data]);
  // Like a planned row, it only adds to what the addons found: it goes quietly when it has nothing.
  const count = items ? items.length : state.status === 'error' ? 0 : -1;
  const focusKey = `${REMOTE_PREFIX}${row.key}`;
  const countKey = remoteCount(row);
  useLayoutEffect(() => onCount(countKey, count), [onCount, countKey, count]);
  useHandOff(focusKey, count === 0, onGone);
  const onFocus = useCallback(() => onItemFocus(focusKey), [onItemFocus, focusKey]);
  if (count === 0) return null;
  return (
    <Row
      focusKey={focusKey}
      title={remoteTitle(t, row, state.data)}
      tag={TMDB_TAG}
      shape="poster"
      items={items}
      onItemFocus={onFocus}
      onItemPress={onItemPress}
    />
  );
});

interface SuggestionsProps {
  items: readonly Suggestion[];
  onPick: (term: string) => void;
  /** A suggestion took focus: the view goes back to the top, where they are. */
  onFocus: () => void;
}

/** What to search for, while typing: recent searches, people, titles and genres. */
function Suggestions({ items, onPick, onFocus }: SuggestionsProps) {
  const { t } = useTranslation();
  // Each suggestion keeps its focus key as others come in around it (TMDB answers after
  // the phrases), so the one focused stays focused. When it goes, focus takes its place.
  const keys = items.map((item) => item.key).join(' ');
  const before = useRef<readonly string[]>([]);
  useLayoutEffect(() => {
    const previous = before.current;
    const now = keys === '' ? [] : keys.split(' ');
    before.current = now;
    const focused = focusedKey();
    if (focused.indexOf(SUGGEST_PREFIX) !== 0 || now.length === 0) return;
    const key = focused.slice(SUGGEST_PREFIX.length);
    if (now.indexOf(key) !== -1) return;
    const at = Math.min(Math.max(previous.indexOf(key), 0), now.length - 1);
    void setFocus(`${SUGGEST_PREFIX}${now[at]}`);
  }, [keys]);
  if (items.length === 0) return null;
  return (
    <div className={styles.suggestions} role="group" aria-label={t('search.suggestions')}>
      {items.map((item) => (
        <div key={item.key} className={styles.suggestion}>
          <Button
            focusKey={`${SUGGEST_PREFIX}${item.key}`}
            label={item.label}
            onFocus={onFocus}
            onPress={() => onPick(item.query)}
          >
            <span className={styles.suggestionLabel}>{item.label}</span>
          </Button>
        </div>
      ))}
    </div>
  );
}

interface HelpProps {
  /** Every addon failed: only Try again is offered. */
  allFailed: boolean;
  /** Some addons failed: a note says there may be more. */
  someFailed: boolean;
  help: SearchHelp;
  onPick: (term: string) => void;
  onRetry: () => void;
  /** A button took focus: the view goes back to the top, where the help is. */
  onFocus: () => void;
}

/** Under "Nothing found": a likely spelling, genres to look through, or Try again. */
function Help({ allFailed, someFailed, help, onPick, onRetry, onFocus }: HelpProps) {
  const { t } = useTranslation();
  if (allFailed) {
    return (
      <div className={styles.help}>
        <Button
          focusKey={HELP_RETRY}
          label={t('common.tryAgain')}
          onFocus={onFocus}
          onPress={onRetry}
        />
      </div>
    );
  }
  const meant = help.didYouMean;
  return (
    <div className={styles.help}>
      {someFailed && <p className={styles.helpNote}>{t('search.someNoAnswer')}</p>}
      {meant !== undefined && (
        <div className={styles.helpLine}>
          <Button
            focusKey={HELP_MEANT}
            label={t('search.didYouMean', { term: meant })}
            onFocus={onFocus}
            onPress={() => onPick(meant)}
          />
        </div>
      )}
      {help.chips.length > 0 && (
        <>
          <h2 className={styles.heading}>{t('search.tryGenres')}</h2>
          {help.chips.map((chip, index) => (
            <div key={chip.label} className={styles.chip}>
              <Button
                focusKey={`${HELP_PREFIX}genre-${index}`}
                label={chip.label}
                onFocus={onFocus}
                onPress={() => onPick(chip.query)}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** The help's first button, which focus goes to when it is all there is. */
function firstHelpKey(allFailed: boolean, help: SearchHelp | undefined): string | undefined {
  if (allFailed) return HELP_RETRY;
  if (!help) return undefined;
  if (help.didYouMean !== undefined) return HELP_MEANT;
  return help.chips.length > 0 ? `${HELP_PREFIX}genre-0` : undefined;
}

interface ResultsProps {
  term: string;
  /** The words as typed so far, which suggestions follow before they are searched. */
  text: string;
  sources: readonly CatalogSource[];
  /** Catalogs that can answer what the words mean. */
  discover: readonly DiscoverSource[];
  /** With sport installed: the Sports group's searches, or null without sport. */
  sportsSources: readonly CatalogSource[] | null;
  /** A spelling or genre from the help: search for it instead. */
  onPick: (term: string) => void;
}

/**
 * Search results, top to bottom: Sports, suggestions, TMDB's rows for who or
 * what the words name ("With Tom Hanks"), Top results across the addons,
 * rows for what the words mean ("Stand-up comedy films", "Comedy films"),
 * then each addon's own results. When the words were read only by forgiving
 * a typo, the addons' rows come before the understood ones.
 */
function Results({ term, text, sources, discover, sportsSources, onPick }: ResultsProps) {
  const { t } = useTranslation();
  const smart = useSmartSearch(term, sources, discover);
  const { named, remote, multiQuery, planned, plannedLast, queries, states, results, failed, top } =
    smart;
  const suggestions = useMemo(
    () => searchSuggestions(text, smart.multi, MAX_SUGGESTIONS),
    [text, smart.multi],
  );
  const firstSuggestion = suggestions[0]?.key;
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const [sportsContent, setSportsContent] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  // A row that went while focused, to hand focus on from once the rows have drawn again.
  const handOff = useRef<string | undefined>(undefined);

  // Two catalogs of one addon and type need the catalog name to tell them apart.
  const tags = useMemo(
    () =>
      sources.map((source) => {
        const twin = sources.some(
          (other) =>
            other !== source &&
            other.addon === source.addon &&
            other.catalog.type === source.catalog.type,
        );
        const addon = source.addon.manifest.name;
        return twin ? `${addon} · ${source.catalog.name}` : addon;
      }),
    [sources],
  );

  const plannedEmpty =
    planned.every((row) => counts[row.key] === 0) &&
    named.every((row) => counts[remoteCount(row)] === 0) &&
    remote.every((row) => counts[remoteCount(row)] === 0);
  // Every addon failed, and TMDB has nothing either: only Try again is offered.
  const allFailed =
    sources.length > 0 && smart.settled && failed.every(Boolean) && plannedEmpty && !sportsContent;
  const someFailed = failed.some(Boolean);
  const nothing =
    !allFailed &&
    smart.settled &&
    results.every((items) => items !== null && items.length === 0) &&
    plannedEmpty &&
    !sportsContent;
  const help = useMemo(
    () => (nothing ? searchHelp(term, discover) : undefined),
    [nothing, term, discover],
  );
  const helpKey = nothing || allFailed ? firstHelpKey(allFailed, help) : undefined;

  // Every place focus can be in the track, in order, and whether it is drawn now.
  const slots = useMemo(() => {
    const fromTmdb = (row: RemoteRow) => {
      const key = `${REMOTE_PREFIX}${row.key}`;
      return { key, focus: key, drawn: counts[remoteCount(row)] !== 0 };
    };
    const list: { key: string; focus: string; drawn: boolean }[] = [
      {
        key: SUGGEST_SLOT,
        focus: firstSuggestion === undefined ? '' : `${SUGGEST_PREFIX}${firstSuggestion}`,
        drawn: firstSuggestion !== undefined,
      },
      { key: HELP_SLOT, focus: helpKey ?? '', drawn: helpKey !== undefined },
      ...named.map(fromTmdb),
      { key: TOP_KEY, focus: TOP_KEY, drawn: top.status === 'shown' },
    ];
    const understood = remote.map(fromTmdb).concat(
      planned.map((row) => {
        const key = `${PLANNED_PREFIX}${row.key}`;
        return { key, focus: key, drawn: counts[row.key] !== 0 };
      }),
    );
    const addons = sources.map((source, index) => {
      const key = `${RESULT_PREFIX}${source.key}`;
      const items = results[index] ?? null;
      const drawn = !allFailed && (failed[index] === true || items === null || items.length > 0);
      return { key, focus: key, drawn };
    });
    return list.concat(plannedLast ? addons.concat(understood) : understood.concat(addons));
  }, [
    firstSuggestion,
    helpKey,
    named,
    top.status,
    remote,
    planned,
    plannedLast,
    counts,
    sources,
    results,
    failed,
    allFailed,
  ]);
  const latest = useRef(slots);
  const drawnRows = slots
    .filter((slot) => slot.drawn)
    .map((slot) => slot.key)
    .join(' ');

  useLayoutEffect(() => {
    latest.current = slots;
    const from = handOff.current;
    if (from === undefined) return;
    handOff.current = undefined;
    // The next place drawn after the one that went, else the one before it, else the box.
    const at = slots.findIndex((slot) => slot.key === from);
    const drawn = (slot: { drawn: boolean }) => slot.drawn;
    const next =
      slots.slice(at + 1).find(drawn) ?? slots.slice(0, Math.max(0, at)).reverse().find(drawn);
    void setFocus(next ? next.focus : SEARCH_FIELD);
  });
  // Rows coming and going above the focused one move it: the view goes back to it.
  useLayoutEffect(() => slideTrack(trackRef.current, memory.slideRow), [drawnRows]);
  // The Sports group above the other rows grows and shrinks by itself, as its
  // rows come and go: the view goes back to the row it was on.
  const onSportsLayout = useCallback(() => slideTrack(trackRef.current, memory.slideRow), []);
  // Focus leaving the Sports group goes to the first place under it, or the box.
  const onSportsLeave = useCallback(() => {
    const below = latest.current.find((slot) => slot.drawn);
    void setFocus(below ? below.focus : SEARCH_FIELD);
  }, []);

  const onCount = useCallback((key: string, count: number) => {
    setCounts((previous) => (previous[key] === count ? previous : { ...previous, [key]: count }));
  }, []);
  const onGone = useCallback((rowKey: string) => {
    handOff.current = rowKey;
  }, []);
  const onItemFocus = useCallback((rowKey: string) => {
    if (!canSlide()) return;
    memory.slideRow = rowKey;
    slideTrack(trackRef.current, rowKey);
  }, []);
  const onTopFocus = useCallback(() => onItemFocus(TOP_KEY), [onItemFocus]);
  const onHelpFocus = useCallback(() => {
    if (!canSlide()) return;
    memory.slideRow = undefined;
    slideTrack(trackRef.current, undefined);
  }, []);
  const onItemPress = useCallback(
    (item: MetaPreview) => {
      recentSearches.add(term);
      openDetails(item);
    },
    [term],
  );
  const onRetry = useCallback(() => {
    // The rows come back as they are asked again: focus goes to the first of them.
    handOff.current = HELP_SLOT;
    queries.forEach((query, index) => {
      if (states[index]?.status === 'error') query.retry();
    });
    for (const row of planned) {
      const query = plannedQuery(row);
      if (query.get().status === 'error') query.retry();
    }
    for (const row of named.concat(remote)) {
      if (row.query.get().status === 'error') row.query.retry();
    }
    if (multiQuery?.get().status === 'error') multiQuery.retry();
  }, [queries, states, planned, named, remote, multiQuery]);

  const tmdbRow = (row: RemoteRow) => (
    <RemoteResultRow
      key={`t-${row.key}`}
      row={row}
      onCount={onCount}
      onGone={onGone}
      onItemFocus={onItemFocus}
      onItemPress={onItemPress}
    />
  );
  const plannedRows = remote
    .map(tmdbRow)
    .concat(
      planned.map((row) => (
        <PlannedResultRow
          key={`u-${row.key}`}
          row={row}
          onCount={onCount}
          onGone={onGone}
          onItemFocus={onItemFocus}
          onItemPress={onItemPress}
        />
      )),
    );
  const addonRows = sources.map((source, index) => (
    <ResultRow
      key={source.key}
      source={source}
      query={queries[index]!}
      items={results[index] ?? null}
      failed={failed[index] === true}
      error={states[index]?.error}
      hidden={allFailed}
      tag={tags[index]!}
      onGone={onGone}
      onItemFocus={onItemFocus}
      onItemPress={onItemPress}
    />
  ));

  return (
    <div className={styles.results}>
      {allFailed && <p className={styles.message}>{t('search.noAnswer')}</p>}
      {nothing && <p className={styles.message}>{t('search.nothingFound', { term })}</p>}
      <div ref={trackRef} className={styles.track}>
        {sportsSources && (
          <SportsResults
            term={term}
            sources={sportsSources}
            onFocusRow={onItemFocus}
            onContent={setSportsContent}
            onLayout={onSportsLayout}
            onLeave={onSportsLeave}
          />
        )}
        <Suggestions items={suggestions} onPick={onPick} onFocus={onHelpFocus} />
        {allFailed ? (
          <Help
            allFailed
            someFailed
            help={NO_HELP}
            onPick={onPick}
            onRetry={onRetry}
            onFocus={onHelpFocus}
          />
        ) : nothing && help !== undefined ? (
          <Help
            allFailed={false}
            someFailed={someFailed}
            help={help}
            onPick={onPick}
            onRetry={onRetry}
            onFocus={onHelpFocus}
          />
        ) : null}
        {named.map(tmdbRow)}
        {top.status === 'shown' && (
          <Row
            focusKey={TOP_KEY}
            title={t('search.topResults')}
            shape="poster"
            items={top.items}
            onItemFocus={onTopFocus}
            onItemPress={onItemPress}
          />
        )}
        {plannedLast ? addonRows : plannedRows}
        {plannedLast ? plannedRows : addonRows}
      </div>
    </div>
  );
}

function RecentSearches({ onPick }: { onPick: (term: string) => void }) {
  const { t } = useTranslation();
  const terms = useSyncExternalStore(recentSearches.subscribe, recentSearches.get);
  if (terms.length === 0) return <p className={styles.message}>{t('search.hint')}</p>;
  return (
    <div className={styles.recent}>
      <h2 className={styles.heading}>{t('search.recent')}</h2>
      {terms.map((term, index) => (
        <div key={term} className={styles.chip}>
          <Button focusKey={`search-recent-${index}`} label={term} onPress={() => onPick(term)} />
        </div>
      ))}
      <div className={styles.clear}>
        <Button
          focusKey="search-recent-clear"
          label={t('search.clearRecent')}
          onPress={() => {
            recentSearches.clear();
            void setFocus(SEARCH_FIELD);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Search across every addon that can search, and what the words mean: a
 * genre, a mood, a year or a catalog's name. Results update as typing pauses.
 */
export function SearchScreen() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  // Once sport is settled too, so a sports addon's search is never asked for
  // the moment before it is known to be one.
  const ready = collection.ready && sports.ready;
  // Sports catalogs leave the fan-out: Search answers for them from its own copy.
  const sources = useMemo(() => {
    if (!ready) return NO_SOURCES;
    const all = searchSources(collection.addons, sports.searchLeaveOut);
    return isKidsProfile() ? kidsSearchSources(all) : all;
  }, [ready, collection.addons, sports.searchLeaveOut]);
  // A kids profile has no Sports, so no Sports group either.
  const sportsSources = useMemo(() => {
    const leaveOut = sports.searchLeaveOut;
    if (!ready || !sports.shown || !leaveOut || isKidsProfile()) return null;
    return searchSources(collection.addons).filter((source) =>
      leaveOut(source.addon, source.catalog),
    );
  }, [ready, collection.addons, sports.shown, sports.searchLeaveOut]);
  // What the words can be answered from: the catalogs Discover browses, less sport's.
  const discover = useMemo(() => {
    if (!ready) return NO_DISCOVER;
    const leaveOut = sports.homeLeaveOut;
    return discoverSources(collection.addons).filter(
      (source) => !leaveOut?.(source.addon, source.catalog),
    );
  }, [ready, collection.addons, sports.homeLeaveOut]);
  const [text, setText] = useState(memory.text);
  const [term, setTerm] = useState(memory.term);

  useScreenFocus(SEARCH_FIELD);
  useEffect(loadRecentSearches, []);

  const search = useCallback((next: string) => {
    if (next === memory.term) return;
    // Rows keep the same focus keys from one term to the next: start them afresh.
    forgetFocus(RESULT_PREFIX);
    memory.term = next;
    memory.slideRow = undefined;
    setTerm(next);
  }, []);

  useEffect(() => {
    memory.text = text;
    const timer = setTimeout(() => search(termOf(text)), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, search]);

  // A recent search, a spelling or a genre: it goes in the box and is searched at once.
  const pick = useCallback(
    (picked: string) => {
      // The box is the natural place to continue from. Focus moves there before
      // the button pressed goes with the old results: otherwise spatial
      // navigation puts focus back on the screen a moment later, mid-typing.
      void Promise.resolve(setFocus(SEARCH_FIELD)).then(() => {
        setText(picked);
        search(termOf(picked));
      });
    },
    [search],
  );

  let body;
  if (ready && sources.length === 0 && !sportsSources) {
    body = <p className={styles.message}>{t('search.noAddons')}</p>;
  } else if (term === '') {
    body = <RecentSearches onPick={pick} />;
  } else if (ready) {
    body = (
      <Results
        key={term}
        term={term}
        text={text}
        sources={sources}
        discover={discover}
        sportsSources={sportsSources}
        onPick={pick}
      />
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('rail.search')}</h1>
        <div className={styles.field}>
          <TextField
            focusKey={SEARCH_FIELD}
            label={t('search.label')}
            placeholder={t('search.placeholder')}
            value={text}
            onChange={setText}
            onSubmit={() => {
              const next = termOf(text);
              search(next);
              if (next !== '') recentSearches.add(next);
            }}
          />
        </div>
      </div>
      {body}
    </div>
  );
}
