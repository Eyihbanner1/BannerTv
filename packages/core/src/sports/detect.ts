import { findExtra, type ManifestCatalog, type MetaPreview } from '@bannertv/protocol';
import type { InstalledAddon } from '../addons/collection';
import { sportOf } from './sport';
import { cleanTitle, foldText, isLiveLabel, splitTeams, slugOf } from './text';
import { zoneFromAddress } from './time';
import type { Sport } from './types';

/** "Show in Sports" on an addon's settings page (docs/PLAN.md, Detection). */
export type SportsSetting = 'auto' | 'yes' | 'no';

/** What a sports catalog holds, read from its name and id, never from the addon's name. */
export type CatalogView =
  'live' | 'today' | 'upcoming' | 'sport' | 'replays' | 'channels' | 'other';

export interface SportsCatalog {
  /** Unique and stable while the collection does not change; [a-z0-9-] only. */
  key: string;
  addon: InstalledAddon;
  /** The addon's place in the collection. */
  addonIndex: number;
  catalog: ManifestCatalog;
  view: CatalogView;
  /** The sport the catalog's name gives, for a catalog per sport. */
  sport?: Sport;
  /** The catalog declares `skip`. */
  pageable: boolean;
  /** The catalog answers only with `skip` (replay hubs that mark it required). */
  skipRequired: boolean;
  /** Genre options the catalog lists, when the genre is optional. */
  genres: readonly string[];
  /** The zone the install address names, for clock-only times. */
  zone?: string;
}

/** Words that name a sport in general, for "Other Sports" or Spanish "deportes". */
const SPORTS_WORD = /\bsports?\b|\bdeportes?\b|\besportes?\b|\bmatch(?:es)?\b|\bfixtures?\b/;
const REPLAYS =
  /\breplays?\b|\brecaps?\b|\bhighlights?\b|\bcatch ?up\b|\bfull match(?:es)?\b|\breruns?\b/;
const CHANNELS = /\btv\b|\bchannels?\b|\b24 ?7\b|\biptv\b|\bnetworks?\b|\bradio\b/;
const LIVE = /\blive\b|\ben vivo\b|\ben directo\b|\bao vivo\b|\bdirect\b/;
const TODAY = /\btoday\b|\btonight\b|\bhoy\b|\bhoje\b/;
const UPCOMING =
  /\bupcoming\b|\bschedule\b|\bnext\b|\bsoon\b|\btomorrow\b|\bthis week\b|\bcalendar\b|\bevents?\b/;
// Types movies and series addons use: a name such as "Boxing Films" is not enough there.
const TITLE_TYPES = ['movie', 'series'];

function words(catalog: ManifestCatalog): string {
  // Ids such as "sports_motor_sports" and "nuvio_sports_live": underscores and dashes are spaces.
  return foldText(`${catalog.name} ${catalog.id}`)
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * The one sport a catalog's name gives. A name that lists two ("Fight (UFC,
 * Boxing)") gives none: its items say which.
 */
function catalogSport(catalog: ManifestCatalog): Sport | undefined {
  const named = new Set<Sport>();
  for (const part of foldText(catalog.name).split(/[(),/&+|]| and /)) {
    const sport = sportOf(part);
    if (sport) named.add(sport);
  }
  if (named.size > 1) return undefined;
  if (named.size === 1) return named.values().next().value;
  return sportOf(words(catalog));
}

/** What the catalog's name and id say it holds, and its sport if it names one. */
export function catalogView(catalog: ManifestCatalog): { view: CatalogView; sport?: Sport } {
  const text = words(catalog);
  const sport = catalogSport(catalog);
  const result = (view: CatalogView) => (sport ? { view, sport } : { view });
  if (REPLAYS.test(text)) return result('replays');
  // "24/7 Live TV" and "IPTV" are channels, live or not.
  if (CHANNELS.test(text)) return result('channels');
  if (LIVE.test(text)) return result('live');
  if (TODAY.test(text)) return result('today');
  if (UPCOMING.test(text)) return result('upcoming');
  return result(sport ? 'sport' : 'other');
}

/** The name or id names a sport, or "sports" in general. */
function namesSport(catalog: ManifestCatalog): boolean {
  const text = words(catalog);
  return sportOf(text) !== undefined || SPORTS_WORD.test(text);
}

/** The name or id names a view sports addons have: live, today, upcoming, replays. */
function namesSportsView(catalog: ManifestCatalog): boolean {
  const text = words(catalog);
  return LIVE.test(text) || TODAY.test(text) || UPCOMING.test(text) || REPLAYS.test(text);
}

/**
 * Whether what a first page looks like can change the answer for this
 * catalog, so Home and Discover note it. Catalogs typed sport are sports
 * catalogs whatever they hold; catalogs that name neither a sport nor a
 * sports view never are.
 */
export function needsEvidence(catalog: ManifestCatalog): boolean {
  const type = foldText(catalog.type);
  if (type === 'sport' || type === 'sports') return false;
  return namesSport(catalog) || namesSportsView(catalog);
}

/**
 * Whether a first page reads as sport: at least 3 items, and most of them
 * matches (`A vs B`, `A at B`) or live-labelled. Channels and placeholders
 * count against it.
 */
export function looksLikeSports(items: readonly MetaPreview[]): boolean {
  const sample = items.slice(0, 30);
  if (sample.length < 3) return false;
  let sporty = 0;
  for (const item of sample) {
    const clean = cleanTitle(item.name);
    if (
      splitTeams(clean.title) !== undefined ||
      clean.live ||
      isLiveLabel(item.releaseInfo) ||
      item.sport?.home !== undefined ||
      item.sport?.live === true
    ) {
      sporty++;
    }
  }
  return sporty * 2 > sample.length;
}

/** A catalog the feed can ask without a search term or another value it does not have. */
function askable(catalog: ManifestCatalog): boolean {
  return catalog.extra.every(
    (extra) =>
      !extra.isRequired ||
      extra.name === 'skip' ||
      (extra.name === 'genre' && extra.options.length > 0),
  );
}

export interface DetectOptions {
  /** The addon's "Show in Sports" setting. */
  setting?: (addon: InstalledAddon) => SportsSetting;
  /**
   * What the first page of a catalog looked like, from a page Home or
   * Discover already fetched; undefined when none was. Detection never asks.
   */
  evidence?: (addon: InstalledAddon, catalog: ManifestCatalog) => boolean | undefined;
}

/** Whether one catalog of an addon is a sports catalog (docs/PLAN.md, Detection, rule 1). */
export function isSportsCatalog(
  addon: InstalledAddon,
  catalog: ManifestCatalog,
  options: DetectOptions = {},
): boolean {
  const setting = options.setting?.(addon) ?? 'auto';
  if (setting === 'no' || !askable(catalog)) return false;
  if (setting === 'yes') return TITLE_TYPES.indexOf(catalog.type) === -1 || namesSport(catalog);
  const type = foldText(catalog.type);
  if (type === 'sport' || type === 'sports') return true;
  const evidence = options.evidence?.(addon, catalog);
  if (TITLE_TYPES.indexOf(catalog.type) !== -1) return namesSport(catalog) && evidence === true;
  if (namesSport(catalog)) return evidence !== false || catalogView(catalog).view === 'replays';
  return namesSportsView(catalog) && evidence === true;
}

/**
 * Every sports catalog of the collection, in collection order, with what the
 * feed needs to page it. Search-only catalogs are left out: the feed never
 * types a term.
 */
export function sportsCatalogs(
  addons: readonly InstalledAddon[],
  options: DetectOptions = {},
): SportsCatalog[] {
  const found: SportsCatalog[] = [];
  addons.forEach((addon, addonIndex) => {
    const zone = zoneFromAddress(addon.transportUrl);
    for (const catalog of addon.manifest.catalogs) {
      if (!isSportsCatalog(addon, catalog, options)) continue;
      const { view, sport } = catalogView(catalog);
      const genre = findExtra(catalog, 'genre');
      const skip = findExtra(catalog, 'skip');
      const entry: SportsCatalog = {
        key: `s${addonIndex}-${slugOf(catalog.type)}-${slugOf(catalog.id)}`,
        addon,
        addonIndex,
        catalog,
        view,
        pageable: skip !== undefined,
        skipRequired: skip?.isRequired === true,
        genres: genre && !genre.isRequired ? genre.options : [],
      };
      if (sport) entry.sport = sport;
      if (zone) entry.zone = zone;
      found.push(entry);
    }
  });
  const seen = new Set<string>();
  for (const entry of found) {
    let key = entry.key;
    for (let n = 2; seen.has(key); n++) key = `${entry.key}-${n}`;
    entry.key = key;
    seen.add(key);
  }
  return found;
}

/** Whether a catalog of this addon is one of these sports catalogs, for Home's board and Search. */
export function sportsCatalogFilter(
  catalogs: readonly SportsCatalog[],
): (addon: InstalledAddon, catalog: ManifestCatalog) => boolean {
  const byAddon = new Map<string, Set<ManifestCatalog>>();
  for (const entry of catalogs) {
    let set = byAddon.get(entry.addon.transportUrl);
    if (!set) byAddon.set(entry.addon.transportUrl, (set = new Set()));
    set.add(entry.catalog);
  }
  return (addon, catalog) => byAddon.get(addon.transportUrl)?.has(catalog) === true;
}
