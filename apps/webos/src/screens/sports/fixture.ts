import {
  addDays,
  type EventState,
  localClock,
  localDate,
  localDayStart,
  type SportEvent,
  type SportsDay,
  type SportsGroup,
} from '@bannertv/core';
import type { TFunction } from 'i18next';
import { dateFormatter } from '../../data/date-format';

/** What a fixture tile says, worked out once per event and minute. Text only. */
export interface FixtureText {
  key: string;
  /** The competition, or the name the addon gave it under a by-sport row ("IPL"). */
  competition: string;
  /** Home and away, or the event's title when it has no teams. */
  lines: [string] | [string, string];
  /** Local kick-off, "Starting soon", "Ended" and so on. */
  when: string;
  /** Shown as a LIVE pill instead of `when`. */
  live: boolean;
  /** "2 sources", when more than one addon or catalog lists it. */
  sources?: string;
  /** Everything above in one sentence, for screen readers. */
  label: string;
}

const weekdayName = dateFormatter('en-GB', { weekday: 'short' });

/** "Today", "Tomorrow" or "Fri 30", for a local date. */
export function dayName(t: TFunction, day: string, now: number): string {
  const today = localDate(now);
  if (day === today) return t('sports.today');
  if (day === addDays(today, 1)) return t('sports.tomorrow');
  const date = new Date(localDayStart(day));
  const weekday = weekdayName(date);
  return t('sports.dayLabel', { weekday, day: date.getDate() });
}

/** The label of a day in the strip. */
export function stripLabel(t: TFunction, day: SportsDay, now: number): string {
  return day === 'live' ? t('sports.liveNow') : dayName(t, day, now);
}

function kickOffText(t: TFunction, event: SportEvent, now: number, withDay: boolean): string {
  const kickOff = event.kickOff;
  if (kickOff?.at === undefined) {
    if (kickOff?.date !== undefined && withDay) return dayName(t, kickOff.date, now);
    return t('sports.noTime');
  }
  const clock = localClock(kickOff.at);
  const day = localDate(kickOff.at);
  if (withDay && day !== localDate(now)) {
    return t(kickOff.sure ? 'sports.dayAt' : 'sports.dayAbout', {
      day: dayName(t, day, now),
      time: clock,
    });
  }
  return kickOff.sure ? clock : t('sports.about', { time: clock });
}

/**
 * The text of one fixture tile. `withDay` adds the day to times that are not
 * today's, for rows that mix days (Home, Search).
 */
export function fixtureText(
  t: TFunction,
  event: SportEvent,
  state: EventState,
  options: { now: number; withDay?: boolean },
): FixtureText {
  const { now, withDay = false } = options;
  const round = event.competition.round ? ` · ${event.competition.round}` : '';
  const competition = `${event.note ?? event.competition.name}${round}`;
  const lines: FixtureText['lines'] =
    event.home !== undefined && event.away !== undefined ? [event.home, event.away] : [event.title];
  let when: string;
  let live = false;
  switch (state) {
    case 'live':
    case 'live-unknown':
      live = true;
      when = t('sports.live');
      break;
    case 'soon':
      when =
        event.kickOff?.at !== undefined
          ? t('sports.soonAt', { time: localClock(event.kickOff.at) })
          : t('sports.soon');
      break;
    case 'ended':
      when = t('sports.ended');
      break;
    case 'no-time':
      when = t('sports.noTime');
      break;
    default:
      when = kickOffText(t, event, now, withDay);
  }
  const count = event.sources.length;
  const sources = count > 1 ? t('sports.sources', { count }) : undefined;
  const teams =
    lines.length === 2 ? t('sports.teams', { home: lines[0], away: lines[1] }) : lines[0];
  const label = [teams, competition, live ? t('sports.liveNowLabel') : when, sources]
    .filter(Boolean)
    .join(', ');
  return { key: event.key, competition, lines, when, live, sources, label };
}

/** A row's heading: special rows by their kind, competitions by name, with the live count. */
export function groupTitle(t: TFunction, group: SportsGroup): string {
  let title: string;
  switch (group.kind) {
    case 'earlier':
      title = t('sports.earlier');
      break;
    case 'replays':
      title = t('sports.replays');
      break;
    case 'unknown-live':
      title = t('sports.liveUnknownRow');
      break;
    default:
      title = group.title;
  }
  return group.live > 0 && group.kind === 'competition'
    ? t('sports.liveCount', { title, live: group.live, count: group.events.length })
    : title;
}
