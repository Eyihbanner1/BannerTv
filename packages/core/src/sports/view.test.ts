import { describe, expect, it, vi } from 'vitest';
import type { Competition, KickOff, Sport, SportEvent } from './types';
import { buildDay, dayCounts, dayStrip, eventState, searchEvents } from './view';
import { createMatcher } from './dictionary';
import mini from './fixtures/mini-data.json';
import type { SportsData } from './types';
import { localDate } from './time';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-28T19:00:00Z');
const matcher = createMatcher(mini as unknown as SportsData);

function competition(key: string, name: string, priority: number, country?: string): Competition {
  const result: Competition = { key, name, sport: 'football', priority, source: 'genre' };
  if (country) result.country = country;
  return result;
}

const PL = competition('eng.1', 'Premier League', 10, 'GB-ENG');
const CUP = competition('ger.cup', 'DFB-Pokal', 160, 'DE');

let n = 0;
function event(
  fields: Partial<SportEvent> & { at?: number; date?: string; sure?: boolean },
): SportEvent {
  const { at, date, sure = true, ...rest } = fields;
  const result: SportEvent = {
    key: `e${n++}`,
    kind: 'event',
    sport: 'football' as Sport,
    title: 'A vs B',
    competition: PL,
    liveLabel: false,
    sources: [],
    teamKeys: [],
    ...rest,
  };
  if (at !== undefined) result.kickOff = { at, sure, source: 'released' } as KickOff;
  else if (date !== undefined) result.kickOff = { date, sure: false, source: 'date-only' };
  return result;
}

describe('states', () => {
  it('works out live and ended from the kick-off, not the label', () => {
    expect(eventState(event({ at: NOW + HOUR }), { now: NOW })).toBe('upcoming');
    expect(eventState(event({ at: NOW + 10 * 60 * 1000 }), { now: NOW })).toBe('soon');
    expect(eventState(event({ at: NOW - HOUR }), { now: NOW })).toBe('live');
    expect(eventState(event({ at: NOW - 2.6 * HOUR }), { now: NOW })).toBe('ended');
    // Still labelled live: football stretches to 3 hours for extra time.
    expect(eventState(event({ at: NOW - 2.6 * HOUR, liveLabel: true }), { now: NOW })).toBe('live');
    expect(eventState(event({ at: NOW - 3.1 * HOUR, liveLabel: true }), { now: NOW })).toBe(
      'ended',
    );
  });

  it('ends a match a replay has appeared for', () => {
    const live = event({ at: NOW - HOUR });
    expect(eventState(live, { now: NOW, replayed: new Set([live.key]) })).toBe('ended');
  });

  it('counts a LIVE with no time for the day it was first seen', () => {
    const unknown = event({ liveLabel: true });
    expect(eventState(unknown, { now: NOW, firstSeen: () => NOW - HOUR })).toBe('live-unknown');
    expect(eventState(unknown, { now: NOW, firstSeen: () => NOW - 24 * HOUR })).toBe('ended');
  });

  it('drops an event with no time at all after two days', () => {
    const bare = event({});
    expect(eventState(bare, { now: NOW, firstSeen: () => NOW - HOUR })).toBe('no-time');
    expect(eventState(bare, { now: NOW, firstSeen: () => NOW - 49 * HOUR })).toBe('ended');
  });

  it("ends a date-only event at the TV's midnight, not at UTC midnight", () => {
    try {
      // 21:00 on 28 October in New York is already the 29th in UTC.
      vi.stubEnv('TZ', 'America/New_York');
      const evening = Date.parse('2026-10-29T01:00:00Z');
      expect(localDate(evening)).toBe('2026-10-28');
      const tonight = event({ date: '2026-10-28' });
      expect(eventState(tonight, { now: evening })).toBe('upcoming');
      expect(buildDay([tonight], '2026-10-28', { now: evening }).map((g) => g.title)).toEqual([
        'Premier League',
      ]);
      // 08:00 on 29 October in Tokyo is still the 28th in UTC: yesterday's match is over.
      vi.stubEnv('TZ', 'Asia/Tokyo');
      const morning = Date.parse('2026-10-28T23:00:00Z');
      expect(localDate(morning)).toBe('2026-10-29');
      expect(eventState(event({ date: '2026-10-28' }), { now: morning })).toBe('ended');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(localDate(Date.parse('2026-10-29T01:00:00Z'))).toBe('2026-10-29');
  });
});

describe('days', () => {
  it('has Live now, Today and six more days', () => {
    const days = dayStrip(NOW);
    expect(days).toHaveLength(8);
    expect(days[0]).toBe('live');
    expect(days[1]).toBe('2026-10-28');
    expect(days[7]).toBe('2026-11-03');
  });

  it('puts live and soon on Live now, by competition in priority order', () => {
    const groups = buildDay(
      [
        event({ at: NOW - HOUR, competition: CUP }),
        event({ at: NOW - HOUR }),
        event({ at: NOW + 5 * 60 * 1000 }),
        event({ at: NOW + 3 * HOUR }),
        event({ liveLabel: true }),
      ],
      'live',
      { now: NOW, firstSeen: () => NOW },
    );
    expect(groups.map((g) => g.title)).toEqual([
      'Premier League',
      'DFB-Pokal',
      'Live, time unknown',
    ]);
    expect(groups[0]!.events).toHaveLength(2);
    expect(groups[0]!.live).toBe(1);
  });

  it('puts ended matches in Earlier today and keeps untimed ones at the end of their row', () => {
    const untimed = event({ title: 'Untimed' });
    const groups = buildDay(
      [event({ at: NOW - 5 * HOUR }), event({ at: NOW + HOUR, title: 'Later' }), untimed],
      '2026-10-28',
      { now: NOW, firstSeen: () => NOW },
    );
    expect(groups.map((g) => g.title)).toEqual(['Premier League', 'Earlier today']);
    expect(groups[0]!.events.map((e) => e.title)).toEqual(['Later', 'Untimed']);
  });

  it('places events on the local date of their kick-off', () => {
    // 23:30 UTC on 2 July is 00:30 on 3 July in London.
    const summer = Date.parse('2026-07-02T12:00:00Z');
    const late = event({ at: Date.parse('2026-07-02T23:30:00Z') });
    expect(buildDay([late], '2026-07-03', { now: summer })[0]!.events).toHaveLength(1);
    expect(buildDay([late], '2026-07-02', { now: summer })).toHaveLength(0);
  });

  it('adds a country only where two rows would read the same', () => {
    const welsh = competition('wal.pl', 'Premier League', 400, 'GB-WLS');
    const groups = buildDay(
      [event({ at: NOW + HOUR }), event({ at: NOW + HOUR, competition: welsh })],
      '2026-10-28',
      { now: NOW, matcher },
    );
    expect(groups.map((g) => g.title)).toEqual([
      'Premier League (England)',
      'Premier League (Wales)',
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });

  it('lists replays last on Today only, at most 40', () => {
    const replays = Array.from({ length: 50 }, () => event({ kind: 'replay', date: '2026-10-27' }));
    const today = buildDay(replays, '2026-10-28', { now: NOW });
    expect(today).toHaveLength(1);
    expect(today[0]!.title).toBe('Replays');
    expect(today[0]!.events).toHaveLength(40);
    expect(buildDay(replays, '2026-10-29', { now: NOW })).toHaveLength(0);
  });

  it('counts events per day', () => {
    const counts = dayCounts([event({ at: NOW + HOUR }), event({ at: NOW + 30 * HOUR })], {
      now: NOW,
    });
    expect(counts['2026-10-28']).toBe(1);
    expect(counts['2026-10-30']).toBe(1);
    expect(counts.live).toBe(0);
  });
});

describe('the Following row', () => {
  const follows = {
    teams: new Set(['football:arsenal:women']),
    competitions: new Set(['ger.cup']),
  };
  const arsenalWomen = (fields: Parameters<typeof event>[0]) =>
    event({
      title: 'Arsenal Women vs Chelsea Women',
      followKeys: ['football:arsenal:women', 'football:chelsea:women'],
      ...fields,
    });

  it("comes first on a day, holding followed matches instead of their competitions' rows", () => {
    const followed = arsenalWomen({ at: NOW + 2 * HOUR });
    const cup = event({ at: NOW + HOUR, competition: CUP, title: 'Cup tie' });
    const other = event({ at: NOW + HOUR, title: 'Other match' });
    const untimed = arsenalWomen({ title: 'Untimed' });
    const options = { now: NOW, firstSeen: () => NOW, follows };
    const groups = buildDay([followed, cup, other, untimed], '2026-10-28', options);
    expect(groups.map((g) => [g.key, g.title, g.kind])).toEqual([
      ['following', 'Following', 'following'],
      ['c-eng-1', 'Premier League', 'competition'],
    ]);
    // By kick-off, untimed last, as in any row.
    expect(groups[0]!.events.map((e) => e.title)).toEqual([
      'Cup tie',
      'Arsenal Women vs Chelsea Women',
      'Untimed',
    ]);
    // Each match once, so a day counts the same with follows or without.
    expect(dayCounts([followed, cup, other, untimed], options)).toEqual(
      dayCounts([followed, cup, other, untimed], { now: NOW, firstSeen: () => NOW }),
    );
  });

  it('comes first on Live now, so Home lists followed matches first', () => {
    const groups = buildDay(
      [
        event({ at: NOW - HOUR, title: 'Live league match' }),
        arsenalWomen({ at: NOW + 5 * 60 * 1000 }),
        arsenalWomen({ liveLabel: true, title: 'Live with no time' }),
        event({ at: NOW - HOUR, competition: CUP, title: 'Live cup tie' }),
        arsenalWomen({ at: NOW + 3 * HOUR, title: 'Later' }),
      ],
      'live',
      { now: NOW, firstSeen: () => NOW, follows },
    );
    expect(groups.map((g) => g.title)).toEqual(['Following', 'Premier League']);
    expect(groups[0]!.events.map((e) => e.title)).toEqual([
      'Live cup tie',
      'Arsenal Women vs Chelsea Women',
      'Live with no time',
    ]);
    expect(groups[0]!.live).toBe(2);
  });

  it('leaves a followed match that is over in Earlier today, and a replay in Replays', () => {
    const groups = buildDay(
      [
        arsenalWomen({ at: NOW - 5 * HOUR }),
        arsenalWomen({ kind: 'replay', date: '2026-10-27' }),
        arsenalWomen({ at: NOW + 30 * HOUR }),
      ],
      '2026-10-28',
      { now: NOW, follows },
    );
    expect(groups.map((g) => g.title)).toEqual(['Earlier today', 'Replays']);
  });

  it('is not there when nothing followed is on', () => {
    const groups = buildDay([event({ at: NOW + HOUR })], '2026-10-28', { now: NOW, follows });
    expect(groups.map((g) => g.title)).toEqual(['Premier League']);
  });
});

describe('team search', () => {
  const spurs = event({
    title: 'Arsenal vs Tottenham Hotspur',
    teamKeys: ['arsenal', 'tottenham hotspur'],
    at: NOW + HOUR,
  });
  const city = event({
    title: 'Manchester City vs Burnley',
    teamKeys: ['manchester city', 'burnley'],
    at: NOW - HOUR,
  });
  const old = event({
    title: 'Manchester City vs Arsenal',
    teamKeys: ['manchester city', 'arsenal'],
    at: NOW - 30 * HOUR,
  });

  it('finds teams by their aliases, live first', () => {
    expect(searchEvents([spurs, city, old], 'Spurs', { now: NOW, matcher })).toEqual([spurs]);
    expect(searchEvents([spurs, city, old], 'man city', { now: NOW, matcher })).toEqual([city]);
    expect(searchEvents([spurs, city, old], 'arsenal', { now: NOW, matcher })).toEqual([spurs]);
  });

  it('finds nothing for one letter', () => {
    expect(searchEvents([spurs], 'a', { now: NOW })).toEqual([]);
  });
});
