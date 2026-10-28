import { sortStable } from './sort';

/**
 * Reading sports items' text: folding names for comparison, taking live
 * markers and scores off titles, and finding the two teams. Every pattern
 * here comes from a real addon (docs/PLAN.md, Sports addons; the findings
 * report in the project files). Plain ES2017 regular expressions only: no
 * lookbehind, named groups or `\p{}` classes, which webOS 5 cannot parse.
 */

// Letters NFD does not split into a base letter and a mark.
const FOLD: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ı: 'i',
  þ: 'th',
};

// Emoji, pictographs, flags (regional indicators), arrows, stars, dingbats,
// keycaps, variation selectors, zero-width characters and Unicode tag
// characters, by explicit code-point ranges.
const DECORATION =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{200B}-\u{200F}\u{2060}-\u{2064}\u{FEFF}\u{E0000}-\u{E007F}]|\u{20E3}|[\u{FE00}-\u{FE0F}]/gu;

const COMBINING = /[̀-ͯ]/g;

/** Text without emoji, flags and invisible characters, spaces collapsed. */
export function stripDecorations(text: string): string {
  return text.replace(DECORATION, ' ').replace(/\s+/g, ' ').trim();
}

/** Lower case, accents folded, decorations gone: for comparing, never for showing. */
export function foldText(text: string): string {
  let folded = stripDecorations(text).toLowerCase();
  if (typeof folded.normalize === 'function') folded = folded.normalize('NFD');
  folded = folded.replace(COMBINING, '');
  return folded.replace(/[ßøæœłđðıþ]/g, (letter) => FOLD[letter] ?? letter);
}

// Club-form words dropped at either end of a team name, so "Arsenal FC",
// "FC Arsenal" and "Arsenal" compare equal. Only whole words, and never when
// nothing would be left.
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

const WORD_MAP: Record<string, string> = {
  utd: 'united',
  st: 'saint',
  ste: 'sainte',
};

/**
 * A team name as a lookup key: folded, punctuation gone, `Utd`, `St` and `&`
 * spelled out, club-form words and founding years at either end dropped.
 */
export function teamKey(name: string): string {
  const words = foldText(name)
    .replace(/&/g, ' and ')
    .replace(/[.'’`´"(),/\\_:;!?*+]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => WORD_MAP[word] ?? word);
  // "1. FC Köln": a number before the club words.
  while (words.length > 1 && /^\d{1,2}$/.test(words[0]!) && CLUB_WORDS.has(words[1]!)) {
    words.shift();
  }
  while (words.length > 1 && CLUB_WORDS.has(words[0]!)) words.shift();
  while (
    words.length > 1 &&
    (CLUB_WORDS.has(words[words.length - 1]!) || /^(18|19|20)\d\d$/.test(words[words.length - 1]!))
  ) {
    words.pop();
  }
  return words.join(' ');
}

/** A competition name as a lookup key: folded, punctuation gone. */
export function competitionKey(name: string): string {
  return foldText(name)
    .replace(/&/g, ' and ')
    .replace(/[.'’`´"(),/\\_:;!?*+|]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a side's name says about it beyond the club. */
export interface SideMarks {
  youth: boolean;
  reserve: boolean;
  women: boolean;
}

const YOUTH =
  /\b(?:u-?\s?(?:15|16|17|18|19|20|21|22|23)|under[- ](?:17|18|19|21|23)|youth|juniors?|academy|primavera)\b/i;
const RESERVE = /\b(?:res\.?|reserves?|ii|b team)$|\s(?:ii|b)$/i;
const WOMEN =
  /\b(?:women|womens|women's|ladies|femenino|feminino|f[eé]minin[e]?|frauen|dames|vrouwen|w)$|\b(?:women|ladies)\b/i;

/** The club's own name, with youth, reserve and women's marks taken off and noted. */
export function readSide(name: string): { base: string; marks: SideMarks } {
  let base = name.trim();
  const marks: SideMarks = { youth: false, reserve: false, women: false };
  for (let round = 0; round < 3; round++) {
    const before = base;
    if (YOUTH.test(base)) {
      marks.youth = true;
      base = base.replace(YOUTH, ' ');
    }
    if (WOMEN.test(base)) {
      marks.women = true;
      base = base.replace(WOMEN, ' ');
    }
    if (RESERVE.test(base)) {
      marks.reserve = true;
      base = base.replace(RESERVE, ' ');
    }
    base = base
      .replace(/\s+/g, ' ')
      .replace(/[\s(-]+$/, '')
      .trim();
    if (base === before) break;
  }
  return { base: base === '' ? name.trim() : base, marks };
}

// Live markers in front of a title, in the languages seen.
// Longest first, and whole words only: "Liverpool" is not "LIVE" + "rpool".
const LIVE_PREFIX =
  /^(?:live now|live|en vivo|ao vivo|en direct|in diretta|diretta|vivo)\b\s*(?:[:·|•\-–—!]\s*)?/i;
const LIVE_WORD =
  /^(?:live|live now|🔴\s*live|en vivo|ao vivo|en direct|in diretta|diretta|vivo)$/i;
// A score, "2-1", "2 - 1" or "(2-1)", at the end, or a match minute "67'". Whole
// numbers only: "NBA 2025-26" is a season, not "NBA 2" and a score of 025-26.
const TRAILING_SCORE = /\s*(?:\(\s*\d{1,3}\s*[-–:]\s*\d{1,3}\s*\)|\b\d{1,3}\s*[-–]\s*\d{1,3})\s*$/;

/** Whether a short label (releaseInfo, a name prefix) says the event is live. */
export function isLiveLabel(text: string | undefined): boolean {
  if (!text) return false;
  const plain = stripDecorations(text);
  if (LIVE_WORD.test(plain)) return true;
  // A match minute, "67'" or "45+2'".
  return /^\d{1,3}(?:\+\d{1,2})?['’]$/.test(plain);
}

export interface CleanTitle {
  /** The title without live markers, clocks or a trailing score. */
  title: string;
  live: boolean;
  /** A clock found in the title, "19:45", with a day and month when given. */
  clock?: { hours: number; minutes: number; day?: number; month?: number; year?: number };
}

// "⏰ 19:45 - 27/10" or "19:45 27/10/2026" anywhere in a title.
const TITLE_CLOCK =
  /(?:⏰\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?:\s*[-–,]?\s*\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b)?/;

/** Takes live markers, a clock and a score off an item's name. */
export function cleanTitle(name: string): CleanTitle {
  const hadClockEmoji = name.indexOf('⏰') !== -1;
  let title = stripDecorations(name);
  let live = /^\s*🔴/.test(name);
  for (let round = 0; round < 3; round++) {
    const next = title.replace(LIVE_PREFIX, '');
    if (next === title) break;
    live = true;
    title = next.trim();
  }
  const result: CleanTitle = { title, live };
  const clock = TITLE_CLOCK.exec(title);
  // Only a clock with a date or the alarm-clock emoji: "19:45" alone could be part of a name.
  if (clock && (hadClockEmoji || clock[3] !== undefined)) {
    result.clock = { hours: Number(clock[1]), minutes: Number(clock[2]) };
    if (clock[3] !== undefined) {
      result.clock.day = Number(clock[3]);
      result.clock.month = Number(clock[4]);
      if (clock[5] !== undefined) {
        const year = Number(clock[5]);
        result.clock.year = year < 100 ? 2000 + year : year;
      }
    }
    title = (title.slice(0, clock.index) + ' ' + title.slice(clock.index + clock[0].length))
      .replace(/^\s*[-–|·:]\s*/, '')
      .replace(/\s*[-–|·:]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (/\bvs?\.?\b|\s@\s|\sat\s/i.test(title)) title = title.replace(TRAILING_SCORE, '').trim();
  result.title = title;
  return result;
}

export type Separator = 'vs' | 'at' | 'dash';

export interface TeamSplit {
  /** As the addon wrote them, home first even for "Away at Home". */
  home: string;
  away: string;
  separator: Separator;
  /** Text before the teams, such as "Serie A" in "Serie A: Roma vs Cagliari". */
  prefix?: string;
  /** Text after the teams, such as "3rd T20I" in "New Zealand vs India - 3rd T20I". */
  suffix?: string;
}

// " vs ", " vs. ", " v ", " VS ".
const VS = /\s+(?:vs?\.?|versus)\s+/i;
const AT = /\s+(?:@|at)\s+/i;
const DASH = /\s+[-–]\s+/;

function prefixAndSide(text: string): { prefix?: string; side: string } {
  // "Country - Competition : Home" or "Competition: Home". A competition can end in a
  // number ("Ligue 1: Paris Saint-Germain", "UFC 310: Pantoja"); a time ("19:45: Celtic") is
  // no competition, so it is dropped with the colon.
  const colon = /^(.*\S)\s*:\s+(\S.*)$/.exec(text);
  if (!colon) return { side: text.trim() };
  const prefix = colon[1]!.trim();
  const side = colon[2]!.trim();
  return /^\d{1,2}[:.]\d{2}$/.test(prefix) ? { side } : { prefix, side };
}

function suffixAndSide(text: string): { side: string; suffix?: string } {
  const dash = /^(.*?\S)\s+[-–|]\s+(\S.*)$/.exec(text);
  if (dash) return { side: dash[1]!.trim(), suffix: dash[2]!.trim() };
  return { side: text.trim() };
}

function plausible(side: string): boolean {
  return side.length >= 2 && side.length <= 60 && /[a-z]/i.test(foldText(side));
}

/**
 * The two teams in a title, or undefined for a race, a show or a
 * competition-named item. `at` and `@` put the away team first; the caller
 * decides whether to believe them (US sports, or two known teams). A dash is
 * only a separator when nothing else is.
 */
export function splitTeams(title: string): TeamSplit | undefined {
  for (const [pattern, separator] of [
    [VS, 'vs'],
    [AT, 'at'],
  ] as const) {
    const match = pattern.exec(title);
    if (!match) continue;
    const left = prefixAndSide(title.slice(0, match.index));
    const right = suffixAndSide(title.slice(match.index + match[0].length));
    if (!plausible(left.side) || !plausible(right.side)) continue;
    const split: TeamSplit =
      separator === 'at'
        ? { home: right.side, away: left.side, separator }
        : { home: left.side, away: right.side, separator };
    if (left.prefix) split.prefix = left.prefix;
    if (right.suffix) split.suffix = right.suffix;
    return split;
  }
  const dash = DASH.exec(title);
  if (dash && title.slice(dash.index + dash[0].length).search(DASH) === -1) {
    const home = title.slice(0, dash.index).trim();
    const away = title.slice(dash.index + dash[0].length).trim();
    if (
      plausible(home) &&
      plausible(away) &&
      home.split(' ').length <= 5 &&
      away.split(' ').length <= 5
    ) {
      return { home, away, separator: 'dash' };
    }
  }
  return undefined;
}

/** A college ranking in front of a team, "7 Ole Miss" or "#7 Ole Miss". */
export function dropRanking(side: string): string {
  return side.replace(/^#?\d{1,2}\s+(?=\D)/, '').trim();
}

const SEQUENCE =
  /\b(game|day|leg|race|match|test|odi|t20i?)\s*#?(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+(test|odi|t20i?|game|day|leg)\b/gi;
// More numbers than this in one name is junk, not a match.
const MAX_SEQUENCE_PARTS = 3;

/**
 * "Game 2", "Day 3", "Leg 2", "Race 1" in a title: copies merge only with the
 * same numbers. Every one counts, so "1st Test Day 1" and "1st Test Day 2" are
 * two days of one Test ("day1-test1", "day2-test1"), in either order.
 */
export function sequenceNumber(text: string): string | undefined {
  const parts: string[] = [];
  SEQUENCE.lastIndex = 0;
  for (let match = SEQUENCE.exec(text); match; match = SEQUENCE.exec(text)) {
    const part = match[1]
      ? `${match[1].toLowerCase()}${match[2]}`
      : `${match[4]!.toLowerCase()}${match[3]}`;
    if (parts.indexOf(part) !== -1) continue;
    parts.push(part);
    if (parts.length === MAX_SEQUENCE_PARTS) break;
  }
  SEQUENCE.lastIndex = 0;
  if (parts.length === 0) return undefined;
  return sortStable(parts, (a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('-');
}

/** A `League:`, `Competition:` or `Tournament:` line in a description. */
export function competitionLine(description: string | undefined): string | undefined {
  if (!description) return undefined;
  for (const line of description.split('\n')) {
    const match =
      /^\s*(?:league|competition|tournament|torneo|liga|competici[oó]n|comp[eé]tition)\s*:\s*(.+)$/i.exec(
        stripDecorations(line),
      );
    if (match) {
      const value = match[1]!.trim();
      if (value !== '') return value;
    }
  }
  return undefined;
}

/** A `league`, `lg` or `competition` query parameter in an artwork address. */
export function artworkCompetition(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /[?&](?:league|lg|competition)=([^&#]+)/i.exec(url);
  if (!match) return undefined;
  try {
    const value = decodeURIComponent(match[1]!.replace(/\+/g, ' ')).trim();
    return value === '' || /^\d+$/.test(value) ? undefined : value;
  } catch {
    return undefined;
  }
}

/** A SofaScore `unique-tournament/<n>` id in an artwork address. */
export function sofascoreTournament(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const match = /unique-tournament\/(\d{1,7})\b/.exec(url);
  return match ? Number(match[1]) : undefined;
}

/**
 * Lower-case letters, digits and dashes, for keys that also become focus
 * keys. Folds accents first, so "Bayern München" and "Bayern Munchen" agree.
 */
export function slugOf(text: string): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
