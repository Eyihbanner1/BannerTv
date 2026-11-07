import type { Matcher } from './dictionary';
import type { Listing, Side } from './listing';
import { sortStable } from './sort';
import { AWAY_FIRST_SPORTS, sportOf, TEAM_SPORTS } from './sport';
import { competitionKey, foldText, type SideMarks, slugOf, teamKey } from './text';
import { addDays, localDate } from './time';
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

/** Whether a value is one of the sports BannerTV tells apart, as a saved or synced value says. */
export function isSport(value: unknown): value is Sport {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPORT_WORDS, value);
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
  // An addon's sport tag is often wrong: look in its sport first, then in any. A club of
  // another sport overrules the tag only where the tag cannot be right (an EFL Trophy tie
  // tagged Tennis), or for a club of a closed league (NHL games tagged Fútbol), whose names
  // no one else uses. Clubs elsewhere share names across sports: Real Madrid and Olympiacos
  // play basketball too, and only the NBA's teams are in the dictionary for it.
  const find = (side: Side) => {
    if (!sport) return matcher.team(side.key);
    const own = matcher.team(side.key, sport);
    if (own) return own;
    const any = matcher.team(side.key);
    if (!any) return undefined;
    return !TEAM_SPORTS.has(sport) || CLOSED_LEAGUES.has(any.league ?? '') ? any : undefined;
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

/** Two teams of one closed league: the sport is settled, whatever else the item says. */
function closedLeaguePair(combined: Combined): boolean {
  const [home, away] = combined.teams ?? [];
  return (
    home !== undefined &&
    away !== undefined &&
    home.league === away.league &&
    CLOSED_LEAGUES.has(home.league ?? '')
  );
}

/** The sport a competition the items name gives by its own words: "ATP Paris Masters", "EuroLeague". */
function competitionSport(members: readonly Combined[]): Sport | undefined {
  let best: { sport: Sport; rank: number } | undefined;
  for (const member of members) {
    for (const { text, source } of member.competitions) {
      const rank = SOURCE_RANK[source];
      if (best && rank >= best.rank) break;
      const sport = sportOf(text);
      if (sport !== undefined) {
        best = { sport, rank };
        break;
      }
    }
  }
  return best?.sport;
}

// A fight card's number after its promotion: "UFC 320", "PFL 10", "Oktagon #96".
const CARD_NUMBER = /^(.*\S)\s+#?\d{1,4}$/;

/**
 * The competition the dictionary knows by a name, and for a fight sport by
 * the name without its card's number: "UFC 320: Jones vs Aspinall" is the
 * UFC's, as most cards are named. No other sport numbers its competitions
 * this way, and a number there can be part of the name ("Formula 1").
 */
function knownCompetition(
  matcher: Matcher,
  text: string,
  sport: Sport,
): CompetitionEntry | undefined {
  const entry = matcher.competition(text, sport);
  if (entry || (sport !== 'mma' && sport !== 'boxing')) return entry;
  const card = CARD_NUMBER.exec(text.trim());
  return card ? matcher.competition(card[1]!, sport) : undefined;
}

/**
 * Whether a fight the addon tagged with a word for any fight sport ("Fight",
 * read as boxing) names an MMA competition the dictionary knows: "ONE
 * Championship" or "UFC 320" in a Fight catalog is MMA, and gets its row
 * there. A card with no fighters in its title names it in front ("UFC 320:
 * Prelims").
 */
function namesMma(members: readonly Combined[], matcher: Matcher): boolean {
  for (const member of members) {
    for (const { text } of member.competitions) {
      if (knownCompetition(matcher, text, 'mma')) return true;
    }
    for (const suffix of member.suffixes) {
      if (knownCompetition(matcher, suffix, 'mma')) return true;
    }
  }
  return false;
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

// The dictionary has no rugby or cricket sides, and addons write the sport after the club or
// leave it off: "Bath Rugby" and "Bath", "Yorkshire County Cricket Club" and "Yorkshire". The
// team key has already lost a last "club" (teamKey), so "county cricket" ends it there.
const SPORT_TAIL =
  /\s(?:rugby(?:\s(?:union|league|club|football(?:\sclub)?))?|rfc|rufc|rlfc|cricket(?:\sclub)?|county cricket(?:\sclub)?|ccc)$/;

/**
 * A side's key for following it: the sport, its team key, and its youth and
 * women's marks, which make it another side than the club's first team
 * ("football:arsenal:women"). The same wherever the same club is listed:
 * through the dictionary's names where it knows the team, and with the sport
 * word rugby and cricket clubs carry in some addons and not others left off.
 * A lone reserve mark is left out, as in matchKey: it is often the club's
 * own name, which another addon leaves off.
 */
export function followKeyOf(
  sport: Sport,
  key: string,
  marks: Pick<SideMarks, 'youth'>,
  women: boolean,
): string {
  let base = key;
  if (sport === 'rugby' || sport === 'cricket') {
    for (let tail = SPORT_TAIL.exec(base); tail && tail.index > 0; tail = SPORT_TAIL.exec(base)) {
      base = base.slice(0, tail.index);
    }
  }
  return `${sport}:${base}${marks.youth ? ':youth' : ''}${women ? ':women' : ''}`;
}

/**
 * The two sides in either order, with their youth, reserve and women's marks
 * and any game number: the same for every listing of one match. Arsenal Women
 * and Arsenal U21 are other matches than Arsenal's, though the clubs are the same.
 */
function matchKey(combined: Combined): string | undefined {
  if (!combined.sides || !combined.teamsOk) return undefined;
  const [home, away] = combined.sides;
  const side = (s: Side, team: TeamEntry | undefined) =>
    `${canonicalKey(s, team)}${s.marks.youth ? ':youth' : ''}`;
  const a = side(home, combined.teams?.[0]);
  const b = side(away, combined.teams?.[1]);
  // A lone "II" is often the club's own name (SSV Jeddeloh II), which another addon
  // leaves off: only two reserve sides make another match.
  const reserves = home.marks.reserve && away.marks.reserve ? ':reserves' : '';
  // Men's and women's sides never meet, so one side's mark tells for both.
  const women = home.marks.women || away.marks.women ? ':women' : '';
  return `${a < b ? `${a}|${b}` : `${b}|${a}`}|${combined.sequence ?? ''}${reserves}${women}`;
}

function bucketKey(combined: Combined): string {
  const kind = combined.listing.kind;
  const match = matchKey(combined);
  if (match !== undefined) return `${kind}|teams|${match}`;
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
      let entry = matcher ? knownCompetition(matcher, text, sport) : undefined;
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
        const entry = knownCompetition(matcher, suffix, sport);
        if (entry)
          consider(competitionFromEntry(entry, 'name-suffix'), SOURCE_RANK['name-suffix'], true);
      }
      if (member.sofascore !== undefined) {
        const entry = matcher.sofascore(member.sofascore);
        if (entry) consider(competitionFromEntry(entry, 'artwork'), SOURCE_RANK.artwork, true);
      }
    }
  }
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
  // A club of another sport says nothing about this match's country or league.
  const [home, away] = first.teams.map((team) => (team?.sport === sport ? team : undefined));
  // The addon named a SofaScore competition the dictionary does not know (a women's or
  // youth cup, say): the teams' usual league or UEFA campaign would be a guess.
  const unknownTournament = members.some(
    (member) => member.sofascore !== undefined && !matcher.sofascore(member.sofascore),
  );
  const [homeMarks, awayMarks] = [first.sides[0].marks, first.sides[1].marks];
  const youthHome = homeMarks.youth || homeMarks.reserve;
  const youthAway = awayMarks.youth || awayMarks.reserve;
  // Men's and women's sides never meet, so one side's mark tells for both.
  const women = homeMarks.women || awayMarks.women;
  const youthGroup = () =>
    groupCompetition(
      'group:youth',
      `Youth ${sportWord(sport)}`,
      sport,
      COUNTRY_PRIORITY,
      'country',
    );
  const womenGroup = () =>
    groupCompetition(
      'group:women',
      `Women's ${sportWord(sport)}`,
      sport,
      COUNTRY_PRIORITY,
      'country',
    );

  if (home && away) {
    if (youthHome && youthAway) return youthGroup();
    if (youthHome !== youthAway)
      return countryGroup(youthHome ? away : home, sport, matcher, women);
    if (women) {
      return home.country === away.country
        ? countryGroup(home, sport, matcher, true)
        : womenGroup();
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
  // One side known: a senior side against a youth or reserve side keeps its country group
  // (an EFL Trophy tie). Otherwise the other club could be from anywhere (a cup tie abroad),
  // so the match goes to Other, never a guessed country.
  const known = home ?? away;
  if (!known) return undefined;
  if (youthHome && youthAway) return youthGroup();
  const knownYouth = home ? youthHome : youthAway;
  const otherYouth = home ? youthAway : youthHome;
  if (!knownYouth && otherYouth) return countryGroup(known, sport, matcher, women);
  if (women) return womenGroup();
  return undefined;
}

/** A senior or men's competition named over two youth sides or a women's match. */
function wrongLevel(competition: Competition, sides: [Side, Side], matcher: Matcher): boolean {
  const entry = matcher.competitionById(competition.key);
  if (!entry) return false;
  const [home, away] = sides;
  const youth =
    (home.marks.youth || home.marks.reserve) && (away.marks.youth || away.marks.reserve);
  if (youth && !entry.youth) return true;
  return (home.marks.women || away.marks.women) && !entry.women;
}

/** The four US leagues that get competition rows, by the sport each plays. */
const US_LEAGUES: Record<string, Sport> = {
  nfl: 'american-football',
  nba: 'basketball',
  nhl: 'ice-hockey',
  mlb: 'baseball',
};

/**
 * Sports whose competitions get a row of their own wherever the dictionary
 * names them, so the Six Nations no longer sits with club rugby (Eyitayo, 6
 * November 2026). What the dictionary does not know stays in the sport's row.
 */
const NAMED_ROW_SPORTS: ReadonlySet<Sport> = new Set<Sport>([
  'rugby',
  'cricket',
  'motorsport',
  'mma',
  'boxing',
]);

// Keys BannerTV makes up for rows that are not one competition.
const MADE_UP_KEY = /^(?:text|country|group|other|sport):/;

/**
 * Whether a competition is a row of the bundled dictionary, whose id is the
 * same on every screen with the same data, rather than a name an addon gave
 * or a group BannerTV made up.
 */
export function isDictionaryCompetition(competition: Pick<Competition, 'key' | 'source'>): boolean {
  return !MADE_UP_KEY.test(competition.key) && isNamed(competition);
}

/** A competition the items named, as against a group BannerTV made up from the teams. */
function isNamed(competition: Pick<Competition, 'source'>): boolean {
  return competition.source !== 'country' && competition.source !== 'other';
}

/**
 * Competition rows are for football, the four US leagues, and the
 * competitions of rugby, cricket, motor racing and fight sports that the
 * dictionary names (Eyitayo, 28 October and 6 November 2026). Every other
 * sport is one row per sport, as are those four's competitions the
 * dictionary does not know, and the rest of American football, basketball,
 * ice hockey and baseball goes in its "Other" row. What the addon called the
 * competition stays on the tile as a note, with its key for following it.
 */
function rowCompetition(
  competition: Competition,
  sport: Sport,
): { competition: Competition; note?: string; noteKey?: string } {
  if (sport === 'football') return { competition };
  if (
    NAMED_ROW_SPORTS.has(sport) &&
    competition.sport === sport &&
    isDictionaryCompetition(competition)
  ) {
    return { competition };
  }
  // A named competition's key is a dictionary id or a `text:` key: the same on every screen.
  const noted = (row: Competition) =>
    isNamed(competition)
      ? { competition: row, note: competition.name, noteKey: competition.key }
      : { competition: row };
  const textKey = /^text:[^:]+:(nfl|nba|nhl|mlb)$/.exec(competition.key);
  const league = textKey ? textKey[1]! : competition.key;
  if (US_LEAGUES[league] !== undefined) {
    if (US_LEAGUES[league] === sport) return { competition };
    return noted(otherCompetition(sport));
  }
  if (
    sport === 'american-football' ||
    sport === 'basketball' ||
    sport === 'ice-hockey' ||
    sport === 'baseball' ||
    sport === 'other'
  ) {
    return noted(otherCompetition(sport));
  }
  return noted(
    groupCompetition('sport', capitalise(sportWord(sport)), sport, NON_FOOTBALL + 500, 'other'),
  );
}

// The format a stage names: a Test, a one-day or a T20 international, each its own row.
const CRICKET_FORMATS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btests?\b/i, 'cricket.test'],
  [/\bodis?\b/i, 'cricket.odi'],
  [/\bt20is?\b/i, 'cricket.t20i'],
];

/**
 * The competition a cricket stage names when the item names none: "T20
 * World Cup", or the format of "4th T20I" and "1st Test Day 2", which only
 * national sides play. Not over youth or women's sides, whose competitions
 * the dictionary keeps apart.
 */
function cricketFormat(
  round: string,
  sides: [Side, Side] | undefined,
  matcher: Matcher,
): Competition | undefined {
  if (sides?.some((side) => side.marks.youth || side.marks.reserve || side.marks.women)) {
    return undefined;
  }
  const named = matcher.competition(round, 'cricket');
  if (named) return competitionFromEntry(named, 'name-suffix');
  for (const [pattern, id] of CRICKET_FORMATS) {
    if (!pattern.test(round)) continue;
    const entry = matcher.competitionById(id);
    return entry ? competitionFromEntry(entry, 'name-suffix') : undefined;
  }
  return undefined;
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
    const known = members.find((m) => m.teams?.[0] && m.teams?.[1]) ?? lead;
    let sport = sportOfCombined(known);
    // A competition that names its sport beats the addon's tag ("ATP Paris Masters" tagged
    // Fútbol) and clubs that play more than one ("EuroLeague: Olympiacos vs Panathinaikos");
    // only two teams of one closed league outrank it.
    const namedSport = competitionSport(members);
    if (namedSport !== undefined && namedSport !== sport && !closedLeaguePair(known)) {
      sport = namedSport;
    }
    if (sport === 'boxing' && matcher && namesMma(members, matcher)) sport = 'mma';
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

    const round = members.find((m) => m.round)?.round;
    let named =
      namedCompetition(members, sport, teams, matcher) ??
      (matcher ? teamCompetition(members, sport, kickOff, matcher) : undefined);
    if (sport === 'cricket' && matcher && round && (!named || !isNamed(named))) {
      named = cricketFormat(round, sided?.sides, matcher) ?? named;
    }
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
    if (resolved.noteKey) event.noteKey = resolved.noteKey;
    if (sided?.sides) {
      const [homeSide, awaySide] = sided.sides;
      event.home = homeSide.name;
      event.away = awaySide.name;
      const keys: [string, string] = [
        canonicalKey(homeSide, teams[0]),
        canonicalKey(awaySide, teams[1]),
      ];
      event.teamKeys = keys;
      const match = matchKey(sided);
      if (match !== undefined) event.matchKey = match;
      // Players and fighters are not followed as teams: their names are too often a card's.
      if (TEAM_SPORTS.has(sport)) {
        // A women's or youth competition says so for sides listed by the club's name alone
        // ("Arsenal vs Chelsea" in the Women's Super League), and men's and women's sides
        // never meet, so one side's mark tells for both.
        const level = named && matcher ? matcher.competitionById(named.key) : undefined;
        const women = homeSide.marks.women || awaySide.marks.women || level?.women === true;
        const youth = level?.youth === true;
        event.followKeys = [
          followKeyOf(sport, keys[0], youth ? { youth } : homeSide.marks, women),
          followKeyOf(sport, keys[1], youth ? { youth } : awaySide.marks, women),
        ];
      }
    }
    for (const member of members) {
      // A listing may name the teams the other way round: its badges follow its own sides.
      const flipped =
        member.sides !== undefined &&
        event.teamKeys.length === 2 &&
        canonicalKey(member.sides[0], member.teams?.[0]) !== event.teamKeys[0];
      for (const copy of member.copies) {
        if (
          !event.sources.some(
            (s) => s.addonIndex === copy.source.addonIndex && s.id === copy.source.id,
          )
        ) {
          event.sources.push(copy.source);
        }
        if (!member.sides || event.teamKeys.length !== 2) continue;
        const { homeLogo, awayLogo } = copy.source;
        const [home, away] = flipped ? [awayLogo, homeLogo] : [homeLogo, awayLogo];
        if (home && !event.homeLogo) event.homeLogo = home;
        if (away && !event.awayLogo) event.awayLogo = away;
      }
    }
    events.push(event);
  }
  return events;
}

/** The day a kick-off falls on, by the TV's calendar for a time. */
function dayOf(kickOff: KickOff): string | undefined {
  return kickOff.at !== undefined ? localDate(kickOff.at) : kickOff.date;
}

/**
 * Whether a replay can be of this match rather than an earlier meeting of the
 * same sides (a series, a second leg): it is dated from the match's day on, and
 * by the next day. A replay with no date could be of any meeting.
 */
function replayOf(replay: SportEvent, event: SportEvent): boolean {
  const done = replay.kickOff;
  const match = event.kickOff;
  if (!done || !match) return false;
  if (done.at !== undefined && match.at !== undefined) {
    // The match's own kick-off (perhaps read in an unsure zone), or a later upload time.
    return done.at >= match.at - 90 * MINUTE && done.at <= match.at + 2 * DAY;
  }
  const doneDay = dayOf(done);
  // A date-only replay is dated by the addon's calendar, often UTC: its day must be on or
  // after both the TV's date and the UTC date of the kick-off, so last night's game in a
  // series never ends tonight's.
  let first = dayOf(match);
  if (match.at !== undefined) {
    const utc = new Date(match.at).toISOString().slice(0, 10);
    if (first === undefined || utc > first) first = utc;
  }
  if (doneDay === undefined || first === undefined) return false;
  return doneDay >= first && doneDay <= addDays(first, 1);
}

/** Whether a replay of this match has appeared, which ends it however long its window. */
export function replayedKeys(events: readonly SportEvent[]): Set<string> {
  const replays = new Map<string, SportEvent[]>();
  for (const event of events) {
    if (event.kind !== 'replay' || event.matchKey === undefined) continue;
    const list = replays.get(event.matchKey);
    if (list) list.push(event);
    else replays.set(event.matchKey, [event]);
  }
  const ended = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'event' || event.matchKey === undefined) continue;
    const list = replays.get(event.matchKey);
    if (list && list.some((replay) => replayOf(replay, event))) ended.add(event.key);
  }
  return ended;
}
