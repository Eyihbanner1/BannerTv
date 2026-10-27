import { type CatalogSource, searchSources } from '@bannertv/core';
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
import { loadRecentSearches, recentSearches } from '../../data/search';
import { useQuery } from '../../data/use-query';
import { forgetFocus } from '../../navigation/focus-memory';
import { canSlide } from '../../platform/input-mode';
import { openDetails } from '../home/Hero';
import styles from './SearchScreen.module.css';

/** Searching starts once typing pauses this long. */
const TYPING_PAUSE_MS = 500;
/** Shorter terms match too much to be useful. */
const MIN_TERM_LENGTH = 2;
const RESULT_PREFIX = 'search-res-';

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
  const empty = state.status === 'success' && state.data !== undefined && state.data.length === 0;
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
      items={state.status === 'error' ? [] : (state.data ?? null)}
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

function Results({ term, sources }: { term: string; sources: readonly CatalogSource[] }) {
  const { t } = useTranslation();
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set());
  const trackRef = useRef<HTMLDivElement>(null);

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

  if (sources.every((source) => empty.has(source.key))) {
    return <p className={styles.message}>{t('search.nothingFound', { term })}</p>;
  }
  return (
    <div className={styles.results}>
      <div ref={trackRef} className={styles.track}>
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
  const sources = useMemo(() => searchSources(collection.addons), [collection.addons]);
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
  if (collection.ready && sources.length === 0) {
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
  } else {
    body = <Results key={term} term={term} sources={sources} />;
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
