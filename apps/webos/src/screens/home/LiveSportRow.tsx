import { buildDay, eventState, type SportEvent } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { memo, useCallback, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { FixtureRow, FixtureRowPlaceholder } from '../../components/FixtureRow';
import { focusedKey } from '../../navigation/spatial';
import { fixtureText } from '../sports/fixture';
import { useMinuteClock, useSportsFeed, useViewOptions, useWantSports } from '../sports/use-sports';

/** The row's key on Home, beside the catalog rows' keys. */
export const LIVE_SPORT_ROW_KEY = 'live-sport';
export const LIVE_SPORT_FOCUS_KEY = `home-${LIVE_SPORT_ROW_KEY}`;
const MAX_ITEMS = 40;

interface LiveSportRowProps {
  /** Near focus: fetched and drawn, like any Home row. */
  near: boolean;
  onItemFocus: (rowKey: string, item: MetaPreview | undefined, element: HTMLElement) => void;
  /** Nothing is live any more; `focused` if focus was in the row. */
  onGone: (focused: boolean) => void;
}

/**
 * Home's "Live sport" row: what the sports addons have live or starting
 * soon, from the first page of their live catalogs only. It shows only when
 * something is live (docs/PLAN.md, Sports addons, Screens).
 */
export const LiveSportRow = memo(function LiveSportRow({
  near,
  onItemFocus,
  onGone,
}: LiveSportRowProps) {
  const { t } = useTranslation();
  useWantSports(near ? 'live' : null, true);
  const feed = useSportsFeed();
  const now = useMinuteClock();
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
      near
        ? events.map((event) =>
            fixtureText(t, event, eventState(event, view), { now: view.now, withDay: true }),
          )
        : null,
    [near, events, view, t],
  );
  const empty = events.length === 0;
  // Before the tiles unregister, while focus is still on one of them.
  useLayoutEffect(() => {
    if (empty) onGone(focusedKey().indexOf(`${LIVE_SPORT_FOCUS_KEY}-tile-`) === 0);
  }, [empty, onGone]);
  const onFocus = useCallback(
    (_: number | undefined, element: HTMLElement) =>
      onItemFocus(LIVE_SPORT_ROW_KEY, undefined, element),
    [onItemFocus],
  );
  const onPress = useCallback(
    (index: number) => {
      const event = events[index];
      if (event) push({ name: 'event', event });
    },
    [events],
  );
  const title = t('sports.liveRow');
  if (empty) return null;
  if (!near) return <FixtureRowPlaceholder title={title} />;
  return (
    <FixtureRow
      focusKey={LIVE_SPORT_FOCUS_KEY}
      title={title}
      fixtures={fixtures}
      onItemFocus={onFocus}
      onItemPress={onPress}
    />
  );
});
