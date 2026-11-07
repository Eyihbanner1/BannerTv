import { buildDay, eventState, type SportEvent } from '@bannertv/core';
import { fixtureText } from '@tv/screens/sports/fixture';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { openEvent } from '../../nav/routes';
import { FixtureRow } from '../../ui/FixtureRow';
import {
  useMinuteClock,
  useOnShow,
  useSportsFeed,
  useSportsShown,
  useViewOptions,
  useWantSports,
} from './use-sports';

const MAX_ITEMS = 40;

/**
 * Home's "Live sport" row, as on the TV: what the sports addons have live or starting soon,
 * from the first page of their live catalogs only. It shows only when something is live.
 * Memoised: it is a line of Home's list, which draws every cell again each time Home renders
 * (a row's first page, a newly reached row), and it takes no props, so it draws again only when
 * its own sport, clock or words change.
 */
export const LiveSportRow = memo(function LiveSportRow() {
  const { t } = useTranslation();
  const shown = useSportsShown();
  const onShow = useOnShow();
  useWantSports(shown ? 'live' : null, true, onShow);
  const feed = useSportsFeed();
  const now = useMinuteClock(onShow);
  const view = useViewOptions(feed.events, now);
  const events = useMemo(() => {
    const live: SportEvent[] = [];
    for (const group of buildDay(feed.events, 'live', view)) {
      for (const event of group.events) live.push(event);
    }
    return live.slice(0, MAX_ITEMS);
  }, [feed.events, view]);
  const fixtures = useMemo(
    () =>
      events.map((event) =>
        fixtureText(t, event, eventState(event, view), { now: view.now, withDay: true }),
      ),
    [events, view, t],
  );
  if (!shown || events.length === 0) return null;
  return (
    <FixtureRow
      title={t('sports.liveRow')}
      fixtures={fixtures}
      onPress={(index) => {
        const event = events[index];
        if (event) openEvent(event);
      }}
    />
  );
});
