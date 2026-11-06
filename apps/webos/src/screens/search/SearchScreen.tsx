import {
  type CatalogSource,
  type DiscoverSource,
  discoverSources,
  kidsSearchSources,
  type PlannedRow,
  type Query,
  searchSources,
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
  type SearchHelp,
  searchHelp,
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
import styles from './SearchScreen.module.css';

/** Searching starts once typing pauses this long. */
const TYPING_PAUSE_MS = 500;
/** Shorter terms match too much to be useful. */
const MIN_TERM_LENGTH = 2;
const RESULT_PREFIX = 'search-res-';
/** Rows of what the words mean. Not search-res-sports-, which is the Sports group's. */
const PLANNED_PREFIX = `${RESULT_PREFIX}u-`;
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

interface HelpProps {
  /** Every addon failed: only Try again is offered. */
  allFailed: boolean;
  /** Some addons failed: a note says there may be more. */
  someFailed: boolean;
  help: SearchHelp;
  onPick: (term: string) => void;
  onRetry: () => void;
}

/** Under "Nothing found": a likely spelling, genres to look through, or Try again. */
function Help({ allFailed, someFailed, help, onPick, onRetry }: HelpProps) {
  const { t } = useTranslation();
  if (allFailed) {
    return (
      <div className={styles.help}>
        <Button focusKey={HELP_RETRY} label={t('common.tryAgain')} onPress={onRetry} />
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
  sources: readonly CatalogSource[];
  /** Catalogs that can answer what the words mean. */
  discover: readonly DiscoverSource[];
  /** With sport installed: the Sports group's searches, or null without sport. */
  sportsSources: readonly CatalogSource[] | null;
  /** A spelling or genre from the help: search for it instead. */
  onPick: (term: string) => void;
}

/**
 * Search results, top to bottom: Sports, Top results across the addons, rows
 * for what the words mean ("Comedy films"), then each addon's own results.
 */
function Results({ term, sources, discover, sportsSources, onPick }: ResultsProps) {
  const { t } = useTranslation();
  const smart = useSmartSearch(term, sources, discover);
  const { planned, queries, states, results, failed, top } = smart;
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

  const plannedEmpty = planned.every((row) => counts[row.key] === 0);
  const allFailed = sources.length > 0 && failed.every(Boolean) && plannedEmpty && !sportsContent;
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
    const list: { key: string; focus: string; drawn: boolean }[] = [
      { key: HELP_SLOT, focus: helpKey ?? '', drawn: helpKey !== undefined },
      { key: TOP_KEY, focus: TOP_KEY, drawn: top.status === 'shown' },
    ];
    for (const row of planned) {
      const key = `${PLANNED_PREFIX}${row.key}`;
      list.push({ key, focus: key, drawn: counts[row.key] !== 0 });
    }
    sources.forEach((source, index) => {
      const key = `${RESULT_PREFIX}${source.key}`;
      const items = results[index] ?? null;
      const drawn = !allFailed && (failed[index] === true || items === null || items.length > 0);
      list.push({ key, focus: key, drawn });
    });
    return list;
  }, [helpKey, top.status, planned, counts, sources, results, failed, allFailed]);
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
  }, [queries, states, planned]);

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
        {allFailed ? (
          <Help allFailed someFailed help={NO_HELP} onPick={onPick} onRetry={onRetry} />
        ) : nothing && help !== undefined ? (
          <Help
            allFailed={false}
            someFailed={someFailed}
            help={help}
            onPick={onPick}
            onRetry={onRetry}
          />
        ) : null}
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
        {planned.map((row) => (
          <PlannedResultRow
            key={row.key}
            row={row}
            onCount={onCount}
            onGone={onGone}
            onItemFocus={onItemFocus}
            onItemPress={onItemPress}
          />
        ))}
        {sources.map((source, index) => (
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
        ))}
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
