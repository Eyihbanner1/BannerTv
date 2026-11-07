import { buildDay, dayStrip, eventState, type SportsDay, type SportsGroup } from '@bannertv/core';
import { sportsFeed, sportsState } from '@tv/data/sports';
import { fixtureText, groupTitle, stripLabel } from '@tv/screens/sports/fixture';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openEvent } from '../../nav/routes';
import { Button } from '../../ui/Button';
import { FixtureRow } from '../../ui/FixtureRow';
import { Message } from '../../ui/Message';
import { colors, radius, space, type } from '../../ui/theme';
import { usePullRefresh } from '../../ui/use-pull-refresh';
import {
  useMinuteClock,
  useOnShow,
  useSportsFeed,
  useViewOptions,
  useWantSports,
} from './use-sports';

const TODAY_INDEX = 1;

// Kept for the run, so coming back to Sports finds the day it was on.
const memory = { day: undefined as SportsDay | undefined };

/** Resolves once the feed has nothing loading; a refresh starts loading at once if it will. */
function feedSettled(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (sportsFeed.get().loading) return;
      stop();
      resolve();
    };
    const stop = sportsFeed.subscribe(check);
    check();
  });
}

const GroupRow = memo(function GroupRow({
  group,
  view,
}: {
  group: SportsGroup;
  view: ReturnType<typeof useViewOptions>;
}) {
  const { t } = useTranslation();
  const fixtures = useMemo(
    () =>
      group.events.map((event) =>
        fixtureText(t, event, eventState(event, view), { now: view.now }),
      ),
    [group.events, view, t],
  );
  return (
    <FixtureRow
      title={groupTitle(t, group)}
      fixtures={fixtures}
      onPress={(index) => {
        const event = group.events[index];
        if (event) openEvent(event);
      }}
    />
  );
});

/**
 * Sport from the installed sports addons, as the TV's Sports screen: a day strip (Live now,
 * Today and the next days), then a row per competition for that day. Cards are text only.
 */
export function SportsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const onShow = useOnShow();
  const now = useMinuteClock(onShow);
  const feed = useSportsFeed();
  const view = useViewOptions(feed.events, now);
  const days = useMemo(() => dayStrip(now), [now]);
  const today = days[TODAY_INDEX]!;
  const [picked, setPicked] = useState<SportsDay | undefined>(() => memory.day);
  // Today until another day is picked, and Today again once the picked day has passed.
  const day = picked !== undefined && days.indexOf(picked) !== -1 ? picked : today;
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);

  useWantSports(day, false, onShow);
  // Pull to refresh asks again for whatever failed or has gone out of date.
  const refreshControl = usePullRefresh(() => {
    sportsFeed.retry();
    sportsFeed.refresh();
    return feedSettled();
  });
  // The last sports addon was removed: Sports gives way to Home.
  useEffect(() => {
    if (sports.ready && !sports.shown) router.navigate('/');
  }, [sports.ready, sports.shown]);

  const groups = useMemo(() => buildDay(feed.events, day, view), [feed.events, day, view]);

  useEffect(() => {
    memory.day = day;
  }, [day]);

  let empty: string | undefined;
  if (groups.length === 0) {
    if (feed.loading || !sports.ready) empty = t('sports.loading');
    else if (feed.failed.length === 0) {
      empty = day === 'live' ? t('sports.nothingLive') : t('sports.nothingOnDay');
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.l }]}>
      <Text style={styles.title} accessibilityRole="header">
        {t('rail.sports')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        accessibilityRole="tablist"
      >
        {days.map((item) => {
          const selected = item === day;
          return (
            <Pressable
              key={item}
              onPress={() => setPicked(item)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipOn]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>
                {stripLabel(t, item, view.now)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {feed.failed.length > 0 ? (
        <View style={styles.problem}>
          <Text style={styles.problemText}>
            {t('sports.failed', { names: feed.failed.join(t('common.listSeparator')) })}
          </Text>
          <Button label={t('common.tryAgain')} onPress={() => sportsFeed.retry()} />
        </View>
      ) : null}
      {feed.more && groups.length > 0 ? <Text style={styles.note}>{t('sports.more')}</Text> : null}
      {empty ? <Message lead={empty} /> : null}
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      data={groups}
      // A new day's rows are new rows, even for a competition on both days.
      keyExtractor={(group) => `${day}|${group.key}`}
      ListHeaderComponent={header}
      refreshControl={refreshControl}
      renderItem={({ item: group }) => <GroupRow group={group} view={view} />}
      ListFooterComponent={
        groups.length > 0 && feed.loading ? (
          <Text style={styles.loadingMore}>{t('sports.loadingMore')}</Text>
        ) : undefined
      }
      contentContainerStyle={{ paddingBottom: space.xxl }}
      initialNumToRender={5}
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { gap: space.m },
  title: { ...type.display, color: colors.text, paddingHorizontal: space.l },
  days: { paddingHorizontal: space.l, gap: space.s },
  chip: {
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  chipOn: { backgroundColor: colors.action },
  chipText: { ...type.label, color: colors.textMuted },
  chipTextOn: { color: colors.text },
  problem: { paddingHorizontal: space.l, gap: space.s, alignItems: 'flex-start' },
  problemText: { ...type.body, color: colors.textMuted },
  note: { ...type.small, color: colors.textSubtle, paddingHorizontal: space.l },
  loadingMore: {
    ...type.small,
    color: colors.textSubtle,
    paddingHorizontal: space.l,
    paddingTop: space.l,
  },
});
