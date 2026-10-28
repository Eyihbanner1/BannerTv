import { buildDay, dayStrip, eventState, type SportsDay, type SportsGroup } from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
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
import { openSection, push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { FixtureRow, FixtureRowPlaceholder } from '../../components/FixtureRow';
import { Pressable } from '../../components/Pressable';
import { slideTrack } from '../../components/row-track';
import { sportsFeed, sportsState } from '../../data/sports';
import { forgetFocus } from '../../navigation/focus-memory';
import { focusedKey } from '../../navigation/spatial';
import { useBack } from '../../navigation/use-back';
import { canSlide } from '../../platform/input-mode';
import { fixtureText, groupTitle, stripLabel } from './fixture';
import { useMinuteClock, useSportsFeed, useViewOptions, useWantSports } from './use-sports';
import styles from './SportsScreen.module.css';

/** Focus resting this long on a day of the strip opens it; OK opens it at once. */
const DAY_REST_MS = 400;
/** Rows further than this from the focused one are drawn as empty boxes. */
const ROWS_AROUND = 3;
const TODAY_INDEX = 1;
const ROW_PREFIX = 'sports-row-';

const dayKey = (index: number) => `sports-day-${index}`;
const rowKey = (group: SportsGroup) => `${ROW_PREFIX}${group.key}`;

// Kept for the launch, so coming back to Sports finds the day it was on.
const memory = { day: undefined as SportsDay | undefined };

interface DayStripProps {
  days: readonly SportsDay[];
  day: SportsDay;
  now: number;
  onRest: (day: SportsDay) => void;
  onPick: (day: SportsDay) => void;
}

const DayStrip = memo(function DayStrip({ days, day, now, onRest, onPick }: DayStripProps) {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'sports-days',
    saveLastFocusedChild: false,
    preferredChildFocusKey: dayKey(Math.max(0, days.indexOf(day))),
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.days} role="tablist">
        {days.map((item, index) => {
          const label = stripLabel(t, item, now);
          return (
            <Pressable
              key={item}
              focusKey={dayKey(index)}
              label={label}
              className={item === day ? `${styles.day} ${styles.selected}` : styles.day}
              focusedClassName={styles.dayFocused}
              onFocus={() => onRest(item)}
              onPress={() => onPick(item)}
            >
              {label}
            </Pressable>
          );
        })}
      </div>
    </FocusContext.Provider>
  );
});

interface GroupRowProps {
  group: SportsGroup;
  near: boolean;
  view: ReturnType<typeof useViewOptions>;
  onFocusRow: (key: string) => void;
}

const GroupRow = memo(function GroupRow({ group, near, view, onFocusRow }: GroupRowProps) {
  const { t } = useTranslation();
  const title = groupTitle(t, group);
  const fixtures = useMemo(
    () =>
      near
        ? group.events.map((event) =>
            fixtureText(t, event, eventState(event, view), { now: view.now }),
          )
        : null,
    [near, group.events, view, t],
  );
  const key = rowKey(group);
  const onItemFocus = useCallback(() => onFocusRow(key), [onFocusRow, key]);
  const onItemPress = useCallback(
    (index: number) => {
      const event = group.events[index];
      if (event) push({ name: 'event', event });
    },
    [group.events],
  );
  if (!near) return <FixtureRowPlaceholder title={title} />;
  return (
    <FixtureRow
      focusKey={key}
      title={title}
      fixtures={fixtures}
      onItemFocus={onItemFocus}
      onItemPress={onItemPress}
    />
  );
});

/**
 * Sport from the installed sports addons: a day strip (Live now, Today and
 * the next days), then a row per competition for that day, in priority
 * order, the country groups, Other, and Replays (docs/PLAN.md, Sports
 * addons, Screens). Tiles are text only.
 */
export function SportsScreen() {
  const { t } = useTranslation();
  const now = useMinuteClock();
  const feed = useSportsFeed();
  const view = useViewOptions(feed.events, now);
  const days = useMemo(() => dayStrip(now), [now]);
  const today = days[TODAY_INDEX]!;
  const [picked, setDay] = useState<SportsDay | undefined>(() => memory.day);
  // Today until another day is picked; and Today again once the picked day has passed.
  const day = picked !== undefined && days.indexOf(picked) !== -1 ? picked : today;
  const [focusedRow, setFocusedRow] = useState<string>();
  const trackRef = useRef<HTMLDivElement>(null);
  const restTimer = useRef<number | undefined>(undefined);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);

  useWantSports(day);
  useEffect(() => {
    memory.day = day;
  }, [day]);
  // The last sports addon was removed: Sports gives way to Home.
  useEffect(() => {
    if (sports.ready && !sports.shown) openSection('home');
  }, [sports.ready, sports.shown]);

  const groups = useMemo(() => buildDay(feed.events, day, view), [feed.events, day, view]);
  const focusedIndex = Math.max(
    0,
    groups.findIndex((group) => rowKey(group) === focusedRow),
  );

  useScreenFocus(dayKey(Math.max(0, days.indexOf(day))));

  const dayNow = useRef(day);
  useLayoutEffect(() => {
    dayNow.current = day;
  });
  const changeDay = useCallback((next: SportsDay) => {
    window.clearTimeout(restTimer.current);
    if (dayNow.current === next) return;
    dayNow.current = next;
    // A new day's rows start at their first tiles, at the top.
    forgetFocus(ROW_PREFIX);
    setFocusedRow(undefined);
    setDay(next);
  }, []);
  const onRest = useCallback(
    (next: SportsDay) => {
      window.clearTimeout(restTimer.current);
      restTimer.current = window.setTimeout(() => changeDay(next), DAY_REST_MS);
    },
    [changeDay],
  );
  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  const onFocusRow = useCallback((key: string) => {
    setFocusedRow(key);
    if (canSlide()) slideTrack(trackRef.current, key);
  }, []);
  // Rows above the focused one can come and go as matches start and end.
  useLayoutEffect(() => {
    if (canSlide()) slideTrack(trackRef.current, focusedRow);
  }, [groups, focusedRow]);

  // Back first returns the strip to Today, then the router goes Home.
  useBack('screen', () => {
    const onStrip = focusedKey().indexOf('sports-day-') === 0;
    if (onStrip && day === today) return false;
    changeDay(today);
    void setFocus(dayKey(TODAY_INDEX));
    return true;
  });

  let body;
  if (groups.length > 0) {
    body = (
      <div className={styles.rows}>
        <div ref={trackRef} className={styles.track}>
          {groups.map((group, index) => (
            <GroupRow
              key={group.key}
              group={group}
              near={Math.abs(index - focusedIndex) <= ROWS_AROUND}
              view={view}
              onFocusRow={onFocusRow}
            />
          ))}
        </div>
      </div>
    );
  } else if (feed.loading || !sports.ready) {
    body = <p className={styles.message}>{t('sports.loading')}</p>;
  } else if (feed.failed.length === 0) {
    body = (
      <p className={styles.message}>
        {day === 'live' ? t('sports.nothingLive') : t('sports.nothingOnDay')}
      </p>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('rail.sports')}</h1>
        <DayStrip days={days} day={day} now={view.now} onRest={onRest} onPick={changeDay} />
        {feed.failed.length > 0 && (
          <div className={styles.problem}>
            <p className={styles.problemText}>
              {t('sports.failed', { names: feed.failed.join(t('common.listSeparator')) })}
            </p>
            <Button
              focusKey="sports-retry"
              label={t('common.tryAgain')}
              onPress={() => sportsFeed.retry()}
            />
          </div>
        )}
        {feed.more && groups.length > 0 && <p className={styles.note}>{t('sports.more')}</p>}
      </div>
      {body}
      {groups.length > 0 && feed.loading && (
        <p className={styles.loadingMore}>{t('sports.loadingMore')}</p>
      )}
    </div>
  );
}
