import {
  type FollowSet,
  replayedKeys,
  type SportEvent,
  type SportsDay,
  type SportsFeedState,
  type ViewOptions,
} from '@bannertv/core';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useScreenSlot } from '../../app/screen-slot';
import {
  sportsFeed,
  sportsFollows,
  sportsMatcher,
  sportsState,
  wantSports,
  wantSportsMatcher,
} from '../../data/sports';

const MINUTE = 60 * 1000;

export function useSportsFeed(): SportsFeedState {
  return useSyncExternalStore(sportsFeed.subscribe, sportsFeed.get);
}

export function useSportsShown(): boolean {
  return useSyncExternalStore(sportsState.subscribe, () => sportsState.get().shown);
}

/**
 * The time, read again on each minute while the screen is on show: live,
 * starting soon and ended are worked out again from the clock, with no
 * request (docs/PLAN.md, Fetching and paging).
 */
export function useMinuteClock(): number {
  const slot = useScreenSlot();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => {
      window.clearTimeout(timer);
      if (!slot.get()) return;
      const time = Date.now();
      setNow(time);
      timer = window.setTimeout(tick, MINUTE - (time % MINUTE) + 50);
    };
    // The first reading is the one the screen was drawn with; ticks follow.
    timer = window.setTimeout(tick, MINUTE - (Date.now() % MINUTE) + 50);
    const unsubscribe = slot.subscribe(tick);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [slot]);
  return now;
}

/**
 * Asks for sport while the screen is on show: `day` on the Sports screen,
 * `live` and light for the Live sport row. Null asks for nothing.
 */
export function useWantSports(day: SportsDay | null, light = false): void {
  const slot = useScreenSlot();
  useEffect(() => {
    if (day === null) return;
    let release: (() => void) | undefined;
    const sync = () => {
      if (slot.get()) {
        if (!release) release = wantSports(day, { light });
      } else if (release) {
        release();
        release = undefined;
      }
    };
    sync();
    const unsubscribe = slot.subscribe(sync);
    return () => {
      unsubscribe();
      release?.();
    };
  }, [day, light, slot]);
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

/**
 * A screen that shows sport by team and league: the team and league data
 * loads now if the launch held it back (tuning matcherAt `idle`).
 */
export function useSportsMatcher(): void {
  useEffect(() => wantSportsMatcher(), []);
}
