import type { Matcher } from './dictionary';
import { replayedKeys } from './events';
import { isFollowed, type FollowSet } from './follows';
import { sortStable } from './sort';
import { liveWindow } from './sport';
import { foldText, slugOf, teamKey } from './text';
import { addDays, localDate } from './time';
import type { EventState, SportEvent, SportsDay, SportsGroup } from './types';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** Within this long before kick-off, an event is "starting soon" and joins Live now. */
export const SOON_MS = 15 * MINUTE;
/** An event with no time at all drops out once BannerTV has seen it this long. */
export const NO_TIME_LIMIT_MS = 2 * DAY;
/** Days in the strip after Today: Tomorrow and the next five. */
export const DAYS_AHEAD = 6;

export interface ViewOptions {
  now: number;
  /** When BannerTV first saw an event, for the limits on events with no time. */
  firstSeen?: (event: SportEvent) => number | undefined;
  /** Events a replay has appeared for: over, whatever their window says. */
  replayed?: ReadonlySet<string>;
  /** Country names, to tell apart two competitions with the same name. */
  matcher?: Matcher;
  /** The teams and competitions the profile follows, whose matches go in the Following row. */
  follows?: FollowSet;
}

/** Where an event stands now, worked out from its kick-off, never from the addon's label alone. */
export function eventState(event: SportEvent, options: ViewOptions): EventState {
  const { now } = options;
  const kickOff = event.kickOff;
  if (kickOff?.at !== undefined) {
    const at = kickOff.at;
    if (now < at - SOON_MS) return 'upcoming';
    if (now < at) return 'soon';
    if (options.replayed?.has(event.key)) return 'ended';
    return now < at + liveWindow(event.sport, event.liveLabel) ? 'live' : 'ended';
  }
  const firstSeen = options.firstSeen?.(event) ?? now;
  if (event.liveLabel) {
    // An addon's LIVE with nothing to check it against counts for the UTC day it was first seen.
    return Math.floor(firstSeen / DAY) === Math.floor(now / DAY) ? 'live-unknown' : 'ended';
  }
  if (kickOff?.date !== undefined) {
    // A day is the TV's calendar day, as in the day strip.
    return kickOff.date < localDate(now) ? 'ended' : 'upcoming';
  }
  return now - firstSeen > NO_TIME_LIMIT_MS ? 'ended' : 'no-time';
}

/** The local date an event belongs to, or undefined when it has no time or date. */
export function eventDay(event: SportEvent): string | undefined {
  if (event.kickOff?.at !== undefined) return localDate(event.kickOff.at);
  return event.kickOff?.date;
}

/** The day strip: Live now, Today, Tomorrow and the next five days, as local dates. */
export function dayStrip(now: number): SportsDay[] {
  const today = localDate(now);
  const days: SportsDay[] = ['live', today];
  for (let n = 1; n <= DAYS_AHEAD; n++) days.push(addDays(today, n));
  return days;
}

function byKickOff(a: SportEvent, b: SportEvent): number {
  const at = a.kickOff?.at;
  const bt = b.kickOff?.at;
  if (at !== undefined && bt !== undefined && at !== bt) return at - bt;
  if (at !== undefined && bt === undefined) return -1;
  if (at === undefined && bt !== undefined) return 1;
  return 0;
}

const KIND_ORDER: Record<SportsGroup['kind'], number> = {
  following: 0,
  competition: 1,
  'unknown-live': 2,
  earlier: 3,
  replays: 4,
};

/** Rows in priority order; competitions BannerTV does not rank, by how many matches they have. */
function orderGroups(groups: SportsGroup[]): SportsGroup[] {
  return sortStable(groups, (a, b) => {
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (a.competition.priority !== b.competition.priority) {
      return a.competition.priority - b.competition.priority;
    }
    return b.events.length - a.events.length;
  });
}

/** A country after a heading only where two rows would otherwise read the same. */
function disambiguate(groups: SportsGroup[], matcher: Matcher | undefined): void {
  const byTitle = new Map<string, SportsGroup[]>();
  for (const group of groups) {
    const key = foldText(group.title);
    const list = byTitle.get(key);
    if (list) list.push(group);
    else byTitle.set(key, [group]);
  }
  byTitle.forEach((list) => {
    if (list.length < 2) return;
    for (const group of list) {
      const code = group.competition.country;
      if (!code) continue;
      const country = matcher?.country(code)?.name ?? code;
      group.title = `${group.title} (${country})`;
    }
  });
}

function uniqueKeys(groups: SportsGroup[]): void {
  const seen = new Set<string>();
  for (const group of groups) {
    let key = group.key;
    for (let n = 2; seen.has(key); n++) key = `${group.key}-${n}`;
    group.key = key;
    seen.add(key);
  }
}

/**
 * The rows for one day of the strip (docs/PLAN.md, Screens). Live now: what
 * is live or starting soon, by competition, then "Live, time unknown". A
 * date: that day's events by competition, ended ones in "Earlier today",
 * events with no time at the end of Today, and Replays last. Matches of a
 * followed team or competition that are still to watch go first, in
 * Following, and not in their own row too, so a day counts each match once.
 */
export function buildDay(
  events: readonly SportEvent[],
  day: SportsDay,
  options: ViewOptions,
): SportsGroup[] {
  const { now } = options;
  const replayed = options.replayed ?? replayedKeys(events);
  const stateOptions = { ...options, replayed };
  const today = localDate(now);
  const byCompetition = new Map<string, SportsGroup>();
  const special = new Map<SportsGroup['kind'], SportsGroup>();
  const groups: SportsGroup[] = [];

  const specialGroup = (kind: SportsGroup['kind'], title: string, sample: SportEvent) => {
    let group = special.get(kind);
    if (!group) {
      group = {
        key: kind,
        competition: { ...sample.competition, key: kind, name: title },
        title,
        kind,
        events: [],
        live: 0,
      };
      special.set(kind, group);
      groups.push(group);
    }
    return group;
  };
  const competitionGroup = (event: SportEvent) => {
    let group = byCompetition.get(event.competition.key);
    if (!group) {
      group = {
        key: `c-${slugOf(event.competition.key)}`,
        competition: event.competition,
        title: event.competition.name,
        kind: 'competition',
        events: [],
        live: 0,
      };
      byCompetition.set(event.competition.key, group);
      groups.push(group);
    }
    return group;
  };

  const follows = options.follows;
  const following = (event: SportEvent) =>
    follows !== undefined && isFollowed(event, follows)
      ? specialGroup('following', 'Following', event)
      : undefined;

  for (const event of events) {
    if (event.kind === 'replay') {
      if (day === today) specialGroup('replays', 'Replays', event).events.push(event);
      continue;
    }
    const state = eventState(event, stateOptions);
    let group: SportsGroup | undefined;
    if (day === 'live') {
      if (state === 'live' || state === 'soon') group = following(event) ?? competitionGroup(event);
      else if (state === 'live-unknown')
        group = following(event) ?? specialGroup('unknown-live', 'Live, time unknown', event);
    } else if (state === 'no-time' || state === 'live-unknown') {
      // No time to place them by: at the end of their competition's row on Today.
      if (day === today) group = following(event) ?? competitionGroup(event);
    } else if (eventDay(event) === day) {
      // A followed match that is over has nothing left to watch live: it stays in Earlier today.
      group =
        state === 'ended' && day === today
          ? specialGroup('earlier', 'Earlier today', event)
          : (following(event) ?? competitionGroup(event));
    }
    if (!group) continue;
    group.events.push(event);
    if (state === 'live' || state === 'live-unknown') group.live++;
  }

  for (const group of groups) {
    group.events =
      group.kind === 'replays' ? group.events.slice(0, 40) : sortStable(group.events, byKickOff);
  }
  const ordered = orderGroups(groups);
  disambiguate(ordered, options.matcher);
  uniqueKeys(ordered);
  return ordered;
}

/** How many events each day of the strip holds, so empty days can say so. */
export function dayCounts(
  events: readonly SportEvent[],
  options: ViewOptions,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const day of dayStrip(options.now)) {
    counts[day] = buildDay(events, day, options).reduce(
      (sum, group) => sum + group.events.length,
      0,
    );
  }
  return counts;
}

/**
 * Team search on BannerTV's own copy of the events: team names and their
 * aliases (Man Utd, Spurs), then competitions and titles. Live first, then
 * the soonest.
 */
export function searchEvents(
  events: readonly SportEvent[],
  term: string,
  options: ViewOptions,
): SportEvent[] {
  const key = teamKey(term);
  const folded = foldText(term).trim();
  if (key.length < 2 && folded.length < 2) return [];
  const names = new Set<string>([key]);
  if (options.matcher) {
    for (const team of options.matcher.teamsMatching(term, 12)) {
      for (const name of options.matcher.namesOf(team)) names.add(name);
      names.add(teamKey(team.name));
    }
  }
  const matches = (event: SportEvent) => {
    for (const teamName of event.teamKeys) {
      if (names.has(teamName)) return true;
      if (key.length >= 3 && (teamName.indexOf(key) === 0 || teamName.indexOf(` ${key}`) !== -1))
        return true;
    }
    if (folded.length >= 3 && foldText(event.competition.name).indexOf(folded) !== -1) return true;
    return folded.length >= 3 && foldText(event.title).indexOf(folded) !== -1;
  };
  const replayed = options.replayed ?? replayedKeys(events);
  const rank = (event: SportEvent) => {
    if (event.kind === 'replay') return 4;
    const state = eventState(event, { ...options, replayed });
    if (state === 'live' || state === 'live-unknown') return 0;
    if (state === 'soon') return 1;
    if (state === 'ended') return 3;
    return 2;
  };
  const found = events.filter(matches).filter((event) => {
    if (event.kind === 'replay') return true;
    const state = eventState(event, { ...options, replayed });
    // Ended long ago: nothing to watch live.
    return state !== 'ended' || eventDay(event) === localDate(options.now);
  });
  return sortStable(found, (a, b) => rank(a) - rank(b) || byKickOff(a, b));
}
