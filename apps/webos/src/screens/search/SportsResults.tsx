import { type CatalogSource, eventState, searchEvents, type SportEvent } from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Button } from '../../components/Button';
import { FixtureRow } from '../../components/FixtureRow';
import { addonClient } from '../../data/addons';
import { describeAddonError } from '../../data/describe';
import { eventsFromItems } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { focusedKey } from '../../navigation/spatial';
import { fixtureText } from '../sports/fixture';
import { useMinuteClock, useSportsFeed, useViewOptions } from '../sports/use-sports';
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

const addonRowKey = (source: CatalogSource) => `${SPORTS_RESULTS_KEY}-${source.key}`;

interface AddonSearchRowProps {
  source: CatalogSource;
  term: string;
  onFocusRow: (rowKey: string) => void;
  /**
   * How many events the addon found, -1 while it is asked. `focused` if focus
   * was in the row as it went, with nothing found.
   */
  onFound: (key: string, count: number, focused: boolean) => void;
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
  const focusKey = addonRowKey(source);
  // Before the tiles unregister, while focus is still on one of them.
  useLayoutEffect(() => {
    onFound(source.key, count, count === 0 && focusedKey().indexOf(`${focusKey}-tile-`) === 0);
  }, [onFound, source.key, focusKey, count]);
  if (count === 0) return null;
  return (
    <EventRow
      focusKey={focusKey}
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
  /** Whether this group found any match, so Search can say when nothing at all was found. */
  onContent: (has: boolean) => void;
  /** A row of the group came or went, so the rows under it have moved. */
  onLayout: () => void;
  /** Focus leaves the group, which has no row left to hold it: the rows under it take it. */
  onLeave: () => void;
}

/**
 * The Sports group in Search: matches from BannerTV's own copy of the
 * sports catalogs, by team name and alias (Man Utd, Spurs), live first. It
 * asks nothing itself: the copy is what the Sports screen and the Live sport
 * row have fetched (docs/PLAN.md, Fetching and paging). The addons' own
 * searches are asked only from "Search sports addons" (docs/PLAN.md, Sports
 * addons, Screens).
 */
export function SportsResults({
  term,
  sources,
  onFocusRow,
  onContent,
  onLayout,
  onLeave,
}: SportsResultsProps) {
  const { t } = useTranslation();
  const feed = useSportsFeed();
  const now = useMinuteClock();
  const view = useViewOptions(feed.events, now);
  const found = useMemo(
    () => searchEvents(feed.events, term, view).slice(0, MAX_RESULTS),
    [feed.events, term, view],
  );
  const [asked, setAsked] = useState(false);
  const [addonCounts, setAddonCounts] = useState<Readonly<Record<string, number>>>({});
  // The same, at once, for handing focus on before the group draws again.
  const counts = useRef<Record<string, number>>({});
  const latest = useRef({ sources, found: found.length > 0, onLeave });
  useLayoutEffect(() => {
    latest.current = { sources, found: found.length > 0, onLeave };
  });

  // Focus that leaves an addon row with nothing in it, or the button, goes to
  // the next addon row drawn, the one before, the Sports row, then below.
  const handOff = useCallback((from: number) => {
    const { sources: list, found: local, onLeave: leave } = latest.current;
    const drawn = (source: CatalogSource) => counts.current[source.key] !== 0;
    const next =
      list.slice(from + 1).find(drawn) ?? list.slice(0, Math.max(0, from)).reverse().find(drawn);
    if (next) void setFocus(addonRowKey(next));
    else if (local) void setFocus(SPORTS_RESULTS_KEY);
    else leave();
  }, []);
  const onFound = useCallback(
    (key: string, count: number, focused: boolean) => {
      counts.current[key] = count;
      setAddonCounts((current) =>
        current[key] === count ? current : { ...current, [key]: count },
      );
      if (focused) handOff(latest.current.sources.findIndex((source) => source.key === key));
    },
    [handOff],
  );
  // The button goes as the addons' rows come: focus goes to the first of them,
  // rather than back to the search box. Their rows have counted by now.
  useEffect(() => {
    if (asked) handOff(-1);
  }, [asked, handOff]);

  // Only the addons asked now: a count left from one that went says nothing.
  const fromAddons =
    asked &&
    sources.some(
      (source) => addonCounts[source.key] !== undefined && addonCounts[source.key] !== 0,
    );
  // Matches only: the button alone is not something found, so Nothing found still helps.
  const has = found.length > 0 || fromAddons;
  useEffect(() => onContent(has), [onContent, has]);
  const none = found.length === 0;
  const addonRows = asked ? sources.filter((source) => addonCounts[source.key] !== 0).length : 0;
  useLayoutEffect(() => onLayout(), [onLayout, none, asked, addonRows]);

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
