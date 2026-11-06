import { competitionKey, teamKey } from './text';
import type { CompetitionEntry, CountryEntry, Sport, SportsData, TeamEntry } from './types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Lookups over the bundled matcher data. Every map is built once, when the
 * data first arrives, so grouping never scans a list.
 */
export interface Matcher {
  readonly built: string;
  /** A competition named by an addon, through its aliases, a country word in front and the sport. */
  competition(text: string, sport?: Sport): CompetitionEntry | undefined;
  competitionById(id: string): CompetitionEntry | undefined;
  sofascore(id: number): CompetitionEntry | undefined;
  /** A team by any of its names. With a sport, only teams of that sport. */
  team(name: string, sport?: Sport): TeamEntry | undefined;
  /** Whether a league's calendar has these two teams playing within a day of `at` (or on `date`). */
  inCalendar(league: string, home: TeamEntry, away: TeamEntry, at?: number, date?: string): boolean;
  /** The UEFA club competition both teams play in this season, if any. */
  sharedUefa(home: TeamEntry, away: TeamEntry): CompetitionEntry | undefined;
  country(code: string): CountryEntry | undefined;
  /** Teams one of whose names starts with this text, for search. At most `limit`. */
  teamsMatching(text: string, limit: number): TeamEntry[];
  /** Every name of a team, folded, for search. */
  namesOf(team: TeamEntry): string[];
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    if (list.indexOf(value) === -1) list.push(value);
  } else map.set(key, [value]);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Days since 1970 of a YYYY-MM-DD date. */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
}

/** Competitions run in seasons: "2026/27" or "2026-27" after a name says nothing more. */
function withoutSeason(key: string): string {
  return key.replace(/\s*\b(?:19|20)\d\d(?:\s*(?:\/|-|\s)\s*(?:\d\d|\d{4}))?$/, '').trim();
}

/**
 * The same fold, remembered by the text it was given. The calendars name each
 * team many times over (thousands of names, under two hundred different ones),
 * and folding is most of what building the maps costs on a TV.
 */
function remembered(fold: (text: string) => string): (text: string) => string {
  const folded = new Map<string, string>();
  return (text) => {
    let key = folded.get(text);
    if (key === undefined) {
      key = fold(text);
      folded.set(text, key);
    }
    return key;
  };
}

export function createMatcher(data: SportsData): Matcher {
  // For building only: the lookups below fold what addons say as it comes,
  // and keep nothing, so the matcher does not grow as it is used.
  const teamKeyOf = remembered(teamKey);
  const competitionKeyOf = remembered(competitionKey);

  const competitions = new Map<string, CompetitionEntry[]>();
  const byId = new Map<string, CompetitionEntry>();
  const bySofascore = new Map<number, CompetitionEntry>();
  const teams = new Map<string, TeamEntry[]>();
  const teamNames = new Map<TeamEntry, string[]>();
  const teamIndex = new Map<TeamEntry, number>();
  const countries = new Map<string, CountryEntry>();
  // Country words a competition name can start with: "England", "English", "Germany", "German".
  const countryWords = new Map<string, string>();
  const calendars = new Map<string, Map<string, number[]>>();
  const uefa = new Map<string, Set<TeamEntry>>();

  for (const country of data.countries) {
    countries.set(country.code, country);
    countryWords.set(competitionKeyOf(country.name), country.code);
    countryWords.set(competitionKeyOf(country.adjective), country.code);
  }
  for (const entry of data.competitions) {
    byId.set(entry.id, entry);
    for (const name of [entry.name].concat(entry.aliases)) {
      const key = competitionKeyOf(name);
      if (key !== '') addTo(competitions, key, entry);
    }
    for (const id of entry.sofascore ?? []) bySofascore.set(id, entry);
  }
  data.teams.forEach((team, index) => teamIndex.set(team, index));
  for (const team of data.teams) {
    const names: string[] = [];
    for (const name of [team.name].concat(team.aliases)) {
      const key = teamKeyOf(name);
      if (key === '' || names.indexOf(key) !== -1) continue;
      names.push(key);
      addTo(teams, key, team);
    }
    teamNames.set(team, names);
  }
  for (const league in data.calendars) {
    const pairs = new Map<string, number[]>();
    for (const [date, home, away] of data.calendars[league]!) {
      const a = teams.get(teamKeyOf(home));
      const b = teams.get(teamKeyOf(away));
      if (!a || !b) continue;
      addTo(pairs, pairKey(teamIndex.get(a[0]!)!, teamIndex.get(b[0]!)!), dayNumber(date));
    }
    calendars.set(league, pairs);
  }
  for (const id in data.uefa) {
    const clubs = new Set<TeamEntry>();
    for (const name of data.uefa[id]!) {
      const found = teams.get(teamKeyOf(name));
      if (found) clubs.add(found[0]!);
    }
    uefa.set(id, clubs);
  }

  function pick(
    found: readonly CompetitionEntry[] | undefined,
    sport: Sport | undefined,
    country: string | undefined,
  ): CompetitionEntry | undefined {
    if (!found || found.length === 0) return undefined;
    let options = found;
    if (sport && sport !== 'other') {
      const ofSport = options.filter((entry) => entry.sport === sport);
      if (ofSport.length > 0) options = ofSport;
      else if (options.every((entry) => entry.sport !== sport)) return undefined;
    }
    if (country) {
      const ofCountry = options.filter((entry) => entry.country === country);
      if (ofCountry.length > 0) options = ofCountry;
      // "Germany Premier League": a country word that names no entry of that name.
      else return undefined;
    }
    // Two of the same name: the higher priority (England's Premier League).
    let best = options[0]!;
    for (const entry of options) if (entry.priority < best.priority) best = entry;
    return best;
  }

  function competition(text: string, sport?: Sport): CompetitionEntry | undefined {
    const key = withoutSeason(competitionKey(text));
    if (key === '') return undefined;
    const direct = pick(competitions.get(key), sport, undefined);
    if (direct) return direct;
    // "England - League One", "England. Premier League", "German Bundesliga".
    const words = key.split(' ');
    for (let take = Math.min(3, words.length - 1); take >= 1; take--) {
      const country = countryWords.get(words.slice(0, take).join(' '));
      if (!country) continue;
      const rest = words.slice(take).join(' ');
      const found = pick(competitions.get(rest), sport, country);
      if (found) return found;
    }
    return undefined;
  }

  function team(name: string, sport?: Sport): TeamEntry | undefined {
    const found = teams.get(teamKey(name));
    if (!found) return undefined;
    if (!sport) return found[0];
    return found.find((entry) => entry.sport === sport);
  }

  return {
    built: data.built,
    competition,
    competitionById: (id) => byId.get(id),
    sofascore: (id) => bySofascore.get(id),
    team,
    inCalendar(league, home, away, at, date) {
      const pairs = calendars.get(league);
      const a = teamIndex.get(home);
      const b = teamIndex.get(away);
      const day = at !== undefined ? Math.floor(at / DAY) : date ? dayNumber(date) : undefined;
      if (!pairs || a === undefined || b === undefined || day === undefined) return false;
      const days = pairs.get(pairKey(a, b));
      return days !== undefined && days.some((d) => Math.abs(d - day) <= 1);
    },
    sharedUefa(home, away) {
      let best: CompetitionEntry | undefined;
      uefa.forEach((clubs, id) => {
        if (best || !clubs.has(home) || !clubs.has(away)) return;
        best = byId.get(id);
      });
      return best;
    },
    country: (code) => countries.get(code),
    teamsMatching(text, limit) {
      const key = teamKey(text);
      const out: TeamEntry[] = [];
      if (key.length < 2) return out;
      teams.forEach((entries, name) => {
        if (out.length >= limit) return;
        if (
          name === key ||
          name.indexOf(`${key} `) === 0 ||
          (key.length >= 3 && name.indexOf(key) === 0)
        ) {
          for (const entry of entries)
            if (out.length < limit && out.indexOf(entry) === -1) out.push(entry);
        }
      });
      return out;
    },
    namesOf: (entry) => teamNames.get(entry) ?? [],
  };
}
