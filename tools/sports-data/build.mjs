#!/usr/bin/env node
// Builds the bundled sports matcher data (docs/PLAN.md, Sports addons, Matcher
// data): packages/core/src/sports/data/sports-data.json, the SportsData type in
// packages/core/src/sports/types.ts.
//
//   node tools/sports-data/build.mjs [--offline] [--built=YYYY-MM-DD]
//                                    [--season=2026-27] [--year=2026] [--strict]
//
// Inputs: the hand-curated countries.json, competitions.json, teams.json and
// uefa.json next to this script, and openfootball's public-domain (CC0)
// football.json league files, downloaded into .cache/ (--offline reuses them).
// No dependencies; Node 22 or later. See README.md in this folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'packages/core/src/sports/data/sports-data.json');
const CACHE = join(HERE, '.cache');
const TEXT_TS = join(ROOT, 'packages/core/src/sports/text.ts');
const OPENFOOTBALL = 'https://raw.githubusercontent.com/openfootball/football.json/master';
const VERSION = 1;
/** The whole file, gzipped (docs/PLAN.md estimates 70 to 90 KB). */
const BUDGET = 90 * 1024;

// openfootball file codes and the competition ids they fill. Every code is
// asked for; the ones not published for the season (a 404) are skipped.
const SEASON_FILES = {
  'en.1': 'eng.1',
  'en.2': 'eng.2',
  'en.3': 'eng.3',
  'en.4': 'eng.4',
  'de.1': 'ger.1',
  'de.2': 'ger.2',
  'de.3': 'ger.3',
  'es.1': 'esp.1',
  'es.2': 'esp.2',
  'it.1': 'ita.1',
  'it.2': 'ita.2',
  'fr.1': 'fra.1',
  'fr.2': 'fra.2',
  'nl.1': 'ned.1',
  'pt.1': 'por.1',
  'be.1': 'bel.1',
  'tr.1': 'tur.1',
  'sco.1': 'sco.1',
  'at.1': 'aut.1',
  'ch.1': 'sui.1',
  'gr.1': 'gre.1',
  'dk.1': 'den.1',
};
// Leagues that run in calendar years live in a folder named after the year.
const YEAR_FILES = {
  'br.1': 'bra.1',
};
// Over budget, only these calendars stay: the top divisions of England (two
// tiers), Germany, Spain, Italy, France, the Netherlands and Portugal.
const CORE_CALENDARS = ['eng.1', 'eng.2', 'ger.1', 'esp.1', 'ita.1', 'fra.1', 'ned.1', 'por.1'];

const SPORTS = [
  'football',
  'basketball',
  'american-football',
  'ice-hockey',
  'baseball',
  'tennis',
  'cricket',
  'rugby',
  'motorsport',
  'boxing',
  'mma',
  'golf',
  'darts',
  'snooker',
  'aussie-rules',
  'other',
];
const KINDS = ['league', 'cup', 'international'];
const COUNTRY_CODE = /^(?:[A-Z]{2}|GB-(?:ENG|SCT|WLS|NIR)|EU|INT)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Bare names that only one competition may carry: other countries' Premier
// Leagues need a country word, and a bare "League Cup" is decided by the code
// from the teams (docs/PLAN.md, Grouping).
const RESERVED = {
  football: {
    'premier league': 'eng.1',
    'serie a': 'ita.1',
    'serie b': 'ita.2',
    bundesliga: 'ger.1',
    championship: 'eng.2',
    'super league': null,
    'league cup': null,
    'pro league': null,
    superliga: null,
    'first division': null,
    'super cup': null,
  },
};

// ---------------------------------------------------------------------------
// Arguments

const args = process.argv.slice(2);
const unknownArgs = args.filter(
  (arg) => !/^--(?:offline|strict|(?:built|season|year)=.+)$/.test(arg),
);
if (unknownArgs.length > 0) {
  console.error(`Unknown argument ${unknownArgs.join(' ')}`);
  console.error(
    'Usage: node tools/sports-data/build.mjs [--offline] [--built=YYYY-MM-DD] [--season=2026-27] [--year=2026] [--strict]',
  );
  process.exit(2);
}
const option = (name) => {
  const arg = args.find((value) => value.startsWith(`--${name}=`));
  return arg === undefined ? undefined : arg.slice(name.length + 3);
};
const offline = args.includes('--offline');
const strict = args.includes('--strict');
const built = option('built') ?? new Date().toISOString().slice(0, 10);
if (!DATE.test(built) || Number.isNaN(Date.parse(`${built}T00:00:00Z`))) {
  console.error(`--built must be a date, YYYY-MM-DD (got ${built})`);
  process.exit(2);
}
// The season in play on the build date: European seasons turn over in July.
const builtYear = Number(built.slice(0, 4));
const startYear = Number(built.slice(5, 7)) >= 7 ? builtYear : builtYear - 1;
const season = option('season') ?? `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
const year = option('year') ?? String(builtYear);
if (!/^\d{4}-\d{2}$/.test(season) || !/^\d{4}$/.test(year)) {
  console.error(`--season must look like 2026-27 and --year like 2026 (got ${season}, ${year})`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const error = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

// ---------------------------------------------------------------------------
// Name keys. A copy of foldText, teamKey and competitionKey in
// packages/core/src/sports/text.ts, so the output never depends on whether
// that file can be loaded. When it can (Node 22 strips TypeScript types), the
// checks below also run with the app's own functions, and any name the two
// fold differently is reported.

const FOLD = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', ı: 'i', þ: 'th' };
const DECORATION =
  // eslint-disable-next-line no-misleading-character-class -- the same set as text.ts: each code point is dropped on its own
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{20E3}\u{FE00}-\u{FE0F}\u{200B}-\u{200F}\u{2060}-\u{2064}\u{FEFF}\u{E0000}-\u{E007F}]/gu;
const COMBINING = /[\u0300-\u036f]/g;
const CLUB_WORDS = new Set([
  'fc',
  'afc',
  'cf',
  'sc',
  'ac',
  'as',
  'ssc',
  'ss',
  'us',
  'sv',
  'vfb',
  'vfl',
  'tsg',
  'fsv',
  'bsc',
  'rcd',
  'cd',
  'ud',
  'sd',
  'fk',
  'nk',
  'sk',
  'bk',
  'kv',
  'krc',
  'club',
  'calcio',
]);
const WORD_MAP = { utd: 'united', st: 'saint', ste: 'sainte' };

function foldText(text) {
  const folded = text.replace(DECORATION, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return folded
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(/[ßøæœłđðıþ]/g, (letter) => FOLD[letter] ?? letter);
}

function copyTeamKey(name) {
  const words = foldText(name)
    .replace(/&/g, ' and ')
    .replace(/[.'’`´"(),/\\_:;!?*+]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => WORD_MAP[word] ?? word);
  while (words.length > 1 && /^\d{1,2}$/.test(words[0]) && CLUB_WORDS.has(words[1])) words.shift();
  while (words.length > 1 && CLUB_WORDS.has(words[0])) words.shift();
  while (
    words.length > 1 &&
    (CLUB_WORDS.has(words[words.length - 1]) || /^(18|19|20)\d\d$/.test(words[words.length - 1]))
  ) {
    words.pop();
  }
  return words.join(' ');
}

function copyCompetitionKey(name) {
  return foldText(name)
    .replace(/&/g, ' and ')
    .replace(/[.'’`´"(),/\\_:;!?*+|]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The matcher drops a season after a competition name, so an alias ending in a year never matches. */
function withoutSeason(key) {
  return key.replace(/\s*\b(?:19|20)\d\d(?:\s*(?:\/|-|\s)\s*(?:\d\d|\d{4}))?$/, '').trim();
}

async function loadAppKeys() {
  try {
    const text = await import(pathToFileURL(TEXT_TS).href);
    if (typeof text.teamKey === 'function' && typeof text.competitionKey === 'function') {
      return { teamKey: text.teamKey, competitionKey: text.competitionKey };
    }
  } catch {
    // Node without type stripping, or the file is being edited: the copy is enough.
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers

function readJson(name) {
  const path = join(HERE, name);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${relative(ROOT, path)}: ${cause.message}`, { cause });
  }
}

/** Plain code-unit order, the same on every machine and locale. */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isStringList(value) {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '')
  );
}

/** Aliases without blanks, repeats and spellings that fold to the name itself. */
function cleanAliases(name, aliases, keyOf) {
  const seen = new Set([keyOf(name)]);
  const out = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = keyOf(alias);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

async function download(folder, code) {
  const file = join(CACHE, `${folder}__${code}.cached`);
  if (!offline) {
    const url = `${OPENFOOTBALL}/${folder}/${code}.json`;
    let body;
    for (let attempt = 1; body === undefined; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (response.status === 404) body = '';
        else if (!response.ok) throw new Error(`HTTP ${response.status}`);
        else body = await response.text();
      } catch (cause) {
        if (attempt >= 3) throw new Error(`${url}: ${cause.message}`, { cause });
      }
    }
    mkdirSync(CACHE, { recursive: true });
    // An empty file records "not published", so --offline gives the same result.
    writeFileSync(file, body);
  } else if (!existsSync(file)) {
    throw new Error(
      `--offline: ${folder}/${code}.json is not in ${relative(ROOT, CACHE)}; run once without --offline`,
    );
  }
  const body = readFileSync(file, 'utf8');
  if (body === '') return undefined;
  try {
    return JSON.parse(body);
  } catch (cause) {
    throw new Error(`${folder}/${code}.json: ${cause.message}`, { cause });
  }
}

/** Matches of a football.json league file: { matches } now, { rounds: [{ matches }] } in older files. */
function matchesOf(file) {
  if (Array.isArray(file?.matches)) return file.matches;
  if (Array.isArray(file?.rounds)) return file.rounds.flatMap((round) => round.matches ?? []);
  return undefined;
}

// ---------------------------------------------------------------------------
// Build

async function main() {
  const appKeys = await loadAppKeys();
  const teamKey = copyTeamKey;
  const competitionKey = copyCompetitionKey;

  // Countries
  const countryList = readJson('countries.json');
  const countries = new Map();
  for (const entry of countryList) {
    if (!COUNTRY_CODE.test(entry.code ?? ''))
      error(`countries.json: bad code ${JSON.stringify(entry.code)}`);
    else if (countries.has(entry.code)) error(`countries.json: ${entry.code} is listed twice`);
    if (typeof entry.name !== 'string' || entry.name === '')
      error(`countries.json: ${entry.code} has no name`);
    if (typeof entry.adjective !== 'string' || entry.adjective === '')
      error(`countries.json: ${entry.code} has no adjective`);
    countries.set(entry.code, { code: entry.code, name: entry.name, adjective: entry.adjective });
  }
  const usedCountries = new Set();
  const useCountry = (code, where) => {
    usedCountries.add(code);
    if (!countries.has(code)) error(`${where}: country ${code} is not in countries.json`);
  };

  // Competitions
  const competitions = new Map();
  const sofascoreIds = new Map();
  for (const entry of readJson('competitions.json')) {
    const where = `competitions.json ${entry.id}`;
    if (typeof entry.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.id)) {
      error(`competitions.json: bad id ${JSON.stringify(entry.id)}`);
      continue;
    }
    if (competitions.has(entry.id)) error(`${where}: id is used twice`);
    if (typeof entry.name !== 'string' || entry.name.trim() === '') error(`${where}: no name`);
    if (!SPORTS.includes(entry.sport)) error(`${where}: unknown sport ${entry.sport}`);
    if (!KINDS.includes(entry.kind)) error(`${where}: unknown kind ${entry.kind}`);
    if (!Number.isInteger(entry.priority) || entry.priority < 0)
      error(`${where}: priority must be a whole number`);
    if (!isStringList(entry.aliases)) error(`${where}: aliases must be a list of names`);
    for (const flag of ['women', 'youth']) {
      if (entry[flag] !== undefined && entry[flag] !== true)
        error(`${where}: ${flag} is true or left out`);
    }
    useCountry(entry.country, where);
    if (entry.sofascore !== undefined) {
      if (
        !Array.isArray(entry.sofascore) ||
        !entry.sofascore.every((id) => Number.isInteger(id) && id > 0)
      ) {
        error(`${where}: sofascore must be a list of ids`);
      } else {
        for (const id of entry.sofascore) {
          if (sofascoreIds.has(id))
            error(`${where}: SofaScore id ${id} is also ${sofascoreIds.get(id)}'s`);
          sofascoreIds.set(id, entry.id);
        }
      }
    }
    const aliases = isStringList(entry.aliases) ? entry.aliases : [];
    for (const name of [entry.name, ...aliases]) {
      const key = competitionKey(name ?? '');
      if (withoutSeason(key) !== key)
        error(`${where}: "${name}" ends in a year, which the matcher drops`);
    }
    const out = {
      id: entry.id,
      name: entry.name.trim(),
      sport: entry.sport,
      country: entry.country,
      kind: entry.kind,
    };
    if (entry.women) out.women = true;
    if (entry.youth) out.youth = true;
    out.priority = entry.priority;
    out.aliases = cleanAliases(entry.name, aliases, competitionKey);
    if (entry.sofascore) out.sofascore = [...entry.sofascore].sort((a, b) => a - b);
    competitions.set(entry.id, out);
  }

  // Every competition name and alias names one competition of its sport.
  const checkCompetitionNames = (keyOf, label) => {
    const owners = new Map();
    for (const entry of competitions.values()) {
      for (const name of [entry.name, ...entry.aliases]) {
        const key = `${entry.sport}|${keyOf(name)}`;
        const owner = owners.get(key);
        if (owner && owner !== entry.id) {
          error(
            `competitions.json: "${name}" names both ${owner} and ${entry.id} (${entry.sport})${label}`,
          );
        }
        owners.set(key, entry.id);
      }
    }
    for (const sport in RESERVED) {
      for (const [bare, id] of Object.entries(RESERVED[sport])) {
        const owner = owners.get(`${sport}|${keyOf(bare)}`);
        if (owner !== undefined && owner !== id) {
          error(
            `competitions.json: the bare name "${bare}" may only be ${id ?? 'no one'}'s, not ${owner}'s${label}`,
          );
        }
      }
    }
  };
  checkCompetitionNames(competitionKey, '');

  // Football teams and calendars from openfootball
  const teams = [];
  const teamByName = new Map(); // `${sport}|${name}` -> team
  const calendars = {};
  const sources = [];
  const jobs = [
    ...Object.entries(SEASON_FILES).map(([code, id]) => ({ folder: season, code, id })),
    ...Object.entries(YEAR_FILES).map(([code, id]) => ({ folder: year, code, id })),
  ];
  const files = await Promise.all(jobs.map((job) => download(job.folder, job.code)));
  let undated = 0;
  jobs.forEach((job, index) => {
    const file = files[index];
    if (file === undefined) return;
    const where = `openfootball ${job.folder}/${job.code}.json`;
    const competition = competitions.get(job.id);
    if (!competition) {
      error(`${where}: maps to ${job.id}, which is not in competitions.json`);
      return;
    }
    const matches = matchesOf(file);
    if (!matches) {
      error(`${where}: no matches list`);
      return;
    }
    const fixtures = new Map();
    let teamCount = 0;
    for (const match of matches) {
      const sides = [match.team1, match.team2];
      if (!sides.every((side) => typeof side === 'string' && side.trim() !== '')) {
        warn(`${where}: a match without two team names was skipped`);
        continue;
      }
      for (const side of sides) {
        const name = side.trim();
        const existing = teamByName.get(`football|${name}`);
        if (existing) {
          if (existing.league !== job.id)
            warn(`${where}: ${name} is also in ${existing.league}; kept there`);
          continue;
        }
        const team = {
          name,
          sport: 'football',
          country: competition.country,
          league: job.id,
          aliases: [],
        };
        teams.push(team);
        teamByName.set(`football|${name}`, team);
        teamCount++;
      }
      if (typeof match.date !== 'string' || match.date === '') {
        undated++;
        continue;
      }
      if (!DATE.test(match.date)) {
        warn(`${where}: date ${match.date} is not YYYY-MM-DD; match skipped`);
        continue;
      }
      const fixture = [match.date, match.team1.trim(), match.team2.trim()];
      fixtures.set(fixture.join('|'), fixture);
    }
    calendars[job.id] = [...fixtures.values()].sort(
      (a, b) => compare(a[0], b[0]) || compare(a[1], b[1]) || compare(a[2], b[2]),
    );
    sources.push(
      `${job.folder}/${job.code} -> ${job.id}: ${teamCount} teams, ${fixtures.size} fixtures`,
    );
  });

  // Hand-curated teams, and aliases for every team
  const curated = readJson('teams.json');
  for (const [index, group] of (curated.groups ?? []).entries()) {
    const where = `teams.json group ${index + 1} (${group.league ?? group.country})`;
    if (!SPORTS.includes(group.sport)) {
      error(`${where}: unknown sport ${group.sport}`);
      continue;
    }
    useCountry(group.country, where);
    if (group.league !== undefined) {
      const league = competitions.get(group.league);
      if (!league) error(`${where}: league ${group.league} is not in competitions.json`);
      else if (league.sport !== group.sport)
        error(`${where}: ${group.league} is ${league.sport}, not ${group.sport}`);
      else if (!['EU', 'INT'].includes(league.country) && league.country !== group.country) {
        warn(`${where}: teams of ${group.country} in ${group.league}, a ${league.country} league`);
      }
    }
    for (const item of group.teams ?? []) {
      const [name, ...aliases] =
        typeof item === 'string' ? [item] : Array.isArray(item) ? item : [];
      if (typeof name !== 'string' || name.trim() === '' || !isStringList(aliases)) {
        error(`${where}: bad team ${JSON.stringify(item)}`);
        continue;
      }
      // Already there from openfootball (same sport and country, same name or alias): merge.
      const keys = new Set([name, ...aliases].map(teamKey));
      const same = teams.find(
        (team) =>
          team.sport === group.sport &&
          team.country === group.country &&
          [team.name, ...team.aliases].some((known) => keys.has(teamKey(known))),
      );
      if (same) {
        same.aliases.push(name.trim(), ...aliases);
        if (!same.league && group.league) same.league = group.league;
        if (group.league && same.league !== group.league) {
          warn(`${where}: ${name} is in ${same.league} this season, not ${group.league}`);
        }
        continue;
      }
      if (group.league && calendars[group.league]) {
        warn(
          `${where}: ${name} is not in openfootball's ${group.league} file; check its spelling or league`,
        );
      }
      const team = {
        name: name.trim(),
        sport: group.sport,
        country: group.country,
        aliases: [...aliases],
      };
      if (group.league) team.league = group.league;
      if (teamByName.has(`${team.sport}|${team.name}`))
        error(`${where}: ${team.name} is listed twice`);
      teams.push(team);
      teamByName.set(`${team.sport}|${team.name}`, team);
    }
  }
  let missingTargets = 0;
  for (const [sport, byName] of Object.entries(curated.aliases ?? {})) {
    for (const [name, aliases] of Object.entries(byName)) {
      if (!isStringList(aliases)) {
        error(`teams.json aliases: ${name} needs a list of names`);
        continue;
      }
      const team = teamByName.get(`${sport}|${name}`);
      if (!team) {
        missingTargets++;
        warn(
          `teams.json aliases: no ${sport} team is named "${name}" (renamed upstream, or left its league?)`,
        );
        continue;
      }
      team.aliases.push(...aliases);
    }
  }
  for (const team of teams) {
    team.aliases = cleanAliases(team.name, team.aliases, teamKey);
    if (team.league) {
      const league = competitions.get(team.league);
      if (!league) error(`team ${team.name}: league ${team.league} is not in competitions.json`);
    }
  }
  const sportRank = (sport) => SPORTS.indexOf(sport);
  // Football first: the matcher takes the first team of a name for calendars
  // and the UEFA list, and a name can be a club in one sport and a nickname in another.
  teams.sort(
    (a, b) =>
      sportRank(a.sport) - sportRank(b.sport) ||
      compare(a.country, b.country) ||
      compare(a.league ?? '~', b.league ?? '~') ||
      compare(a.name, b.name),
  );

  // Team names: one team per name in a sport.
  const checkTeamNames = (keyOf, label) => {
    const owners = new Map();
    let crossSport = 0;
    for (const team of teams) {
      for (const name of [team.name, ...team.aliases]) {
        const key = keyOf(name);
        if (key === '') {
          error(`team ${team.name}: "${name}" folds to nothing${label}`);
          continue;
        }
        const owner = owners.get(key);
        if (!owner) {
          owners.set(key, [team]);
          continue;
        }
        if (owner.includes(team)) continue;
        const clash = owner.find((other) => other.sport === team.sport);
        if (clash) {
          const what =
            name === team.name && clash.country === team.country ? 'two teams' : 'a name';
          error(
            `teams: ${what} "${name}" (${key}) in ${team.sport}: ${clash.name} (${clash.country}) and ${team.name} (${team.country})${label}`,
          );
        } else crossSport++;
        owner.push(team);
      }
    }
    return { owners, crossSport };
  };
  const { owners: teamOwners, crossSport } = checkTeamNames(teamKey, '');
  const footballTeam = (name) =>
    (teamOwners.get(teamKey(name)) ?? []).find((team) => team.sport === 'football');
  for (const team of teams) {
    if (team.sport !== 'football') continue;
    const first = teamOwners.get(teamKey(team.name))?.[0];
    if (first && first !== team)
      error(`team ${team.name}: its name finds ${first.name} (${first.sport}) first`);
  }

  // Calendars: keys are competitions, teams are dictionary names.
  for (const [id, fixtures] of Object.entries(calendars)) {
    for (const [, home, away] of fixtures) {
      for (const side of [home, away]) {
        const team = teamByName.get(`football|${side}`);
        if (!team || team.league !== id) error(`calendar ${id}: ${side} is not a ${id} team`);
      }
    }
  }

  // UEFA league phases
  const uefa = {};
  const uefaFile = readJson('uefa.json');
  for (const id of Object.keys(uefaFile).sort(compare)) {
    const competition = competitions.get(id);
    if (!competition || competition.sport !== 'football') {
      error(`uefa.json: ${id} is not a football competition id`);
      continue;
    }
    const clubs = new Set();
    for (const name of uefaFile[id]) {
      const team = footballTeam(name);
      if (!team) error(`uefa.json ${id}: no football team is called "${name}"`);
      else if (team.name !== name)
        warn(`uefa.json ${id}: "${name}" is spelled "${team.name}" in the dictionary`);
      if (team) clubs.add(team.name);
      if (team && teamOwners.get(teamKey(team.name))[0] !== team) {
        error(`uefa.json ${id}: "${name}" finds another team first`);
      }
    }
    if (clubs.size !== 0 && clubs.size !== 36) warn(`uefa.json ${id}: ${clubs.size} clubs, not 36`);
    if (clubs.size === 0) warn(`uefa.json ${id}: empty`);
    uefa[id] = [...clubs].sort(compare);
  }

  for (const team of teams) useCountry(team.country, `team ${team.name}`);
  for (const code of countries.keys())
    if (!usedCountries.has(code)) warn(`countries.json: ${code} is not used`);
  const competitionCount = competitions.size;
  if (competitionCount < 150 || competitionCount > 300)
    warn(`${competitionCount} competitions; the plan expects 150 to 300`);

  // The same checks with the app's own name keys, when text.ts loads.
  let keysNote = 'name keys: copy in build.mjs (text.ts could not be loaded)';
  if (appKeys) {
    keysNote = `name keys: checked against ${relative(ROOT, TEXT_TS)}`;
    const differ = new Set();
    for (const team of teams) {
      for (const name of [team.name, ...team.aliases])
        if (appKeys.teamKey(name) !== teamKey(name)) differ.add(name);
    }
    for (const entry of competitions.values()) {
      for (const name of [entry.name, ...entry.aliases]) {
        if (appKeys.competitionKey(name) !== competitionKey(name)) differ.add(name);
      }
    }
    if (differ.size > 0) {
      warn(
        `build.mjs's copy of the name keys is out of step with text.ts for ${differ.size} names, e.g. ${[...differ].slice(0, 5).join(', ')}`,
      );
      checkCompetitionNames(appKeys.competitionKey, ' (with text.ts keys)');
      checkTeamNames(appKeys.teamKey, ' (with text.ts keys)');
    }
  }

  for (const message of warnings) console.warn(`warning: ${message}`);
  if (errors.length > 0 || (strict && warnings.length > 0)) {
    for (const message of errors) console.error(`error: ${message}`);
    console.error(`\n${errors.length} errors, ${warnings.length} warnings; nothing written.`);
    process.exit(1);
  }

  // Output, in a fixed order
  const data = {
    version: VERSION,
    built,
    countries: [...countries.values()].sort((a, b) => compare(a.code, b.code)),
    competitions: [...competitions.values()].sort(
      (a, b) => a.priority - b.priority || compare(a.id, b.id),
    ),
    teams: teams.map((team) => {
      const out = { name: team.name, sport: team.sport, country: team.country };
      if (team.league) out.league = team.league;
      out.aliases = team.aliases;
      return out;
    }),
    uefa,
    calendars: {},
  };
  const encode = () => `${JSON.stringify(data)}\n`;
  const fillCalendars = (ids) => {
    data.calendars = {};
    for (const id of ids.sort(compare)) data.calendars[id] = calendars[id];
  };
  fillCalendars(Object.keys(calendars));
  let text = encode();
  let gzipped = gzipSync(text, { level: 9 }).length;
  if (gzipped > BUDGET) {
    const kept = Object.keys(calendars).filter((id) => CORE_CALENDARS.includes(id));
    console.warn(
      `warning: ${(gzipped / 1024).toFixed(1)} KB gzipped is over budget; keeping only the core calendars`,
    );
    fillCalendars(kept);
    text = encode();
    gzipped = gzipSync(text, { level: 9 }).length;
  }
  if (gzipped > BUDGET) {
    console.error(
      `error: ${(gzipped / 1024).toFixed(1)} KB gzipped, over the ${BUDGET / 1024} KB budget; nothing written.`,
    );
    process.exit(1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);

  // Report
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const part = (value) => gzipSync(JSON.stringify(value), { level: 9 }).length;
  const bySport = (list) => {
    const counts = new Map();
    for (const item of list) counts.set(item.sport, (counts.get(item.sport) ?? 0) + 1);
    return [...counts].map(([sport, count]) => `${sport} ${count}`).join(', ');
  };
  const aliasCount = (list) => list.reduce((sum, item) => sum + item.aliases.length, 0);
  const fixtureCount = Object.values(data.calendars).reduce((sum, list) => sum + list.length, 0);
  console.log(`Wrote ${relative(ROOT, OUT)} (built ${built}, season ${season}, year ${year})`);
  console.log(`  ${keysNote}`);
  for (const line of sources) console.log(`  openfootball ${line}`);
  const missing = jobs
    .filter((job, index) => files[index] === undefined)
    .map((job) => `${job.folder}/${job.code}`);
  if (missing.length > 0) console.log(`  openfootball has no file for: ${missing.join(' ')}`);
  if (undated > 0) console.log(`  ${undated} matches without a date left out of the calendars`);
  if (missingTargets > 0) console.log(`  ${missingTargets} alias entries found no team`);
  console.log(`  countries     ${data.countries.length}`);
  console.log(
    `  competitions  ${data.competitions.length} (${aliasCount(data.competitions)} aliases): ${bySport(data.competitions)}`,
  );
  console.log(
    `  teams         ${data.teams.length} (${aliasCount(data.teams)} aliases): ${bySport(data.teams)}`,
  );
  console.log(`  names shared across sports: ${crossSport}`);
  console.log(
    `  uefa          ${Object.entries(data.uefa)
      .map(([id, clubs]) => `${id} ${clubs.length}`)
      .join(', ')}`,
  );
  console.log(
    `  calendars     ${fixtureCount} fixtures: ${Object.entries(data.calendars)
      .map(([id, list]) => `${id} ${list.length}`)
      .join(', ')}`,
  );
  console.log(
    `  gzipped parts: competitions ${kb(part(data.competitions))}, teams ${kb(part(data.teams))}, calendars ${kb(part(data.calendars))}, uefa ${kb(part(data.uefa))}`,
  );
  console.log(
    `  size          ${kb(Buffer.byteLength(text))} raw, ${kb(gzipped)} gzipped (budget ${kb(BUDGET)})`,
  );
  if (warnings.length > 0) console.log(`  ${warnings.length} warnings`);
}

main().catch((cause) => {
  console.error(`error: ${cause.message}`);
  process.exit(1);
});
