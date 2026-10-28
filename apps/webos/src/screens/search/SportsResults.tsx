import { type CatalogSource, eventState, searchEvents, type SportEvent } from '@bannertv/core';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Button } from '../../components/Button';
import { FixtureRow } from '../../components/FixtureRow';
import { addonClient } from '../../data/addons';
import { describeAddonError } from '../../data/describe';
import { eventsFromItems } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { fixtureText } from '../sports/fixture';
import { useMinuteClock, useSportsFeed, useViewOptions, useWantSports } from '../sports/use-sports';
import styles from './SearchScreen.module.css';

const MAX_RESULTS = 40;
export const SPORTS_RESULTS_KEY = 'search-res-sports';
export const SEARCH_SPORTS_BUTTON = 'search-sports-addons';

interface EventRowProps {
  focusKey: string;
  title: string;
  tag?: string;
  events: readonly SportEvent[] | null;
  error?: string;
  onRetry?: () => void;
  onFocusRow: (rowKey: string) => void;
}

function EventRow({ focusKey, title, tag, events, error, onRetry, onFocusRow }: EventRowProps) {
  const { t } = useTranslation();
  const feed = useSportsFeed();
  const now = useMinuteClock();
  const view = useViewOptions(feed.events, now);
  const fixtures = useMemo(
    () =>
      events
        ? events.map((event) =>
            fixtureText(t, event, eventState(event, view), { now: view.now, withDay: true }),
          )
        : null,
    [events, view, t],
  );
  const onItemFocus = useCallback(() => onFocusRow(focusKey), [onFocusRow, focusKey]);
  const onItemPress = useCallback(
    (index: number) => {
      const event = events?.[index];
      if (event) push({ name: 'event', event });
    },
    [events],
  );
  return (
    <FixtureRow
      focusKey={focusKey}
      title={title}
      tag={tag}
      fixtures={fixtures}
      error={error}
      onRetry={onRetry}
      onItemFocus={onItemFocus}
      onItemPress={onItemPress}
    />
  );
}

interface AddonSearchRowProps {
  source: CatalogSource;
  term: string;
  onFocusRow: (rowKey: string) => void;
  onFound: (key: string, count: number) => void;
}

/** One sports addon's own search, read as events. Channels and placeholders drop out. */
const AddonSearchRow = memo(function AddonSearchRow({
  source,
  term,
  onFocusRow,
  onFound,
}: AddonSearchRowProps) {
  const { t } = useTranslation();
  const { addon, catalog } = source;
  const query = useMemo(
    () =>
      addonClient.catalog(addon, catalog.type, catalog.id, [['search', term]], { persist: false }),
    [addon, catalog, term],
  );
  const state = useQuery(query);
  const events = useMemo(
    () => (state.data ? eventsFromItems(addon, catalog, state.data).slice(0, MAX_RESULTS) : null),
    [state.data, addon, catalog],
  );
  const count = state.status === 'error' ? 1 : (events?.length ?? -1);
  useEffect(() => onFound(source.key, count), [onFound, source.key, count]);
  if (count === 0) return null;
  return (
    <EventRow
      focusKey={`${SPORTS_RESULTS_KEY}-${source.key}`}
      title={t('sports.title')}
      tag={addon.manifest.name}
      events={state.status === 'error' ? [] : events}
      error={
        state.status === 'error'
          ? describeAddonError(t, state.error, addon.manifest.name)
          : undefined
      }
      onRetry={() => query.retry()}
      onFocusRow={onFocusRow}
    />
  );
});

interface SportsResultsProps {
  term: string;
  /** Sports addons' own searches, asked only when the viewer asks. */
  sources: readonly CatalogSource[];
  onFocusRow: (rowKey: string) => void;
  /** Whether this group shows anything, so Search can say when nothing at all was found. */
  onContent: (has: boolean) => void;
}

/**
 * The Sports group in Search: matches from BannerTV's own copy of the
 * sports catalogs, by team name and alias (Man Utd, Spurs), live first. The
 * addons' own searches are asked only from "Search sports addons"
 * (docs/PLAN.md, Sports addons, Screens).
 */
export function SportsResults({ term, sources, onFocusRow, onContent }: SportsResultsProps) {
  const { t } = useTranslation();
  // What is live now is enough to search on until Sports has been opened.
  useWantSports('live', true);
  const feed = useSportsFeed();
  const now = useMinuteClock();
  const view = useViewOptions(feed.events, now);
  const found = useMemo(
    () => searchEvents(feed.events, term, view).slice(0, MAX_RESULTS),
    [feed.events, term, view],
  );
  const [asked, setAsked] = useState(false);
  const [addonCounts, setAddonCounts] = useState<Readonly<Record<string, number>>>({});
  const onFound = useCallback((key: string, count: number) => {
    setAddonCounts((current) => (current[key] === count ? current : { ...current, [key]: count }));
  }, []);
  const fromAddons = Object.keys(addonCounts).some((key) => addonCounts[key] !== 0);
  const has = found.length > 0 || sources.length > 0 || fromAddons;
  useEffect(() => onContent(has), [onContent, has]);

  return (
    <>
      {found.length > 0 && (
        <EventRow
          focusKey={SPORTS_RESULTS_KEY}
          title={t('sports.title')}
          events={found}
          onFocusRow={onFocusRow}
        />
      )}
      {sources.length > 0 && !asked && (
        // Not a row (no data-row-key), so spatial navigation measures the button.
        // It sits under the Sports row, so the track stays where that row put it.
        <div className={styles.sportsSearch}>
          {found.length === 0 && <p className={styles.sportsNote}>{t('sports.notInLists')}</p>}
          <Button
            focusKey={SEARCH_SPORTS_BUTTON}
            label={t('sports.searchAddons')}
            onPress={() => setAsked(true)}
          />
        </div>
      )}
      {asked &&
        sources.map((source) => (
          <AddonSearchRow
            key={source.key}
            source={source}
            term={term}
            onFocusRow={onFocusRow}
            onFound={onFound}
          />
        ))}
    </>
  );
}
