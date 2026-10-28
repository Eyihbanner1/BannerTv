import type { MetaPreview } from '@bannertv/protocol';
import { AWAY_FIRST_SPORTS, isSportLabel, sportOf, TEAM_SPORTS } from './sport';
import {
  artworkCompetition,
  cleanTitle,
  competitionLine,
  dropRanking,
  foldText,
  isLiveLabel,
  readSide,
  type Separator,
  type SideMarks,
  sequenceNumber,
  sofascoreTournament,
  splitTeams,
  stripDecorations,
  teamKey,
} from './text';
import { nextDayAt, readKickOff } from './time';
import type { CompetitionSource, EventSource, ItemKind, KickOff, Sport } from './types';

/** What BannerTV knows about the catalog an item came from. */
export interface CatalogContext {
  addonIndex: number;
  addonId: string;
  transportUrl: string;
  catalogId: string;
  /** The sport the catalog's name gives, for a catalog per sport. */
  sport?: Sport;
  /** A replays, recaps or highlights catalog. */
  replays: boolean;
  /** A TV, channels or 24/7 catalog. */
  channels: boolean;
  /** The genre option the page was asked for. */
  genreOption?: string;
  /** The zone the addon's install address names. */
  zone?: string;
}

export interface Side {
  /** As the addon wrote it, ranking and live markers taken off. */
  name: string;
  /** For lookups: folded, club words and youth, reserve or women's marks gone. */
  key: string;
  marks: SideMarks;
}

/** One item of one catalog page, read once (docs/PLAN.md, Event model). */
export interface Listing {
  source: EventSource;
  kind: ItemKind;
  /** The sport the addon gives: its catalog, a genre or a category. */
  addonSport?: Sport;
  /** The name without live markers, clocks or a score. */
  title: string;
  /** Home first, whatever the order in the name. */
  sides?: [Side, Side];
  separator?: Separator;
  /** The separator alone says these are teams (vs, or at in a US sport, or a dash in a team sport). */
  teamsTrusted: boolean;
  /** "game2", "day2-test1": copies merge only with the same numbers. */
  sequence?: string;
  /** Competition names the item gives, best first. */
  competitions: Array<{ text: string; source: CompetitionSource }>;
  /** A suffix that may be a competition, used only when the dictionary knows it. */
  suffix?: string;
  /** A cup round or stage the addon sent. */
  round?: string;
  sofascore?: number;
  kickOff?: KickOff;
  liveLabel: boolean;
}

// Genres that say nothing about the competition.
const GENERIC =
  /^(?:sports?|live|live now|live tv|tv|tv channels?|channels?|networks?|events?|today|upcoming|replays?|recaps?|highlights?|other|others|misc|all|24\/7|ppv|hd|fhd|uhd|4k)$/i;

const PLACEHOLDER =
  /\b(?:no (?:(?:more|live|other|upcoming) )*(?:streams?|events?|matches|games|fixtures)\b|private manifest|manifest required|configure|reinstall|please (?:install|update|visit|support)|coming soon|not available|nothing (?:live|on)|check back)/i;

const SEASON_EPISODE = /\bS\d{1,3}\s*,?\s*E\d{1,4}\b/i;

const REPLAY = /\b(?:recap|replay|replays|highlights|full match|full game|catch ?up|re-?run)\b/i;

const STAGE =
  /\b(?:round|final|finals|semi|quarter|group|leg|matchday|week|day|test|odi|t20i?|stage|qualifying|qualifier|playoff|play-off|game|race|practice|sprint)\b/i;

// A name prefix that is only a stage and its number ("Game 7: Lakers vs Celtics",
// "Week 9: Bills at Chiefs"): the round, never a competition.
const STAGE_PREFIX =
  /^(?:(?:round|matchday|week|game|day|leg|race|match|stage)\s*#?\d{1,3}|\d{1,2}(?:st|nd|rd|th)\s+(?:round|leg|game|day|week|stage))$/i;

const MAX_GENRES = 8;

function itemKind(item: MetaPreview, context: CatalogContext, title: string): ItemKind {
  const id = item.id.toLowerCase();
  if (
    context.channels ||
    id.indexOf('leaf:') === 0 ||
    id.indexOf('ttv:') === 0 ||
    id.indexOf('_ch_') !== -1 ||
    item.releaseInfo === '24/7' ||
    item.genres.slice(0, MAX_GENRES).some((genre) => /^networks?$/i.test(genre))
  ) {
    return 'channel';
  }
  // "NCIS S24, E4" or "Nick Cannon @ Night S1, E2" on a channel's schedule: a TV programme.
  if (SEASON_EPISODE.test(title)) return 'channel';
  const hasTeams = splitTeams(title) !== undefined;
  if (!hasTeams && PLACEHOLDER.test(item.name)) return 'placeholder';
  if (
    context.replays ||
    id.indexOf('recap:') === 0 ||
    id.indexOf('replay:') === 0 ||
    REPLAY.test(item.name) ||
    item.genres.slice(0, MAX_GENRES).some((genre) => REPLAY.test(genre))
  ) {
    return 'replay';
  }
  return 'event';
}

function side(name: string, sport: Sport | undefined): Side {
  const plain = sport && AWAY_FIRST_SPORTS.has(sport) ? dropRanking(name) : name.trim();
  const { base, marks } = readSide(plain);
  return { name: plain, key: teamKey(base), marks };
}

// A trailing sport word both sides share: "Mamelodi Sundowns Cricket".
const SHARED_SPORT_WORD =
  /\s+(cricket|basketball|rugby league|rugby union|rugby|hockey|football|volleyball)$/i;

function dropSharedSportWord(sides: [Side, Side]): [Side, Side] {
  const a = SHARED_SPORT_WORD.exec(sides[0].name);
  const b = SHARED_SPORT_WORD.exec(sides[1].name);
  if (!a || !b || a[1]!.toLowerCase() !== b[1]!.toLowerCase()) return sides;
  return sides.map((s) => {
    const name = s.name.replace(SHARED_SPORT_WORD, '');
    const { base, marks } = readSide(name);
    return { name, key: teamKey(base), marks };
  }) as [Side, Side];
}

function addCompetition(
  list: Listing['competitions'],
  text: string | undefined,
  source: CompetitionSource,
): void {
  if (!text) return;
  const plain = stripDecorations(text).replace(/^[-–:·|\s]+|[-–:·|\s]+$/g, '');
  if (plain.length < 2 || plain.length > 80 || GENERIC.test(plain) || isSportLabel(plain)) return;
  // Channel codes such as "NOW-34334".
  if (/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(plain) && /\d/.test(plain)) return;
  if (list.some((entry) => foldText(entry.text) === foldText(plain))) return;
  list.push({ text: plain, source });
}

/**
 * Reads one catalog item. Pure and cheap enough to run on every item of a
 * response once; callers cache the result per item object.
 */
export function readListing(item: MetaPreview, context: CatalogContext, now: number): Listing {
  // Real items carry a few genres; a list of thousands is junk and must not cost seconds.
  const genres = item.genres.length > MAX_GENRES ? item.genres.slice(0, MAX_GENRES) : item.genres;
  const clean = cleanTitle(item.name);
  const kind = itemKind(item, context, clean.title);
  const hints = item.sport ?? {};
  // A name with no teams that is itself a sport ("Horse Racing", "Formula 1: Mexican Grand
  // Prix") says more than the tag an addon put on it.
  const titleSport = splitTeams(clean.title) === undefined ? sportOf(clean.title) : undefined;
  const addonSport =
    titleSport ??
    context.sport ??
    genres.map(sportOf).filter((sport) => sport !== undefined)[0] ??
    sportOf(hints.category);

  const source: EventSource = {
    addonIndex: context.addonIndex,
    addonId: context.addonId,
    transportUrl: context.transportUrl,
    type: item.type,
    id: item.id,
    name: item.name,
    catalogId: context.catalogId,
  };
  if (item.poster) source.poster = item.poster;
  if (item.background) source.background = item.background;

  const descriptionLive = (item.description ?? '')
    .split('\n')
    .some((line) => isLiveLabel(line) || /^\s*(?:🔴\s*)?live now\s*$/i.test(line));
  const liveLabel =
    isLiveLabel(item.releaseInfo) || clean.live || hints.live === true || descriptionLive;

  const listing: Listing = {
    source,
    kind,
    title: clean.title,
    teamsTrusted: false,
    competitions: [],
    liveLabel,
  };
  if (addonSport) listing.addonSport = addonSport;

  const split = hints.home && hints.away ? undefined : splitTeams(clean.title);
  if (hints.home && hints.away) {
    listing.sides = [side(hints.home, addonSport), side(hints.away, addonSport)];
    listing.separator = 'vs';
    listing.teamsTrusted = true;
  } else if (split) {
    listing.sides = dropSharedSportWord([
      side(split.home, addonSport),
      side(split.away, addonSport),
    ]);
    listing.separator = split.separator;
    listing.teamsTrusted =
      split.separator === 'vs' ||
      (split.separator === 'at' && addonSport !== undefined && AWAY_FIRST_SPORTS.has(addonSport)) ||
      (split.separator === 'dash' && addonSport !== undefined && TEAM_SPORTS.has(addonSport));
  }
  if (
    listing.sides &&
    (listing.sides[0].key === '' ||
      listing.sides[1].key === '' ||
      listing.sides[0].key === listing.sides[1].key)
  ) {
    delete listing.sides;
    delete listing.separator;
    listing.teamsTrusted = false;
  }
  const sequence = sequenceNumber(clean.title);
  if (sequence) listing.sequence = sequence;

  // Where the competition comes from, best first (docs/PLAN.md, Grouping, layer 2).
  if (context.genreOption)
    addCompetition(listing.competitions, context.genreOption, 'genre-option');
  addCompetition(listing.competitions, hints.league, 'description');
  addCompetition(listing.competitions, competitionLine(item.description), 'description');
  if (split?.prefix) {
    if (STAGE_PREFIX.test(split.prefix)) listing.round = split.prefix;
    else addCompetition(listing.competitions, split.prefix, 'name-prefix');
  }
  if (split?.suffix) {
    // "3rd T20I" is a stage; anything else may be a competition the dictionary knows.
    if (STAGE.test(split.suffix) || sequenceNumber(split.suffix)) listing.round = split.suffix;
    else listing.suffix = split.suffix;
  }
  genres.forEach((genre, index) => {
    // The first genre is usually the sport; any genre that is not one may name the competition.
    if (index === 0 && sportOf(genre) !== undefined && isSportLabel(genre)) return;
    addCompetition(listing.competitions, genre, 'genre');
  });
  addCompetition(listing.competitions, artworkCompetition(item.poster), 'artwork');
  addCompetition(listing.competitions, artworkCompetition(item.background), 'artwork');
  const sofascore = sofascoreTournament(item.background) ?? sofascoreTournament(item.poster);
  if (sofascore !== undefined) listing.sofascore = sofascore;

  // A LIVE label is not a time; the meta page or an earlier response may have one.
  const releaseInfo = isLiveLabel(item.releaseInfo) ? undefined : item.releaseInfo;
  const kickOff = readKickOff(
    {
      released: item.released,
      releaseInfo,
      description: item.description,
      nameClock: clean.clock,
      name: item.name,
      start: hints.start,
      replay: kind === 'replay',
    },
    { now, zone: context.zone },
  );
  if (kickOff) listing.kickOff = kickOff;
  return listing;
}

const HOUR = 60 * 60 * 1000;

/**
 * Clock-only times ("23:00") are read on the addon's current day. In a
 * catalog listed by kick-off, the list wraps past midnight where a clock goes
 * back by more than half a day ("22:00", "23:45", "00:30"): from there on the
 * times are the next day's, by the calendar in the addon's zone (docs/PLAN.md,
 * Time). A list whose clocks go back by less (beyond the hour live-first lists
 * allow) is not in kick-off order and is left as it is. Pass a catalog's
 * listings in the order the addon sent them, across its pages.
 */
export function rollClockWraps(listings: readonly Listing[], zone: string | undefined): Listing[] {
  const out = listings.slice();
  const wraps: number[] = [];
  let previous: number | undefined;
  for (let i = 0; i < out.length; i++) {
    const kickOff = out[i]!.kickOff;
    if (kickOff?.source !== 'clock' || kickOff.at === undefined) continue;
    if (previous !== undefined && kickOff.at < previous - HOUR) {
      if (kickOff.at > previous - 12 * HOUR) return out;
      wraps.push(i);
    }
    previous = kickOff.at;
  }
  let days = 0;
  for (let i = 0; i < out.length && wraps.length > 0; i++) {
    if (i === wraps[days]) days++;
    const listing = out[i]!;
    const kickOff = listing.kickOff;
    if (days === 0 || kickOff?.source !== 'clock' || kickOff.at === undefined) continue;
    const at = nextDayAt(kickOff.at, zone, days);
    if (at !== undefined) out[i] = { ...listing, kickOff: { ...kickOff, at } };
  }
  return out;
}
