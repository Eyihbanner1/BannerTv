import { type MetaPreview, parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createMatcher } from './dictionary';
import { buildEvents } from './events';
import mini from './fixtures/mini-data.json';
import { type CatalogContext, readListing } from './listing';
import type { KickOff, SportsData } from './types';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const matcher = createMatcher(mini as unknown as SportsData);

function context(overrides: Partial<CatalogContext> = {}): CatalogContext {
  return {
    addonIndex: 0,
    addonId: 'test.sports',
    transportUrl: 'https://sports.example/manifest.json',
    catalogId: 'all',
    replays: false,
    channels: false,
    ...overrides,
  };
}

let counter = 0;
function item(fields: Record<string, unknown>): MetaPreview {
  const parsed = parseMetaPreview({ id: `m${counter++}`, type: 'sport', ...fields });
  if (!parsed) throw new Error('not an item');
  return parsed;
}

function events(
  rows: Array<[Record<string, unknown>, Partial<CatalogContext>?]>,
  options: { remembered?: (addonId: string, id: string) => KickOff | undefined } = {},
) {
  const listings = rows.map(([fields, ctx]) => readListing(item(fields), context(ctx), NOW));
  return buildEvents(listings, { matcher, ...options });
}

describe('grouping', () => {
  it('uses the competition the addon names in a second genre', () => {
    const [event] = events([
      [
        {
          name: 'Freiburg vs Wolfsburg',
          genres: ['Football', 'DFB-Pokal'],
          releaseInfo: '28 Oct 2026 · 17:00 UTC',
        },
      ],
    ]);
    expect(event!.competition).toMatchObject({
      key: 'ger.cup',
      name: 'DFB-Pokal',
      source: 'genre',
    });
    expect(event!.sport).toBe('football');
    expect(event!.kickOff?.at).toBe(Date.parse('2026-10-28T17:00:00Z'));
  });

  it('keeps a competition the dictionary does not know, by its own name', () => {
    const [event] = events([
      [{ name: 'Brabrand vs AC Horsens', genres: ['Football', 'Denmark DBU Pokalen'] }],
    ]);
    expect(event!.competition.name).toBe('Denmark DBU Pokalen');
    expect(event!.competition.key).toMatch(/^text:football:/);
  });

  it('reads a League line, a name prefix and the artwork', () => {
    const [line, prefix, art] = events([
      [
        {
          name: 'First Vienna vs SK Rapid',
          genres: ['OTHER'],
          description: '🏆 League: Austria Cup',
        },
      ],
      [{ name: 'Copa del Rey: Poblense vs Ceuta', genres: ['Soccer'] }],
      [
        {
          name: 'Canucks vs Ducks',
          genres: ['HOCKEY'],
          poster: 'https://img.example/m?lg=NHL&t1=a',
        },
      ],
    ]);
    expect(line!.competition.key).toBe('aut.cup');
    // The addon said OTHER; the competition the dictionary knows says football.
    expect(line!.sport).toBe('football');
    expect(prefix!.competition.key).toBe('esp.cup');
    expect(art!.competition.key).toBe('nhl');
  });

  it('names a bare "League Cup" the EFL Cup only for two English teams', () => {
    const [english, scottish] = events([
      [{ name: 'Arsenal vs Leeds United', genres: ['Football', 'League Cup'] }],
      [{ name: 'Celtic vs Rangers', genres: ['Football', 'League Cup'] }],
    ]);
    expect(english!.competition.key).toBe('eng.league-cup');
    expect(scottish!.competition.key).not.toBe('eng.league-cup');
  });

  it('falls back to the league calendar, then the country, never a guessed league', () => {
    const [derby, cup, scot, abroad] = events([
      [{ name: 'Arsenal vs Spurs', genres: ['Football'], releaseInfo: '31 Oct 2026 · 15:00 UTC' }],
      [{ name: 'Arsenal vs Spurs', genres: ['Football'], releaseInfo: '20 Jan 2027 · 20:00 UTC' }],
      [{ name: 'Celtic vs Rangers', genres: ['Football'] }],
      [{ name: 'Bayern Munich vs Arsenal', genres: ['Football'] }],
    ]);
    expect(derby!.competition).toMatchObject({ key: 'eng.1', source: 'calendar' });
    // Two Premier League clubs on a day with no league fixture: a cup tie, so only "English football".
    expect(cup!.competition).toMatchObject({ name: 'English football', source: 'country' });
    expect(scot!.competition.name).toBe('Scottish football');
    // Both in this season's Champions League.
    expect(abroad!.competition.key).toBe('uefa.cl');
  });

  it('gives a closed league its row from two of its teams', () => {
    const [nba] = events([[{ name: 'Lakers vs Knicks', genres: ['Basketball'] }]]);
    expect(nba!.competition.key).toBe('nba');
  });

  it('puts youth sides in their own group whatever league the addon names', () => {
    const [youth, trophy] = events([
      [
        {
          name: 'Manchester United U18 vs Burnley U18',
          genres: ['FOOTBALL'],
          description: 'League: English Premier League',
        },
      ],
      [{ name: 'Barnsley vs Arsenal U21', genres: ['Football', 'EFL Trophy'] }],
    ]);
    expect(youth!.competition.name).toBe('Youth football');
    // The EFL Trophy takes academy sides: the named cup stands.
    expect(trophy!.competition.key).toBe('eng.trophy');
  });

  it('groups every sport but football and the US leagues by sport, keeping the name as a note', () => {
    const [ipl, f1, euro, college] = events([
      [{ name: 'Mumbai Indians vs Chennai Super Kings', genres: ['Cricket', 'IPL'] }],
      [{ name: 'Formula 1: Mexican Grand Prix', genres: ['Motor Sports'] }],
      [{ name: 'Olympiacos BC vs Real Madrid', genres: ['Basketball', 'EuroLeague'] }],
      [
        {
          name: 'Missouri State vs Sam Houston State',
          genres: ['American Football', 'College Football'],
        },
      ],
    ]);
    expect(ipl!.competition.name).toBe('Cricket');
    expect(ipl!.note).toBe('Indian Premier League');
    expect(f1!.competition.name).toBe('Motor sport');
    expect(euro!.competition.name).toBe('Other basketball');
    expect(euro!.note).toBe('EuroLeague');
    expect(college!.competition.name).toBe('Other American football');
  });
});

describe('merging', () => {
  it('merges the same match across catalogs and addons, either order', () => {
    const merged = events([
      [
        {
          name: 'Manchester City vs Brighton',
          genres: ['Football', 'EFL Cup'],
          releaseInfo: '28 Oct 2026 · 19:30 UTC',
        },
      ],
      [
        {
          name: 'Brighton & Hove Albion vs Man City',
          genres: ['Soccer'],
          releaseInfo: '28 Oct 2026 · 19:30 UTC',
        },
        { addonIndex: 1, addonId: 'other.addon' },
      ],
      [
        { name: 'Man City v Brighton', genres: ['Soccer'], releaseInfo: '28 Oct 2026 19:40 ET' },
        { addonIndex: 2, addonId: 'third.addon' },
      ],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.sources).toHaveLength(2);
    expect(merged[0]!.home).toBe('Manchester City');
    // 19:40 ET is hours away from 19:30 UTC: another match, or a wrong zone; kept apart.
    expect(merged[1]!.sources).toHaveLength(1);
  });

  it('merges unsure times within 90 minutes', () => {
    const merged = events([
      [{ name: 'Celtic vs Rangers', genres: ['Football'], releaseInfo: '28 Oct 2026 · 19:45 UTC' }],
      [
        { name: 'Celtic vs Rangers', genres: ['Football'], releaseInfo: '28 Oct 2026 21:00' },
        { addonIndex: 1, addonId: 'b' },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kickOff?.sure).toBe(true);
  });

  it('keeps game numbers apart', () => {
    const merged = events([
      [{ name: 'Dodgers vs Yankees Game 1', genres: ['Baseball'] }],
      [{ name: 'Dodgers vs Yankees Game 2', genres: ['Baseball'] }],
    ]);
    expect(merged).toHaveLength(2);
  });

  it('lists repeats of one name without teams once per catalog item, never merged', () => {
    const merged = events([
      [{ name: 'Formula 1: Mexican Grand Prix', genres: ['F1'] }],
      [{ name: 'Formula 1: Mexican Grand Prix', genres: ['F1'] }],
    ]);
    expect(merged.length).toBeGreaterThanOrEqual(1);
    expect(new Set(merged.map((e) => e.key)).size).toBe(merged.length);
  });

  it('drops channels and placeholders', () => {
    const merged = events([
      [
        {
          id: 'leaf:now-1',
          name: '(FHD) : SKY SPORTS PREMIER LEAGUE',
          genres: ['Football', 'NOW-34334'],
          releaseInfo: 'LIVE',
        },
      ],
      [{ name: 'No live streams right now', genres: ['Sports'] }],
      [{ name: '🔴 LIVE: NCIS S24, E4', genres: ['OTHER'], releaseInfo: 'LIVE' }],
      [{ name: '24/7 Classic Football', releaseInfo: '24/7' }],
    ]);
    expect(merged).toHaveLength(0);
  });

  it('keeps a kick-off the addon replaced with LIVE', () => {
    const kickOff: KickOff = {
      at: Date.parse('2026-10-28T11:30:00Z'),
      sure: true,
      source: 'remembered',
    };
    const [event] = events(
      [[{ name: 'Celtic vs Rangers', genres: ['Football'], releaseInfo: 'LIVE' }]],
      {
        remembered: () => kickOff,
      },
    );
    expect(event!.kickOff).toEqual(kickOff);
    expect(event!.liveLabel).toBe(true);
  });

  it('lets the dictionary sport win over a wrong tag', () => {
    const [event] = events([
      [{ name: 'Barnsley vs Leeds United', genres: ['Tennis', 'EFL Trophy'] }],
    ]);
    expect(event!.sport).toBe('football');
    expect(event!.competition.key).toBe('eng.trophy');
  });
});
