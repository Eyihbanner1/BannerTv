import {
  type CatalogSource,
  kidsSearchSources,
  kidsTitleAllowed,
  searchSources,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { Row } from '../../components/Row';
import { slideTrack } from '../../components/row-track';
import { TextField } from '../../components/TextField';
import { addonClient, addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { isKidsProfile } from '../../data/profiles';
import { loadRecentSearches, recentSearches } from '../../data/search';
import { sportsState } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { forgetFocus } from '../../navigation/focus-memory';
import { canSlide } from '../../platform/input-mode';
import { openDetails } from '../home/Hero';
import { SportsResults } from './SportsResults';
import styles from './SearchScreen.module.css';

/** Searching starts once typing pauses this long. */
const TYPING_PAUSE_MS = 500;
/** Shorter terms match too much to be useful. */
const MIN_TERM_LENGTH = 2;
const RESULT_PREFIX = 'search-res-';
const NO_SOURCES: readonly CatalogSource[] = [];

export const SEARCH_FIELD = 'search-field';

// Kept for this session, so Back from a title returns to the same results.
const memory = { text: '', term: '', slideRow: undefined as string | undefined };

function termOf(text: string): string {
  const term = text.trim().replace(/\s+/g, ' ');
  return term.length >= MIN_TERM_LENGTH ? term : '';
}

interface ResultRowProps {
  source: CatalogSource;
  term: string;
  tag: string;
  onEmpty: (key: string) => void;
  onItemFocus: (rowKey: string) => void;
  onItemPress: (item: MetaPreview) => void;
}

function ResultRow({ source, term, tag, onEmpty, onItemFocus, onItemPress }: ResultRowProps) {
  const { t } = useTranslation();
  const { addon, catalog } = source;
  const query = useMemo(
    () =>
      addonClient.catalog(addon, catalog.type, catalog.id, [['search', term]], { persist: false }),
    [addon, catalog, term],
  );
  const state = useQuery(query);
  // A kids profile sees only results that name themselves as for children.
  const items = useMemo(
    () =>
      state.data && isKidsProfile()
        ? state.data.filter((item) => kidsTitleAllowed(item))
        : state.data,
    [state.data],
  );
  const empty = state.status === 'success' && items !== undefined && items.length === 0;
  const focusKey = `${RESULT_PREFIX}${source.key}`;

  useEffect(() => {
    if (empty) onEmpty(source.key);
  }, [empty, onEmpty, source.key]);

  if (empty) return null;
  return (
    <Row
      focusKey={focusKey}
      title={typeLabel(t, catalog.type)}
      tag={tag}
      shape="poster"
      items={state.status === 'error' ? [] : (items ?? null)}
      error={
        state.status === 'error'
          ? describeAddonError(t, state.error, addon.manifest.name)
          : undefined
      }
      onRetry={() => query.retry()}
      onItemFocus={() => onItemFocus(focusKey)}
      onItemPress={onItemPress}
    />
  );
}

interface ResultsProps {
  term: string;
  sources: readonly CatalogSource[];
  /** With sport installed: the Sports group's searches, or null without sport. */
  sportsSources: readonly CatalogSource[] | null;
}

function Results({ term, sources, sportsSources }: ResultsProps) {
  const { t } = useTranslation();
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set());
  const [sportsContent, setSportsContent] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ sources, empty });
  useLayoutEffect(() => {
    latest.current = { sources, empty };
  });

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

  useLayoutEffect(() => slideTrack(trackRef.current, memory.slideRow), [empty]);
  // The Sports group above the other rows grows and shrinks by itself, as its
  // rows come and go: the view goes back to the row it was on.
  const onSportsLayout = useCallback(() => slideTrack(trackRef.current, memory.slideRow), []);
  // Focus leaving the Sports group goes to the first row under it, or the box.
  const onSportsLeave = useCallback(() => {
    const { sources: list, empty: none } = latest.current;
    const below = list.find((source) => !none.has(source.key));
    void setFocus(below ? `${RESULT_PREFIX}${below.key}` : SEARCH_FIELD);
  }, []);

  const onEmpty = useCallback((key: string) => {
    setEmpty((previous) => new Set(previous).add(key));
  }, []);
  const onItemFocus = useCallback((rowKey: string) => {
    if (!canSlide()) return;
    memory.slideRow = rowKey;
    slideTrack(trackRef.current, rowKey);
  }, []);
  const onItemPress = useCallback(
    (item: MetaPreview) => {
      recentSearches.add(term);
      openDetails(item);
    },
    [term],
  );

  const nothing = sources.every((source) => empty.has(source.key)) && !sportsContent;
  return (
    <div className={styles.results}>
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
        {sources.map((source, index) => (
          <ResultRow
            key={source.key}
            source={source}
            term={term}
            tag={tags[index]!}
            onEmpty={onEmpty}
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
 * Search across every addon that can search. Results come as rows grouped by
 * type, then addon, and update as typing pauses.
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

  let body;
  if (ready && sources.length === 0 && !sportsSources) {
    body = <p className={styles.message}>{t('search.noAddons')}</p>;
  } else if (term === '') {
    body = (
      <RecentSearches
        onPick={(picked) => {
          setText(picked);
          search(termOf(picked));
          // The list goes away with a term; the box is the natural place to continue from.
          void setFocus(SEARCH_FIELD);
        }}
      />
    );
  } else if (ready) {
    body = <Results key={term} term={term} sources={sources} sportsSources={sportsSources} />;
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
