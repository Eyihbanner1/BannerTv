import type { Matcher } from './dictionary';
import type { Listing, Side } from './listing';
import { sortStable } from './sort';
import { AWAY_FIRST_SPORTS } from './sport';
import { competitionKey, foldText, slugOf, teamKey } from './text';
import type {
  Competition,
  CompetitionEntry,
  CompetitionSource,
  KickOff,
  KickOffSource,
  Sport,
  SportEvent,
  TeamEntry,
} from './types';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Leagues whose teams play no one else, so two of their teams name the league. */
const CLOSED_LEAGUES = new Set(['nfl', 'nba', 'nhl', 'mlb']);

// Country codes counted as Europe for "European football".
const EUROPE = new Set([
  'EU',
  'AD',
  'AL',
  'AM',
  'AT',
  'AZ',
  'BA',
  'BE',
  'BG',
  'BY',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FO',
  'FR',
  'GE',
  'GI',
  'GR',
  'HR',
  'HU',
  'IE',
  'IL',
  'IS',
  'IT',
  'KZ',
  'LI',
  'LT',
  'LU',
  'LV',
  'MC',
  'MD',
  'ME',
  'MK',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'RS',
  'RU',
  'SE',
  'SI',
  'SK',
  'SM',
  'TR',
  'UA',
  'XK',
]);

function isEuropean(code: string): boolean {
  return code.indexOf('GB') === 0 || EUROPE.has(code);
}

const SOURCE_RANK: Record<CompetitionSource, number> = {
  'genre-option': 0,
  description: 1,
  'name-prefix': 2,
  'name-suffix': 3,
  genre: 4,
  artwork: 5,
  calendar: 6,
  teams: 7,
  country: 8,
  other: 9,
};

const TIME_RANK: Record<KickOffSource, number> = {
  released: 0,
  'dated-text': 1,
  remembered: 1,
  'name-clock': 2,
  'iso-key': 3,
  epoch: 4,
  clock: 5,
  estimated: 7,
  'date-only': 8,
};

/** Competitions the dictionary does not know sort after those it does, by number of matches. */
export const UNKNOWN_PRIORITY = 900;
const NON_FOOTBALL = 1000;
export const COUNTRY_PRIORITY = 2000;
export const OTHER_PRIORITY = 3000;

const SPORT_WORDS: Record<Sport, string> = {
  football: 'football',
  basketball: 'basketball',
  'american-football': 'American football',
  'ice-hockey': 'ice hockey',
  baseball: 'baseball',
  tennis: 'tennis',
  cricket: 'cricket',
  rugby: 'rugby',
  motorsport: 'motor sport',
  boxing: 'boxing',
  mma: 'MMA',
  golf: 'golf',
  darts: 'darts',
  snooker: 'snooker',
  'aussie-rules': 'Aussie rules',
  other: 'sport',
};

export function sportWord(sport: Sport): string {
  return SPORT_WORDS[sport];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface BuildOptions {
  matcher?: Matcher;
  /** A kick-off seen earlier for this item, kept after the addon replaced it with LIVE. */
  remembered?: (addonId: string, id: string) => KickOff | undefined;
}

/** One item with every copy the same addon listed in other catalogs folded in. */
interface Combined {
  listing: Listing;
  copies: Listing[];
  kickOff?: KickOff;
  liveLabel: boolean;
  competitions: Listing['competitions'];
  suffixes: string[];
  sofascore?: number;
  round?: string;
  sequence?: string;
  sides?: [Side, Side];
  teams?: [TeamEntry | undefined, TeamEntry | undefined];
  /** Sides that count as teams: trusted by their separator, or both known teams. */
  teamsOk: boolean;
}

function betterTime(a: KickOff | undefined, b: KickOff | undefined): KickOff | undefined {
  if (!a) return b;
  if (!b) return a;
  const rankA = TIME_RANK[a.source] + (a.sure ? 0 : 0.5);
  const rankB = TIME_RANK[b.source] + (b.sure ? 0 : 0.5);
  return rankB < rankA ? b : a;
}

function combineCopies(listings: readonly Listing[], options: BuildOptions): Combined[] {
  const byItem = new Map<string, Combined>();
  const out: Combined[] = [];
  for (const listing of listings) {
    if (listing.kind === 'placeholder' || listing.kind === 'channel') continue;
    const key = `${listing.source.addonIndex}\u0000${listing.source.id}`;
    let combined = byItem.get(key);
    if (!combined) {
      combined = {
        listing,
        copies: [],
        liveLabel: false,
        competitions: [],
        suffixes: [],
        teamsOk: false,
      };
      byItem.set(key, combined);
      out.push(combined);
    }
    combined.copies.push(listing);
    combined.kickOff = betterTime(combined.kickOff, listing.kickOff);
    combined.liveLabel = combined.liveLabel || listing.liveLabel;
    for (const entry of listing.competitions) {
      if (!combined.competitions.some((c) => c.text === entry.text && c.source === entry.source)) {
        combined.competitions.push(entry);
      }
    }
    if (listing.suffix && combined.suffixes.indexOf(listing.suffix) === -1) {
      combined.suffixes.push(listing.suffix);
    }
    if (combined.sofascore === undefined && listing.sofascore !== undefined) {
      combined.sofascore = listing.sofascore;
    }
    if (!combined.round && listing.round) combined.round = listing.round;
    if (!combined.sequence && listing.sequence) combined.sequence = listing.sequence;
    if (!combined.sides && listing.sides) {
      combined.sides = listing.sides;
      combined.teamsOk = listing.teamsTrusted;
    }
  }
  for (const combined of out) {
    if (combined.kickOff?.at === undefined && options.remembered) {
      const remembered = options.remembered(
        combined.listing.source.addonId,
        combined.listing.source.id,
      );
      if (remembered) combined.kickOff = betterTime(combined.kickOff, remembered);
    }
    combined.competitions = sortStable(
      combined.competitions,
      (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
    );
  }
  return out;
}

function lookupTeams(combined: Combined, matcher: Matcher | undefined): void {
  const sides = combined.sides;
  if (!sides || !matcher) return;
  const sport = combined.listing.addonSport;
  // An addon's sport tag is often wrong: look in its sport first, then in any.
  const find = (side: Side) => {
    const base = side.key;
    return (sport ? matcher.team(base, sport) : undefined) ?? matcher.team(base);
  };
  const home = find(sides[0]);
  const away = find(sides[1]);
  combined.teams = [home, away];
  // Two known teams make any separator a match, "Away at Home" outside US sports included.
  if (home && away) combined.teamsOk = true;
}

function sportOfCombined(combined: Combined): Sport {
  const [home, away] = combined.teams ?? [];
  // When both teams are in the dictionary, its sport wins over the addon's tag.
  if (home && away && home.sport === away.sport) return home.sport;
  if (combined.listing.addonSport) return combined.listing.addonSport;
  return home?.sport ?? away?.sport ?? 'other';
}

function compatibleTimes(a: KickOff | undefined, b: KickOff | undefined): boolean {
  if (!a || !b) return true;
  if (a.at !== undefined && b.at !== undefined) {
    const limit = a.sure && b.sure ? 15 * MINUTE : 90 * MINUTE;
    return Math.abs(a.at - b.at) <= limit;
  }
  const dayA =
    a.at !== undefined ? Math.floor(a.at / DAY) : Date.parse(`${a.date}T00:00:00Z`) / DAY;
  const dayB =
    b.at !== undefined ? Math.floor(b.at / DAY) : Date.parse(`${b.date}T00:00:00Z`) / DAY;
  return isNaN(dayA) || isNaN(dayB) || Math.abs(dayA - dayB) <= 1;
}

function canonicalKey(side: Side, team: TeamEntry | undefined): string {
  return team ? teamKey(team.name) : side.key;
}

function bucketKey(combined: Combined): string {
  const kind = combined.listing.kind;
  if (combined.sides && combined.teamsOk) {
    const [a, b] = [
      canonicalKey(combined.sides[0], combined.teams?.[0]),
      canonicalKey(combined.sides[1], combined.teams?.[1]),
    ];
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    return `${kind}|teams|${pair}|${combined.sequence ?? ''}`;
  }
  return `${kind}|title|${foldText(combined.listing.title)}`;
}

interface Cluster {
  members: Combined[];
  kickOff?: KickOff;
}

function competitionFromEntry(entry: CompetitionEntry, source: CompetitionSource): Competition {
  const competition: Competition = {
    key: entry.id,
    name: entry.name,
    sport: entry.sport,
    priority: entry.sport === 'football' ? entry.priority : Math.max(entry.priority, NON_FOOTBALL),
    source,
  };
  if (entry.country) competition.country = entry.country;
  return competition;
}

function textCompetition(text: string, sport: Sport, source: CompetitionSource): Competition {
  return {
    key: `text:${sport}:${competitionKey(text)}`,
    name: text,
    sport,
    priority: sport === 'football' ? UNKNOWN_PRIORITY : NON_FOOTBALL + UNKNOWN_PRIORITY,
    source,
  };
}

function groupCompetition(
  key: string,
  name: string,
  sport: Sport,
  priority: number,
  source: CompetitionSource,
): Competition {
  return { key: `${key}:${sport}`, name, sport, priority, source };
}

function countryGroup(
  team: TeamEntry,
  sport: Sport,
  matcher: Matcher,
  women: boolean,
): Competition {
  const country = matcher.country(team.country);
  let adjective = country ? country.adjective : team.country;
  // "American football" is another sport.
  if (adjective === 'American' && sport === 'football') adjective = 'US';
  const name = `${adjective} ${women ? "women's " : ''}${sportWord(sport)}`;
  const competition = groupCompetition(
    `country:${team.country}${women ? ':women' : ''}`,
    name,
    sport,
    COUNTRY_PRIORITY,
    'country',
  );
  competition.country = team.country;
  return competition;
}

/** The competition named by the items themselves (docs/PLAN.md, Grouping, layers 1 and 2). */
function namedCompetition(
  members: readonly Combined[],
  sport: Sport,
  teams: [TeamEntry | undefined, TeamEntry | undefined],
  matcher: Matcher | undefined,
): Competition | undefined {
  let best: { competition: Competition; rank: number; known: boolean } | undefined;
  const consider = (competition: Competition, rank: number, known: boolean) => {
    if (!best || rank < best.rank || (rank === best.rank && known && !best.known)) {
      best = { competition, rank, known };
    }
  };
  for (const member of members) {
    for (const { text, source } of member.competitions) {
      const rank = SOURCE_RANK[source];
      if (best && rank > best.rank) break;
      let entry = matcher?.competition(text, sport);
      // A bare "League Cup" is the EFL Cup only when both teams are English.
      if (!entry && matcher && /^(?:england\W+)?league cup$/i.test(foldText(text).trim())) {
        if (teams[0]?.country === 'GB-ENG' && teams[1]?.country === 'GB-ENG') {
          entry = matcher.competition('EFL Cup', 'football');
        }
      }
      if (entry) consider(competitionFromEntry(entry, source), rank, true);
      else consider(textCompetition(text, sport, source), rank, false);
    }
    if (matcher) {
      for (const suffix of member.suffixes) {
        const entry = matcher.competition(suffix, sport);
        if (entry)
          consider(competitionFromEntry(entry, 'name-suffix'), SOURCE_RANK['name-suffix'], true);
      }
      if (member.sofascore !== undefined) {
        const entry = matcher.sofascore(member.sofascore);
        if (entry) consider(competitionFromEntry(entry, 'artwork'), SOURCE_RANK.artwork, true);
      }
    }
  }
  // An entry of another sport is the addon's sport tag being wrong only when the teams agree.
  return best?.competition;
}

/** The team matcher and league calendars (docs/PLAN.md, Grouping, layer 3). */
function teamCompetition(
  members: readonly Combined[],
  sport: Sport,
  kickOff: KickOff | undefined,
  matcher: Matcher,
): Competition | undefined {
  const first = members.find((member) => member.teams && member.teamsOk);
  if (!first?.sides || !first.teams) return undefined;
  const [home, away] = first.teams;
  // The addon named a SofaScore competition the dictionary does not know (a women's or
  // youth cup, say): the teams' usual league or UEFA campaign would be a guess.
  const unknownTournament = members.some(
    (member) => member.sofascore !== undefined && !matcher.sofascore(member.sofascore),
  );
  const [homeMarks, awayMarks] = [first.sides[0].marks, first.sides[1].marks];
  const youthHome = homeMarks.youth || homeMarks.reserve;
  const youthAway = awayMarks.youth || awayMarks.reserve;
  const women = homeMarks.women && awayMarks.women;

  if (home && away) {
    if (youthHome && youthAway) {
      return groupCompetition(
        'group:youth',
        `Youth ${sportWord(sport)}`,
        sport,
        COUNTRY_PRIORITY,
        'country',
      );
    }
    if (youthHome !== youthAway)
      return countryGroup(youthHome ? away : home, sport, matcher, women);
    if (women) {
      return home.country === away.country
        ? countryGroup(home, sport, matcher, true)
        : groupCompetition(
            'group:women',
            `Women's ${sportWord(sport)}`,
            sport,
            COUNTRY_PRIORITY,
            'country',
          );
    }
    if (unknownTournament) {
      return home.country === away.country
        ? countryGroup(home, sport, matcher, false)
        : isEuropean(home.country) && isEuropean(away.country)
          ? groupCompetition(
              'group:europe',
              `European ${sportWord(sport)}`,
              sport,
              COUNTRY_PRIORITY,
              'country',
            )
          : groupCompetition(
              'group:international',
              `International ${sportWord(sport)}`,
              sport,
              COUNTRY_PRIORITY,
              'country',
            );
    }
    if (home.league && home.league === away.league) {
      const league = matcher.competitionById(home.league);
      if (league && CLOSED_LEAGUES.has(home.league)) return competitionFromEntry(league, 'teams');
      if (league && matcher.inCalendar(home.league, home, away, kickOff?.at, kickOff?.date)) {
        return competitionFromEntry(league, 'calendar');
      }
    }
    if (home.country === away.country) return countryGroup(home, sport, matcher, false);
    const uefa = matcher.sharedUefa(home, away);
    if (uefa) return competitionFromEntry(uefa, 'teams');
    if (isEuropean(home.country) && isEuropean(away.country)) {
      return groupCompetition(
        'group:europe',
        `European ${sportWord(sport)}`,
        sport,
        COUNTRY_PRIORITY,
        'country',
      );
    }
    return groupCompetition(
      'group:international',
      `International ${sportWord(sport)}`,
      sport,
      COUNTRY_PRIORITY,
      'country',
    );
  }
  const known = home ?? away;
  if (known && known.sport === sport) return countryGroup(known, sport, matcher, women);
  return undefined;
}

/** A senior or men's competition named over two youth or two women's sides. */
function wrongLevel(competition: Competition, sides: [Side, Side], matcher: Matcher): boolean {
  const entry = matcher.competitionById(competition.key);
  if (!entry) return false;
  const [home, away] = sides;
  const youth =
    (home.marks.youth || home.marks.reserve) && (away.marks.youth || away.marks.reserve);
  if (youth && !entry.youth) return true;
  return home.marks.women && away.marks.women && !entry.women;
}

/** The four US leagues that get competition rows, by the sport each plays. */
const US_LEAGUES: Record<string, Sport> = {
  nfl: 'american-football',
  nba: 'basketball',
  nhl: 'ice-hockey',
  mlb: 'baseball',
};

/**
 * Competition rows are for football and the four US leagues; every other
 * sport is one row per sport, and the rest of American football, basketball,
 * ice hockey and baseball goes in its "Other" row (Eyitayo, 28 October 2026).
 * What the addon called the competition stays on the tile as a note.
 */
function rowCompetition(
  competition: Competition,
  sport: Sport,
): { competition: Competition; note?: string } {
  if (sport === 'football') return { competition };
  const named = competition.source !== 'country' && competition.source !== 'other';
  const note = named ? competition.name : undefined;
  const textKey = /^text:[^:]+:(nfl|nba|nhl|mlb)$/.exec(competition.key);
  const league = textKey ? textKey[1]! : competition.key;
  if (US_LEAGUES[league] !== undefined) {
    if (US_LEAGUES[league] === sport) return { competition };
    return { competition: otherCompetition(sport), note };
  }
  if (
    sport === 'american-football' ||
    sport === 'basketball' ||
    sport === 'ice-hockey' ||
    sport === 'baseball' ||
    sport === 'other'
  ) {
    return { competition: otherCompetition(sport), note };
  }
  const bySport = groupCompetition(
    'sport',
    capitalise(sportWord(sport)),
    sport,
    NON_FOOTBALL + 500,
    'other',
  );
  return note === undefined ? { competition: bySport } : { competition: bySport, note };
}

function otherCompetition(sport: Sport): Competition {
  const name = sport === 'other' ? 'Other sport' : `Other ${sportWord(sport)}`;
  return groupCompetition('other', name, sport, OTHER_PRIORITY, 'other');
}

function clusterize(combined: readonly Combined[]): Cluster[] {
  const buckets = new Map<string, Cluster[]>();
  const clusters: Cluster[] = [];
  for (const item of combined) {
    const key = bucketKey(item);
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    let cluster = list.find((c) => compatibleTimes(c.kickOff, item.kickOff));
    if (!cluster) {
      cluster = { members: [] };
      list.push(cluster);
      clusters.push(cluster);
    }
    cluster.members.push(item);
    cluster.kickOff = betterTime(cluster.kickOff, item.kickOff);
  }
  return clusters;
}

function chooseKickOff(members: readonly Combined[]): { kickOff?: KickOff; from?: Combined } {
  let best: KickOff | undefined;
  let from: Combined | undefined;
  for (const member of members) {
    const better = betterTime(best, member.kickOff);
    if (better !== best) {
      best = better;
      from = member;
    }
  }
  return { kickOff: best, from };
}

/**
 * Turns every listing of every sports catalog into events: copies of one
 * item folded together, the same match merged across catalogs and addons,
 * and each given its sport and competition (docs/PLAN.md, Merging and
 * Grouping). Listings must come in collection order, so the first addon wins
 * ties.
 */
export function buildEvents(
  listings: readonly Listing[],
  options: BuildOptions = {},
): SportEvent[] {
  const { matcher } = options;
  const combined = combineCopies(listings, options);
  for (const item of combined) lookupTeams(item, matcher);
  const clusters = clusterize(combined);

  const events: SportEvent[] = [];
  const keys = new Set<string>();
  for (const cluster of clusters) {
    // The first addon in the collection's order leads.
    const members = sortStable(
      cluster.members,
      (a, b) => a.listing.source.addonIndex - b.listing.source.addonIndex,
    );
    const lead = members[0]!;
    let sport = sportOfCombined(members.find((m) => m.teams?.[0] && m.teams?.[1]) ?? lead);
    const { kickOff, from } = chooseKickOff(members);
    // Home and away: an "Away at Home" listing knows best, then the one the time came from.
    const sided =
      members.find(
        (m) => m.sides && m.teamsOk && m.listing.separator === 'at' && AWAY_FIRST_SPORTS.has(sport),
      ) ??
      (from?.sides && from.teamsOk ? from : undefined) ??
      members.find((m) => m.sides && m.teamsOk);
    const teams: [TeamEntry | undefined, TeamEntry | undefined] = sided?.teams ?? [
      undefined,
      undefined,
    ];

    let named =
      namedCompetition(members, sport, teams, matcher) ??
      (matcher ? teamCompetition(members, sport, kickOff, matcher) : undefined);
    // "English Premier League" over two U18 sides is their league, not the Premier League.
    if (named && matcher && sided?.sides && wrongLevel(named, sided.sides, matcher)) {
      named =
        teamCompetition(members, sport, kickOff, matcher) ??
        groupCompetition(
          'group:youth',
          `Youth ${sportWord(sport)}`,
          sport,
          COUNTRY_PRIORITY,
          'country',
        );
    }
    // No sport from the addon or the teams: a competition the dictionary knows gives one.
    if (sport === 'other' && named && named.sport !== 'other') sport = named.sport;
    const resolved = rowCompetition(named ?? otherCompetition(sport), sport);
    const competition = resolved.competition;
    const round = members.find((m) => m.round)?.round;
    if (round) competition.round = round;

    let key = `${lead.listing.source.addonIndex}-${slugOf(lead.listing.source.id)}`;
    for (let n = 2; keys.has(key); n++)
      key = `${lead.listing.source.addonIndex}-${slugOf(lead.listing.source.id)}-${n}`;
    keys.add(key);

    const event: SportEvent = {
      key,
      kind: lead.listing.kind === 'replay' ? 'replay' : 'event',
      sport,
      title: lead.listing.title,
      competition,
      liveLabel: members.some((m) => m.liveLabel),
      sources: [],
      teamKeys: [],
    };
    if (kickOff) event.kickOff = kickOff;
    if (resolved.note) event.note = resolved.note;
    if (sided?.sides) {
      event.home = sided.sides[0].name;
      event.away = sided.sides[1].name;
      event.teamKeys = [
        canonicalKey(sided.sides[0], teams[0]),
        canonicalKey(sided.sides[1], teams[1]),
      ];
    }
    for (const member of members) {
      for (const copy of member.copies) {
        if (
          !event.sources.some(
            (s) => s.addonIndex === copy.source.addonIndex && s.id === copy.source.id,
          )
        ) {
          event.sources.push(copy.source);
        }
      }
    }
    events.push(event);
  }
  return events;
}

/** Whether a replay of this match has appeared, which ends it however long its window. */
export function replayedKeys(events: readonly SportEvent[]): Set<string> {
  const pairs = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'replay' || event.teamKeys.length !== 2) continue;
    const [a, b] = event.teamKeys as [string, string];
    pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  const ended = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'event' || event.teamKeys.length !== 2) continue;
    const [a, b] = event.teamKeys as [string, string];
    if (pairs.has(a < b ? `${a}|${b}` : `${b}|${a}`)) ended.add(event.key);
  }
  return ended;
}
