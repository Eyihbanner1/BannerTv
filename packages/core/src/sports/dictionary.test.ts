import { beforeEach, describe, expect, it, vi } from 'vitest';
import data from './data/sports-data.json';
import { createMatcher } from './dictionary';
import type { SportsData } from './types';

// Counts each fold, so the test can tell how often building the maps folds a name.
const folds = vi.hoisted(() => ({ team: [] as string[], competition: [] as string[] }));

vi.mock('./text', async (importOriginal) => {
  const text = await importOriginal<typeof import('./text')>();
  return {
    ...text,
    teamKey: (name: string) => {
      folds.team.push(name);
      return text.teamKey(name);
    },
    competitionKey: (name: string) => {
      folds.competition.push(name);
      return text.competitionKey(name);
    },
  };
});

const shipped = data as unknown as SportsData;

beforeEach(() => {
  folds.team.length = 0;
  folds.competition.length = 0;
});

describe('createMatcher', () => {
  it('folds each different name once while it builds its maps', () => {
    createMatcher(shipped);
    const teamNames = new Set<string>();
    for (const team of shipped.teams)
      [team.name].concat(team.aliases).forEach((n) => teamNames.add(n));
    for (const league in shipped.calendars) {
      for (const [, home, away] of shipped.calendars[league]!) teamNames.add(home).add(away);
    }
    for (const id in shipped.uefa) shipped.uefa[id]!.forEach((name) => teamNames.add(name));
    const competitionNames = new Set<string>();
    for (const country of shipped.countries)
      competitionNames.add(country.name).add(country.adjective);
    for (const entry of shipped.competitions) {
      [entry.name].concat(entry.aliases).forEach((name) => competitionNames.add(name));
    }

    expect(folds.team.length).toBe(teamNames.size);
    expect(new Set(folds.team).size).toBe(teamNames.size);
    expect(folds.competition.length).toBe(competitionNames.size);
    // The calendars name the same teams over and over: that is what it saves.
    let calendarNames = 0;
    for (const league in shipped.calendars) calendarNames += shipped.calendars[league]!.length * 2;
    expect(calendarNames).toBeGreaterThan(teamNames.size);
  });

  it('keeps nothing of what it is asked afterwards', () => {
    const matcher = createMatcher(shipped);
    folds.team.length = 0;
    expect(matcher.team('Arsenal FC')).toBe(matcher.team('Arsenal'));
    expect(matcher.team('Arsenal')).toBeDefined();
    expect(folds.team).toEqual(['Arsenal FC', 'Arsenal', 'Arsenal']);
  });

  it('finds teams and leagues by their names, aliases and calendars as before', () => {
    const mini: SportsData = {
      version: 1,
      built: '2026-10-28',
      countries: [{ code: 'GB-ENG', name: 'England', adjective: 'English' }],
      competitions: [
        {
          id: 'eng.1',
          name: 'Premier League',
          sport: 'football',
          country: 'GB-ENG',
          kind: 'league',
          priority: 1,
          aliases: ['EPL'],
        },
        {
          id: 'uefa.cl',
          name: 'UEFA Champions League',
          sport: 'football',
          country: 'EU',
          kind: 'international',
          priority: 2,
          aliases: [],
        },
      ],
      teams: [
        {
          name: 'Arsenal',
          sport: 'football',
          country: 'GB-ENG',
          aliases: ['Arsenal FC', 'The Gunners'],
        },
        { name: 'Chelsea', sport: 'football', country: 'GB-ENG', aliases: ['Chelsea FC'] },
      ],
      uefa: { 'uefa.cl': ['FC Arsenal', 'Chelsea'] },
      calendars: {
        'eng.1': [
          ['2026-10-28', 'Arsenal FC', 'Chelsea'],
          ['2026-11-04', 'Chelsea FC', 'The Gunners'],
        ],
      },
    };
    const matcher = createMatcher(mini);
    const arsenal = matcher.team('The Gunners')!;
    const chelsea = matcher.team('chelsea fc')!;
    expect(arsenal.name).toBe('Arsenal');
    expect(chelsea.name).toBe('Chelsea');
    expect(matcher.namesOf(arsenal)).toEqual(['arsenal', 'the gunners']);
    expect(matcher.competition('English Premier League')?.id).toBe('eng.1');
    expect(matcher.competition('EPL 2026/27')?.id).toBe('eng.1');
    expect(matcher.inCalendar('eng.1', arsenal, chelsea, undefined, '2026-10-29')).toBe(true);
    expect(matcher.inCalendar('eng.1', chelsea, arsenal, undefined, '2026-11-04')).toBe(true);
    expect(matcher.inCalendar('eng.1', arsenal, chelsea, undefined, '2026-11-10')).toBe(false);
    expect(matcher.sharedUefa(arsenal, chelsea)?.id).toBe('uefa.cl');
  });
});
