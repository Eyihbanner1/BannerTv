import { type MetaPreview, parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createMatcher } from './dictionary';
import { buildEvents, replayedKeys } from './events';
import mini from './fixtures/mini-data.json';
import { type CatalogContext, readListing } from './listing';
import type { KickOff, SportsData } from './types';
import { eventState } from './view';

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

  it('merges unsure times within 90 minutes, and sure ones only within 15', () => {
    const celtic = (
      releaseInfo: string,
    ): Array<[Record<string, unknown>, Partial<CatalogContext>?]> => [
      [{ name: 'Celtic vs Rangers', genres: ['Football'], releaseInfo: '28 Oct 2026 · 19:45 UTC' }],
      [
        { name: 'Celtic vs Rangers', genres: ['Football'], releaseInfo },
        { addonIndex: 1, addonId: 'b' },
      ],
    ];
    // 21:00 CEST is 19:00 UTC, in a zone an abbreviation only suggests: 45 minutes apart.
    const unsure = events(celtic('28 Oct 2026 21:00 CEST'));
    expect(unsure).toHaveLength(1);
    expect(unsure[0]!.kickOff).toMatchObject({
      at: Date.parse('2026-10-28T19:45:00Z'),
      sure: true,
    });
    expect(events(celtic('28 Oct 2026 · 19:00 UTC'))).toHaveLength(2);
    // 23:30 CEST is 21:30 UTC: more than 90 minutes on.
    expect(events(celtic('28 Oct 2026 23:30 CEST'))).toHaveLength(2);
  });

  it('keeps game numbers apart', () => {
    const merged = events([
      [{ name: 'Dodgers vs Yankees Game 1', genres: ['Baseball'] }],
      [{ name: 'Dodgers vs Yankees Game 2', genres: ['Baseball'] }],
    ]);
    expect(merged).toHaveLength(2);
  });

  it('lists repeats of one name without teams once, with every item as a source', () => {
    const merged = events([
      [{ name: 'Formula 1: Mexican Grand Prix', genres: ['F1'] }],
      [{ name: 'Formula 1: Mexican Grand Prix', genres: ['F1'] }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources).toHaveLength(2);
  });

  it("keeps men's, women's and youth matches of the same clubs apart", () => {
    const merged = events([
      [
        {
          name: 'Arsenal vs Chelsea',
          genres: ['Football'],
          releaseInfo: '28 Oct 2026 · 20:00 UTC',
        },
      ],
      [{ name: 'Arsenal Women vs Chelsea Women', genres: ['Football'] }, { addonIndex: 1 }],
      [{ name: 'Arsenal U21 vs Chelsea U21', genres: ['Football'] }, { addonIndex: 2 }],
      [{ name: 'Arsenal Ladies vs Chelsea Ladies', genres: ['Football'] }, { addonIndex: 3 }],
      [{ name: 'Arsenal II vs Chelsea II', genres: ['Football'] }, { addonIndex: 4 }],
    ]);
    expect(merged.map((e) => e.sources.map((s) => s.addonIndex))).toEqual([[0], [1, 3], [2], [4]]);
  });

  it('merges a club whose own name ends in "II" with a copy that leaves it off', () => {
    const merged = events([
      [{ name: 'SSV Jeddeloh II vs Hertha BSC', genres: ['Football', 'DFB-Pokal'] }],
      [{ name: 'SSV Jeddeloh vs Hertha BSC', genres: ['Football'] }, { addonIndex: 1 }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.competition.key).toBe('ger.cup');
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
      [{ name: 'No more events today', genres: ['Sports'] }],
      [{ name: 'No upcoming matches', genres: ['Football'] }],
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

  it('takes a closed league over a wrong tag, but football clubs never over basketball', () => {
    const [hockey, basketball] = events([
      // An addon that tags its NHL games Fútbol.
      [{ name: 'Canucks vs Ducks', genres: ['Fútbol'] }],
      // Real Madrid and Inter play basketball too; only the NBA is in the dictionary for it.
      [{ name: 'Real Madrid vs Inter', genres: ['Basketball'] }],
    ]);
    expect(hockey!.sport).toBe('ice-hockey');
    expect(hockey!.competition.key).toBe('nhl');
    expect(basketball!.sport).toBe('basketball');
    expect(basketball!.competition.name).toBe('Other basketball');
  });

  it('takes the sport a named competition gives over the tag and over football clubs', () => {
    const [tennis, euroleague, hockey, wsl] = events([
      [
        {
          name: 'ATP Paris Masters: Jannik Sinner vs Carlos Alcaraz',
          genres: ['Fútbol'],
          releaseInfo: '28 Oct 2026 · 12:00 UTC',
        },
      ],
      [{ name: 'EuroLeague: Real Madrid vs Inter', genres: ['Fútbol'] }],
      // Two teams of one closed league settle it, whatever the addon calls the competition.
      [
        {
          name: 'Canucks vs Ducks',
          genres: ['Fútbol'],
          description: 'League: Fútbol Internacional',
        },
      ],
      [
        {
          name: 'Arsenal Women vs Manchester United Women',
          genres: ['Football', "Women's Super League"],
        },
      ],
    ]);
    expect(tennis!.sport).toBe('tennis');
    expect(tennis!.competition.name).toBe('Tennis');
    expect(tennis!.note).toBe('ATP Paris Masters');
    expect(euroleague!.sport).toBe('basketball');
    expect(euroleague!.competition.name).toBe('Other basketball');
    expect(euroleague!.note).toBe('EuroLeague');
    expect(hockey!.sport).toBe('ice-hockey');
    expect(wsl!.sport).toBe('football');
    expect(wsl!.competition.key).toBe('eng.wsl');
  });

  it('reads the sport of a darts or football name, not of its "Grand Prix" or "Super League"', () => {
    const [darts, isl] = events([
      [{ name: 'PDC World Grand Prix', genres: ['Darts'] }, { sport: 'darts' }],
      [{ name: 'Indian Super League', genres: ['Football'] }],
    ]);
    expect(darts!.sport).toBe('darts');
    expect(isl!.sport).toBe('football');
  });
});

describe('one team known', () => {
  it('puts two youth sides in Youth football, whichever one is known', () => {
    const [youth] = events([[{ name: 'Zrinjski U19 vs Rangers U19', genres: ['Football'] }]]);
    expect(youth!.competition.name).toBe('Youth football');
  });

  it('keeps a senior side against an unknown youth side in its country group', () => {
    const [trophy] = events([[{ name: 'Barnsley vs Wrexham U21', genres: ['Football'] }]]);
    expect(trophy!.competition.name).toBe('English football');
  });

  it("puts a women's tie in Women's football, and a tie against a club from anywhere in Other", () => {
    const [women, abroad, unknownCup] = events([
      [{ name: 'Servette FC Chenois Feminin vs Arsenal', genres: ['Football'] }],
      [{ name: 'Arsenal vs Gamba Osaka', genres: ['Football'] }],
      [
        {
          name: 'OL Lyonnes vs Inter',
          genres: ['Football'],
          background: 'https://img.example/api/v1/unique-tournament/696/image',
        },
      ],
    ]);
    expect(women!.competition.name).toBe("Women's football");
    expect(abroad!.competition.name).toBe('Other football');
    expect(unknownCup!.competition.name).toBe('Other football');
  });

  it("reads a women's match from one side's mark, never as the men's league", () => {
    const [derby] = events([
      [{ name: 'Arsenal Women vs Manchester United', genres: ['Football', 'Premier League'] }],
    ]);
    expect(derby!.competition.name).toBe("English women's football");
  });
});

describe('replays', () => {
  const live = { addonIndex: 0, catalogId: 'live' };
  const recaps = { addonIndex: 1, addonId: 'replays.addon', catalogId: 'recaps', replays: true };

  it('ends only the match a replay is of, never a later meeting of the same sides', () => {
    const built = events([
      [
        {
          name: 'Toronto Blue Jays vs Los Angeles Dodgers',
          genres: ['Baseball'],
          released: '2026-10-28T00:00:00Z',
        },
        live,
      ],
      // Last meeting's replay, and tonight's: dated by the day, as replays are.
      [
        {
          name: 'Toronto Blue Jays vs Los Angeles Dodgers',
          genres: ['Baseball'],
          released: '2026-10-25T00:00:00Z',
        },
        recaps,
      ],
    ]);
    const game = built.find((e) => e.kind === 'event')!;
    expect(replayedKeys(built).size).toBe(0);
    expect(eventState(game, { now: Date.parse('2026-10-28T00:30:00Z') })).toBe('live');

    const tonight = events([
      [
        {
          name: 'Toronto Blue Jays vs Los Angeles Dodgers',
          genres: ['Baseball'],
          released: '2026-10-28T00:00:00Z',
        },
        live,
      ],
      [
        {
          name: 'Toronto Blue Jays vs Los Angeles Dodgers',
          genres: ['Baseball'],
          released: '2026-10-28T00:00:00Z',
        },
        recaps,
      ],
    ]);
    expect(replayedKeys(tonight)).toEqual(new Set([tonight.find((e) => e.kind === 'event')!.key]));
  });

  it('keeps game numbers, an earlier game that day and women’s sides apart', () => {
    const built = events([
      [
        {
          name: 'Dodgers vs Yankees Game 2',
          genres: ['Baseball'],
          released: '2026-10-28T19:00:00Z',
        },
        live,
      ],
      [
        {
          name: 'Dodgers vs Yankees Game 1',
          genres: ['Baseball'],
          released: '2026-10-28T00:00:00Z',
        },
        recaps,
      ],
      [{ name: 'Celtic vs Rangers', genres: ['Football'], released: '2026-10-28T19:00:00Z' }, live],
      // The first game of a double-header, at its own kick-off.
      [
        { name: 'Celtic vs Rangers', genres: ['Football'], released: '2026-10-28T13:00:00Z' },
        recaps,
      ],
      [
        { name: 'Arsenal vs Chelsea', genres: ['Football'], released: '2026-10-28T19:00:00Z' },
        live,
      ],
      [
        {
          name: 'Arsenal Women vs Chelsea Women',
          genres: ['Football'],
          released: '2026-10-28T00:00:00Z',
        },
        recaps,
      ],
    ]);
    expect(replayedKeys(built).size).toBe(0);
    const ended = events([
      [{ name: 'Celtic vs Rangers', genres: ['Football'], released: '2026-10-28T19:00:00Z' }, live],
      // The same match, listed at its own kick-off an hour off.
      [
        { name: 'Celtic vs Rangers', genres: ['Football'], released: '2026-10-28T18:00:00Z' },
        recaps,
      ],
    ]);
    expect(replayedKeys(ended).size).toBe(1);
  });
});

describe('team badges', () => {
  const LAKERS = 'https://img.example/lakers.png';
  const BLAZERS = 'https://img.example/blazers.png';

  it('carries the badges an addon sends with its teams to the event', () => {
    const [event] = events([
      [
        {
          name: 'Los Angeles Lakers vs Portland Trail Blazers',
          genres: ['Basketball'],
          team1: { name: 'Los Angeles Lakers', logo: LAKERS },
          team2: { name: 'Portland Trail Blazers', logo: BLAZERS },
        },
      ],
    ]);
    expect(event!.home).toBe('Los Angeles Lakers');
    expect(event!.homeLogo).toBe(LAKERS);
    expect(event!.awayLogo).toBe(BLAZERS);
  });

  it('puts a badge on the side its name is, when the name gives the sides', () => {
    // One team sent, and an "Away at Home" name: the badge is the away side's.
    const [event] = events([
      [
        {
          name: 'Portland Trail Blazers at Los Angeles Lakers',
          genres: ['Basketball'],
          team1: { name: 'Portland Trail Blazers', logo: BLAZERS },
        },
      ],
    ]);
    expect(event!.home).toBe('Los Angeles Lakers');
    expect(event!.homeLogo).toBeUndefined();
    expect(event!.awayLogo).toBe(BLAZERS);
  });

  it('carries the badges of a copy that names the teams the other way round', () => {
    const [event] = events([
      [{ name: 'Los Angeles Lakers vs Portland Trail Blazers', genres: ['Basketball'] }],
      [
        {
          name: 'Portland Trail Blazers vs Los Angeles Lakers',
          genres: ['Basketball'],
          team1: { name: 'Portland Trail Blazers', logo: BLAZERS },
          team2: { name: 'Los Angeles Lakers', logo: LAKERS },
        },
        { addonIndex: 1, addonId: 'b' },
      ],
    ]);
    expect(event!.sources).toHaveLength(2);
    expect(event!.home).toBe('Los Angeles Lakers');
    expect(event!.homeLogo).toBe(LAKERS);
    expect(event!.awayLogo).toBe(BLAZERS);
  });

  it('drops a badge whose name is neither side', () => {
    const [event] = events([
      [
        {
          name: 'Los Angeles Lakers vs Portland Trail Blazers',
          genres: ['Basketball'],
          team1: { name: 'Boston Celtics', logo: LAKERS },
        },
      ],
    ]);
    expect(event!.homeLogo).toBeUndefined();
    expect(event!.awayLogo).toBeUndefined();
  });
});

describe('the sport the addon gives', () => {
  it('takes a catalog per sport over a name that is itself a sport', () => {
    // A darts catalog's "Grand Prix" is darts; a name alone would say motor sport.
    const [darts] = events([[{ name: 'World Grand Prix', genres: [] }, { sport: 'darts' }]]);
    expect(darts!.sport).toBe('darts');
    const [racing] = events([[{ name: 'Horse Racing', genres: ['Sports'] }]]);
    expect(racing!.sport).toBe('other');
  });

  it('takes the sport of the genre page the item was asked from', () => {
    // StremVerse lists "Indian Super League" with no genres, on its genre=Football page.
    const [onPage] = events([
      [{ name: 'Indian Super League', genres: [] }, { genreOption: 'Football' }],
    ]);
    expect(onPage!.sport).toBe('football');
    // The same item on the page with every sport says nothing of its sport.
    const [onLive] = events([[{ name: 'Indian Super League', genres: [] }]]);
    expect(onLive!.sport).toBe('other');
  });
});
