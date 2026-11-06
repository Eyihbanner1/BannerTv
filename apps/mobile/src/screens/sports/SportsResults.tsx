import {
  type CatalogSource,
  eventState,
  searchEvents,
  type SportEvent,
  type ViewOptions,
} from '@bannertv/core';
import { addonClient } from '@tv/data/addons';
import { describeAddonError } from '@tv/data/describe';
import { eventsFromItems } from '@tv/data/sports';
import { useQuery } from '@tv/data/use-query';
import { fixtureText } from '@tv/screens/sports/fixture';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { openEvent } from '../../nav/routes';
import { Button } from '../../ui/Button';
import { FixtureRow } from '../../ui/FixtureRow';
import { colors, gutter, space, type } from '../../ui/theme';
import { useMinuteClock, useOnShow, useSportsFeed, useViewOptions } from './use-sports';

const MAX_RESULTS = 40;

/** A row of matches, with a LIVE pill or kick-off and its day; tapping one opens its page. */
const EventRow = memo(function EventRow({
  title,
  tag,
  events,
  view,
  footer,
}: {
  title: string;
  tag?: string;
  events: readonly SportEvent[] | null;
  view: ViewOptions;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const fixtures = useMemo(
    () =>
      events
        ? events.map((event) =>
            fixtureText(t, event, eventState(event, view), { now: view.now, withDay: true }),
          )
        : null,
    [events, view, t],
  );
  return (
    <FixtureRow
      title={title}
      {...(tag ? { tag } : {})}
      fixtures={fixtures}
      onPress={(index) => {
        const event = events?.[index];
        if (event) openEvent(event);
      }}
      footer={footer}
    />
  );
});

/** One sports addon's own search, read as events. Channels and placeholders drop out. */
const AddonSearchRow = memo(function AddonSearchRow({
  source,
  term,
  view,
  onFound,
}: {
  source: CatalogSource;
  term: string;
  view: ViewOptions;
  /** How many matches the addon found; 0 while it is asked or when it failed. */
  onFound: (key: string, count: number) => void;
}) {
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
  const count = events?.length ?? 0;
  useEffect(() => onFound(source.key, count), [onFound, source.key, count]);
  const failed = state.status === 'error' && !events;
  if (events && events.length === 0) return null;
  return (
    <EventRow
      title={t('sports.title')}
      tag={addon.manifest.name}
      events={events}
      view={view}
      footer={
        failed ? (
          <View style={styles.error}>
            <Text style={styles.muted}>
              {describeAddonError(t, state.error, addon.manifest.name)}
            </Text>
            <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
          </View>
        ) : undefined
      }
    />
  );
});

/**
 * Search's Sports group, as the TV's: matches from BannerTV's own copy of the sports
 * catalogs, by team name and alias (Man Utd, Spurs), live first. It asks nothing itself: the
 * copy is what Sports and Home's Live sport row have fetched. The addons' own searches are
 * asked only from "Search sports addons".
 */
export function SportsResults({
  term,
  sources,
  onContent,
}: {
  term: string;
  /** The sports addons' own searches, asked only when the viewer asks. */
  sources: readonly CatalogSource[];
  /** Whether the group found any match, so Search knows when nothing at all was found. */
  onContent: (found: boolean) => void;
}) {
  const { t } = useTranslation();
  const feed = useSportsFeed();
  const onShow = useOnShow();
  const now = useMinuteClock(onShow);
  const view = useViewOptions(feed.events, now);
  const found = useMemo(
    () => searchEvents(feed.events, term, view).slice(0, MAX_RESULTS),
    [feed.events, term, view],
  );
  const [asked, setAsked] = useState(false);
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const onFound = useCallback((key: string, count: number) => {
    setCounts((current) => (current[key] === count ? current : { ...current, [key]: count }));
  }, []);
  const fromAddons = Object.keys(counts).some((key) => (counts[key] ?? 0) > 0);
  const has = found.length > 0 || fromAddons;
  useEffect(() => onContent(has), [onContent, has]);

  return (
    <View>
      {found.length > 0 ? <EventRow title={t('sports.title')} events={found} view={view} /> : null}
      {sources.length > 0 && !asked ? (
        <View style={styles.ask}>
          {found.length === 0 ? <Text style={styles.muted}>{t('sports.notInLists')}</Text> : null}
          <Button label={t('sports.searchAddons')} onPress={() => setAsked(true)} />
        </View>
      ) : null}
      {asked
        ? sources.map((source) => (
            <AddonSearchRow
              key={source.key}
              source={source}
              term={term}
              view={view}
              onFound={onFound}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ask: { paddingHorizontal: gutter, paddingTop: space.l, gap: space.s, alignItems: 'flex-start' },
  error: { paddingHorizontal: space.l, gap: space.s, alignItems: 'flex-start' },
  muted: { ...type.body, color: colors.textMuted },
});
