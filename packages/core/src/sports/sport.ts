import { foldText } from './text';
import type { Sport } from './types';

const HOUR = 60 * 60 * 1000;

// Words in a catalog name, genre or category that name a sport. Checked in
// this order, so "American Football" is not football and "Ice Hockey" wins
// over a bare "Hockey".
const SPORT_WORDS: ReadonlyArray<readonly [RegExp, Sport]> = [
  [
    /\bamerican[ -]football\b|\bnfl\b|\bncaaf\b|\bcfl\b|\bcollege football\b|\bgridiron\b/,
    'american-football',
  ],
  [/\baussie rules\b|\bafl\b|\baustralian football\b/, 'aussie-rules'],
  [
    /\bfootball\b|\bsoccer\b|\bfutbol\b|\bfutebol\b|\bcalcio\b|\bvoetbal\b|\bfussball\b|\bfutsal\b/,
    'football',
  ],
  [
    /\bbasketball\b|\bbasket\b|\bnba\b|\bwnba\b|\bncaab\b|\beuroleague\b|\bbaloncesto\b/,
    'basketball',
  ],
  [/\bice[ -]hockey\b|\bhockey\b|\bnhl\b|\bkhl\b/, 'ice-hockey'],
  [/\bbaseball\b|\bmlb\b/, 'baseball'],
  [/\btennis\b|\batp\b|\bwta\b/, 'tennis'],
  [/\bcricket\b|\bipl\b|\bt20i?\b|\bodi\b|\bbig bash\b/, 'cricket'],
  [/\brugby\b|\bnrl\b|\bsuper league\b|\bsix nations\b/, 'rugby'],
  // Before motor sport's "racing": no row of its own, but never motor sport.
  [/\bhorse racing\b|\bgreyhounds?\b|\bequestrian\b|\bhorse\b/, 'other'],
  [
    /\bmotor ?sports?\b|\bformula 1\b|\bformula one\b|\bf1\b|\bmotogp\b|\bnascar\b|\bindycar\b|\bracing\b|\bwrc\b|\bgrand prix\b/,
    'motorsport',
  ],
  [/\bufc\b|\bmma\b|\bmixed martial arts\b|\bbellator\b|\bpfl\b/, 'mma'],
  [
    /\bboxing\b|\bboxeo\b|\bfight\b|\bfights\b|\bfighting\b|\bwrestling\b|\bwwe\b|\baew\b/,
    'boxing',
  ],
  [/\bgolf\b|\bpga\b|\bliv golf\b|\bryder cup\b/, 'golf'],
  [/\bdarts\b|\bpdc\b/, 'darts'],
  [/\bsnooker\b|\bbilliards?\b|\bpool\b/, 'snooker'],
];

/** The sport a name, genre or category names, if any. */
export function sportOf(text: string | undefined): Sport | undefined {
  if (!text) return undefined;
  const folded = foldText(text).replace(/[_-]+/g, ' ');
  // "Fight (UFC, Boxing)": the longer window of the two.
  if (/\bufc\b|\bmma\b/.test(folded)) return 'mma';
  for (const [pattern, sport] of SPORT_WORDS) if (pattern.test(folded)) return sport;
  return undefined;
}

// Labels that name only a sport, never a competition: "FOOTBALL", "Ice Hockey", "Motor Sports".
const SPORT_LABEL =
  /^(?:sports?\s+)?(?:(?:men'?s|women'?s|mens|womens)\s+)?(?:football|soccer|futbol|futebol|calcio|voetbal|fussball|futsal|american football|gridiron|basketball|basket|baloncesto|hockey|ice hockey|baseball|tennis|cricket|rugby|rugby union|rugby league|motor ?sports?|racing|mma|mixed martial arts|boxing|boxeo|fights?|fighting|wrestling|golf|darts|snooker|billiards?|pool|aussie rules|australian football|horse racing)$/;

/** A label that is only a sport, such as a first genre: never read as a competition. */
export function isSportLabel(text: string): boolean {
  return SPORT_LABEL.test(foldText(text).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Sports played by two named sides, where a dash between two names can be read as teams. */
export const TEAM_SPORTS: ReadonlySet<Sport> = new Set<Sport>([
  'football',
  'basketball',
  'american-football',
  'ice-hockey',
  'baseball',
  'cricket',
  'rugby',
  'aussie-rules',
]);

/** Sports whose fixtures are often written "Away at Home". */
export const AWAY_FIRST_SPORTS: ReadonlySet<Sport> = new Set<Sport>([
  'american-football',
  'basketball',
  'ice-hockey',
  'baseball',
]);

/**
 * How long after kick-off an event counts as live (docs/PLAN.md, Time, live
 * and finished). Football and rugby stretch to 3 hours while an addon still
 * marks the match live, for extra time and penalties.
 */
export function liveWindow(sport: Sport, addonSaysLive: boolean): number {
  switch (sport) {
    case 'football':
    case 'rugby':
      return (addonSaysLive ? 3 : 2.5) * HOUR;
    case 'basketball':
    case 'ice-hockey':
      return 3 * HOUR;
    case 'baseball':
      return 3.5 * HOUR;
    case 'american-football':
    case 'tennis':
    case 'motorsport':
    case 'darts':
      return 4 * HOUR;
    case 'boxing':
      return 5 * HOUR;
    case 'mma':
    case 'golf':
      return 6 * HOUR;
    case 'cricket':
      return 8 * HOUR;
    default:
      return 3 * HOUR;
  }
}
