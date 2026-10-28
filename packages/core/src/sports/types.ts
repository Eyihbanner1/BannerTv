/**
 * The sports view: matches read out of sports addons' catalogs, grouped by
 * competition. See docs/PLAN.md, "Sports addons", for the rules these follow.
 */

/**
 * The sports BannerTV tells apart. The live windows, merging and grouping
 * depend on it; anything else is `other`.
 */
export type Sport =
  | 'football'
  | 'basketball'
  | 'american-football'
  | 'ice-hockey'
  | 'baseball'
  | 'tennis'
  | 'cricket'
  | 'rugby'
  | 'motorsport'
  | 'boxing'
  | 'mma'
  | 'golf'
  | 'darts'
  | 'snooker'
  | 'aussie-rules'
  | 'other';

/** What an item in a sports catalog is. Placeholders ("no streams today") are dropped. */
export type ItemKind = 'event' | 'channel' | 'replay' | 'placeholder';

/** Where a value came from, best first within each list. Kept for tests and diagnostics. */
export type CompetitionSource =
  /** A genre option the catalog was asked for. */
  | 'genre-option'
  /** A `League:`, `Competition:` or `Tournament:` line in the description. */
  | 'description'
  /** `Competition: Home vs Away` or `Country - Competition : Home vs Away`. */
  | 'name-prefix'
  /** ` - Competition` after the teams, only when the dictionary knows it. */
  | 'name-suffix'
  /** A second genre that is not the sport. */
  | 'genre'
  /** A `league`, `lg` or `competition` parameter in the artwork's address. */
  | 'artwork'
  /** Both teams play each other in a bundled league calendar within a day of kick-off. */
  | 'calendar'
  /** Both teams are in the same closed league (NFL, NBA, NHL, MLB) or UEFA competition. */
  | 'teams'
  /** The teams' country, or Europe, or youth or women's football: not a competition. */
  | 'country'
  | 'other';

export type KickOffSource =
  | 'released'
  | 'dated-text'
  | 'name-clock'
  | 'iso-key'
  | 'epoch'
  | 'clock'
  | 'date-only'
  /** Worked out from the items around it in a catalog sorted by kick-off. */
  | 'estimated'
  /** Remembered from an earlier response, after the addon replaced it with LIVE. */
  | 'remembered';

export interface KickOff {
  /** The kick-off, in ms since 1970 (UTC). Undefined for a date only. */
  at?: number;
  /** For a date only: the calendar date the addon gave, YYYY-MM-DD. */
  date?: string;
  /** False for times read in a zone BannerTV had to assume, or estimated. */
  sure: boolean;
  source: KickOffSource;
}

/** One item as one addon listed it. Never holds the addon's address, which can carry a key. */
export interface EventSource {
  /** The addon's place in the collection, for "first addon wins" and stream requests. */
  addonIndex: number;
  addonId: string;
  /** Which install it is: two installs of one addon (other settings) share an id. */
  transportUrl: string;
  type: string;
  id: string;
  name: string;
  poster?: string;
  background?: string;
  catalogId: string;
}

/** A competition as BannerTV shows it: one row heading. */
export interface Competition {
  /**
   * Stable within a launch: a dictionary id (`eng.1`), `text:<normalised name>`
   * for one the dictionary does not know, `country:<code>:<sport>`,
   * `group:<name>:<sport>` or `other:<sport>`.
   */
  key: string;
  name: string;
  sport: Sport;
  /** A country code from the dictionary, shown only to tell apart two of the same name. */
  country?: string;
  /** Lower comes first. Competitions the dictionary does not know get a high number. */
  priority: number;
  source: CompetitionSource;
  /** A cup round or stage, when the addon sent one ("Round 3", "3rd T20I"). */
  round?: string;
}

export type EventState =
  | 'upcoming'
  /** Within 15 minutes of kick-off. */
  | 'soon'
  | 'live'
  /** The addon says LIVE but BannerTV has no kick-off to check it against. */
  | 'live-unknown'
  | 'ended'
  /** No kick-off, no date and no live label. */
  | 'no-time';

/** One match (or race, fight, session), merged from every catalog and addon that lists it. */
export interface SportEvent {
  /** Stable while the same items are listed: the first source's addon and id. */
  key: string;
  kind: Exclude<ItemKind, 'placeholder'>;
  sport: Sport;
  /** The name to show when there are no teams, e.g. "Formula 1: Mexican Grand Prix". */
  title: string;
  home?: string;
  away?: string;
  competition: Competition;
  kickOff?: KickOff;
  /** Some addon still labels it live. */
  liveLabel: boolean;
  /** Every listing, best first: the first source is the one shown and asked first. */
  sources: EventSource[];
  /** Normalised team names, for search and merging. */
  teamKeys: string[];
  /**
   * The competition the addon named, when the row groups by sport instead
   * (every sport but football and the four US leagues): "IPL", "ATP Paris".
   */
  note?: string;
}

export interface SportsGroup {
  /** Stable while the day and competition are the same; [a-z0-9-] only, safe for focus keys. */
  key: string;
  competition: Competition;
  /** What the heading says: the competition, or "Earlier today", "Replays" and so on. */
  title: string;
  kind: 'competition' | 'earlier' | 'replays' | 'unknown-live';
  events: SportEvent[];
  /** How many of `events` are live now, for "2 live of 5". */
  live: number;
}

/** A day in the day strip: `live`, or a local calendar date YYYY-MM-DD. */
export type SportsDay = 'live' | string;

/** A row of the dictionary: a competition BannerTV can name. */
export interface CompetitionEntry {
  id: string;
  name: string;
  sport: Sport;
  /** ISO 3166-1 alpha-2, or `GB-ENG`, `GB-SCT`, `GB-WLS`, `GB-NIR`, or `EU` and `INT`. */
  country: string;
  kind: 'league' | 'cup' | 'international';
  women?: boolean;
  youth?: boolean;
  /** Lower comes first; UK football first (docs/PLAN.md, Screens). */
  priority: number;
  aliases: string[];
  /** SofaScore `unique-tournament` ids that name this competition. */
  sofascore?: number[];
}

/** A row of the dictionary: a team and where it usually plays. */
export interface TeamEntry {
  name: string;
  sport: Sport;
  country: string;
  /** The competition id of its usual league, when the dictionary knows it. */
  league?: string;
  aliases: string[];
}

export interface CountryEntry {
  code: string;
  name: string;
  /** For "German football". */
  adjective: string;
}

/**
 * The bundled matcher data (docs/PLAN.md, Matcher data). Public-domain facts
 * only, built by tools/sports-data/build.mjs.
 */
export interface SportsData {
  version: number;
  /** When the data was built, YYYY-MM-DD. */
  built: string;
  countries: CountryEntry[];
  competitions: CompetitionEntry[];
  teams: TeamEntry[];
  /** League-phase clubs of this season's UEFA club competitions, by competition id. */
  uefa: Record<string, string[]>;
  /**
   * League fixtures, by competition id: [date YYYY-MM-DD, home, away], with
   * team names as the team dictionary spells them.
   */
  calendars: Record<string, Array<[string, string, string]>>;
}
