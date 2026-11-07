import {
  type FollowSet,
  replayedKeys,
  type SportEvent,
  type SportsDay,
  type SportsFeedState,
  type ViewOptions,
} from '@bannertv/core';
import { isKidsProfile } from '@tv/data/profiles';
import { sportsFeed, sportsFollows, sportsMatcher, sportsState, wantSports } from '@tv/data/sports';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

/*
 * The phone's copies of the TV's sports hooks (apps/webos/src/screens/sports/use-sports.ts).
 * The TV ties them to the screen slot its router keeps; here "on show" is the screen being
 * the focused one while the app is in front.
 */

const MINUTE = 60 * 1000;

function subscribeAppState(callback: () => void): () => void {
  const subscription = AppState.addEventListener('change', callback);
  return () => subscription.remove();
}

function appInFront(): boolean {
  return AppState.currentState !== 'background';
}

/** Whether this screen is the one on show, with the app in front. */
export function useOnShow(): boolean {
  const focused = useIsFocused();
  const inFront = useSyncExternalStore(subscribeAppState, appInFront);
  return focused && inFront;
}

export function useSportsFeed(): SportsFeedState {
  return useSyncExternalStore(sportsFeed.subscribe, sportsFeed.get);
}

/** Sports is offered: an installed addon has sports catalogs, and this is not a kids profile. */
export function useSportsShown(): boolean {
  const shown = useSyncExternalStore(sportsState.subscribe, () => sportsState.get().shown);
  return shown && !isKidsProfile();
}

/**
 * The time, read again on each minute while the screen is on show, and at once when it comes
 * back: live, starting soon and ended are worked out again from the clock, with no request.
 */
export function useMinuteClock(onShow: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!onShow) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      timer = setTimeout(tick, MINUTE - (time % MINUTE) + 50);
    };
    // Coming back on show can be hours later: read the clock straight away.
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [onShow]);
  return now;
}

/**
 * Asks for sport while the screen is on show: a day on Sports, `live` and light for Home's
 * Live sport row. Null asks for nothing.
 */
export function useWantSports(day: SportsDay | null, light: boolean, onShow: boolean): void {
  useEffect(() => {
    if (day === null || !onShow) return;
    return wantSports(day, { light });
  }, [day, light, onShow]);
}

/** The teams and competitions the profile follows: a new object only when they change. */
export function useFollows(): FollowSet {
  return useSyncExternalStore(sportsFollows.subscribe, sportsFollows.set);
}

/**
 * What states and rows are worked out with, new each minute, when events
 * change or when the profile follows or unfollows something.
 */
export function useViewOptions(events: readonly SportEvent[], now: number): ViewOptions {
  const matcher = useSyncExternalStore(sportsMatcher.subscribe, sportsMatcher.get);
  const follows = useFollows();
  const replayed = useMemo(() => replayedKeys(events), [events]);
  return useMemo(
    () => ({
      now,
      firstSeen: (event: SportEvent) => sportsFeed.firstSeen(event),
      replayed,
      matcher,
      follows,
    }),
    [now, replayed, matcher, follows],
  );
}
