import {
  buildEvents,
  type CatalogContext,
  type CatalogFilter,
  createKickoffMemory,
  createLane,
  createMatcher,
  createSportsFeed,
  createStore,
  type EventSource,
  type InstalledAddon,
  type ItemSource,
  type Listing,
  looksLikeSports,
  type Matcher,
  needsEvidence,
  readListing,
  rollClockWraps,
  type SportEvent,
  type SportsCatalog,
  sportsCatalogFilter,
  sportsCatalogs,
  type SportsData,
  type SportsDay,
  type SportsSetting,
  type Timers,
  type WantOptions,
} from '@bannertv/core';
import { catalogAccepts, type ManifestCatalog, type MetaPreview } from '@bannertv/protocol';
import { SPORTS_IN_BUILD } from '../app/features';
import { addonClient, addonCollection } from './addons';
import { SPORTS_DATA_SCRIPT } from './sports-data-script';
import { storage } from './storage';

/** Sports requests use at most this many of the app's 6 request slots (docs/PLAN.md, Fetching and paging). */
const SPORTS_REQUESTS = 2;
const SETTINGS_KEY = 'sports.settings';
const EVIDENCE_KEY = 'sports.evidence';
/** First pages remembered, for catalogs whose name alone does not settle it. */
const MAX_EVIDENCE = 200;
/** A first page this short says nothing either way ("no live events right now"). */
const MIN_EVIDENCE_ITEMS = 3;

export const browserTimers: Timers = {
  after(ms, run) {
    const id = window.setTimeout(run, ms);
    return () => window.clearTimeout(id);
  },
  every(ms, run) {
    const id = window.setInterval(run, ms);
    return () => window.clearInterval(id);
  },
};

export const kickoffs = createKickoffMemory({ store: storage.kv, timers: browserTimers });

export const sportsFeed = createSportsFeed({
  client: addonClient,
  lane: createLane(SPORTS_REQUESTS),
  memory: kickoffs,
  timers: browserTimers,
});

export interface SportsState {
  /**
   * The collection and the sports settings have been read, so Home and
   * Search can build their rows without sports rows coming and going.
   */
  ready: boolean;
  /** Every sports catalog of the installed addons, in collection order. */
  catalogs: readonly SportsCatalog[];
  /** Whether Sports is in the rail. */
  shown: boolean;
  /** Catalogs Home's board leaves out: the Live sport row stands in for them. */
  homeLeaveOut?: CatalogFilter;
  /** Catalogs Search's fan-out leaves out: sports catalogs, and sports addons' searches of the same type. */
  searchLeaveOut?: CatalogFilter;
}

export const sportsState = createStore<SportsState>({
  ready: !SPORTS_IN_BUILD,
  catalogs: [],
  shown: false,
});

/** The team and league data, once loaded. Grouping works without it, by what addons say. */
export const sportsMatcher = createStore<Matcher | undefined>(undefined);

// "Show in Sports" per addon id, and what first pages looked like. Both small,
// both keyed by the addon's id and never by its address, which can carry a key.
let settings: Record<string, SportsSetting> = {};
let evidence = new Map<string, boolean>();
let stored: Promise<void> | undefined;

function evidenceKey(addon: InstalledAddon, catalog: ManifestCatalog): string {
  return `${addon.manifest.id}\n${catalog.type}\n${catalog.id}`;
}

function sameCatalogs(a: readonly SportsCatalog[], b: readonly SportsCatalog[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, i) => {
      const other = b[i]!;
      return (
        entry.key === other.key && entry.catalog === other.catalog && entry.addon === other.addon
      );
    })
  );
}

function searchFilter(catalogs: readonly SportsCatalog[], sports: CatalogFilter): CatalogFilter {
  const types = new Map<string, Set<string>>();
  for (const entry of catalogs) {
    let set = types.get(entry.addon.transportUrl);
    if (!set) types.set(entry.addon.transportUrl, (set = new Set()));
    set.add(entry.catalog.type);
  }
  return (addon, catalog) =>
    sports(addon, catalog) ||
    (types.get(addon.transportUrl)?.has(catalog.type) === true &&
      catalogAccepts(catalog, ['search']));
}

function detect(): void {
  if (!SPORTS_IN_BUILD) return;
  const { addons, ready } = addonCollection.get();
  const catalogs = sportsCatalogs(addons, {
    setting: (addon) => settings[addon.manifest.id] ?? 'auto',
    evidence: (addon, catalog) => evidence.get(evidenceKey(addon, catalog)),
  });
  const current = sportsState.get();
  if (current.ready === ready && sameCatalogs(current.catalogs, catalogs)) return;
  const homeLeaveOut = catalogs.length > 0 ? sportsCatalogFilter(catalogs) : undefined;
  const next: SportsState = { ready, catalogs, shown: catalogs.length > 0 };
  if (homeLeaveOut) {
    next.homeLeaveOut = homeLeaveOut;
    next.searchLeaveOut = searchFilter(catalogs, homeLeaveOut);
  }
  sportsState.set(next);
  if (!sameCatalogs(current.catalogs, catalogs)) sportsFeed.setCatalogs(catalogs);
  if (catalogs.length > 0) loadMatcher();
}

function readSettings(value: unknown): Record<string, SportsSetting> {
  const out: Record<string, SportsSetting> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const id of Object.keys(value)) {
    const setting = (value as Record<string, unknown>)[id];
    if (setting === 'yes' || setting === 'no') out[id] = setting;
  }
  return out;
}

function readEvidence(value: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!Array.isArray(value)) return out;
  for (const row of value.slice(-MAX_EVIDENCE)) {
    if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'boolean') {
      out.set(row[0], row[1]);
    }
  }
  return out;
}

function saveSettings(): void {
  void storage.kv.set(SETTINGS_KEY, settings).catch(() => undefined);
}

function saveEvidence(): void {
  const rows: Array<[string, boolean]> = [];
  evidence.forEach((value, key) => rows.push([key, value]));
  void storage.kv.set(EVIDENCE_KEY, rows.slice(-MAX_EVIDENCE)).catch(() => undefined);
}

/** Reads the settings and evidence, then follows the collection. Runs once, at start-up. */
export function startSports(): Promise<void> {
  if (!SPORTS_IN_BUILD) return Promise.resolve();
  if (stored) return stored;
  stored = Promise.all([
    storage.kv.get(SETTINGS_KEY).catch(() => undefined),
    storage.kv.get(EVIDENCE_KEY).catch(() => undefined),
  ]).then(([savedSettings, savedEvidence]) => {
    // Set while they were loading: those win.
    settings = { ...readSettings(savedSettings), ...settings };
    const loaded = readEvidence(savedEvidence);
    evidence.forEach((value, key) => loaded.set(key, value));
    evidence = loaded;
    void kickoffs.load();
    let before: readonly InstalledAddon[] = [];
    let wasReady = false;
    const onCollection = () => {
      const { addons, ready } = addonCollection.get();
      if (wasReady) followCollection(before, addons);
      before = addons;
      wasReady = ready;
      detect();
    };
    addonCollection.subscribe(onCollection);
    onCollection();
  });
  return stored;
}

/**
 * An addon id without a trailing settings hash, as the collection compares
 * them: `org.example.0123456789ab` → `org.example`.
 */
function idStem(id: string): string {
  return id.replace(/[.:|-][0-9a-f]{8,}$/i, '');
}

/**
 * Removing an addon removes what BannerTV kept about its matches (docs/PLAN.md,
 * Store and privacy). An addon set up again on its settings page takes its
 * old place in the same change, and can come back with another id (a new
 * settings hash): what was kept goes with it to the new id.
 */
function followCollection(before: readonly InstalledAddon[], now: readonly InstalledAddon[]): void {
  const ids = new Set(now.map((addon) => addon.manifest.id));
  const known = new Set(before.map((addon) => addon.manifest.id));
  const arrived = now.filter((addon) => !known.has(addon.manifest.id));
  const gone = new Set<string>();
  for (const addon of before) {
    const id = addon.manifest.id;
    if (ids.has(id) || gone.has(id)) continue;
    gone.add(id);
    // Much as the collection tells an addon set up again: the same address, the same id
    // before its settings hash, or the same name. Addresses are compared, never read.
    const successor =
      arrived.find((a) => a.transportUrl === addon.transportUrl) ??
      arrived.find((a) => idStem(a.manifest.id) === idStem(id)) ??
      arrived.find((a) => a.manifest.name === addon.manifest.name);
    if (successor) moveAddon(id, successor.manifest.id);
    else forgetAddon(id);
  }
}

/** What was kept about an addon, under the id it came back with. */
function moveAddon(from: string, to: string): void {
  kickoffs.move(from, to);
  const setting = settings[from];
  if (setting) {
    const next = { ...settings };
    delete next[from];
    if (!next[to]) next[to] = setting;
    settings = next;
    saveSettings();
  }
  // In the same order, so the oldest still go first when the list is full.
  const moved = new Map<string, boolean>();
  let changed = false;
  evidence.forEach((value, key) => {
    if (key.indexOf(`${from}\n`) !== 0) {
      moved.set(key, value);
      return;
    }
    changed = true;
    const renamed = `${to}${key.slice(from.length)}`;
    // What the new id has seen itself wins.
    if (!evidence.has(renamed)) moved.set(renamed, value);
  });
  if (!changed) return;
  evidence = moved;
  saveEvidence();
}

function forgetAddon(id: string): void {
  kickoffs.forget(id);
  if (settings[id]) {
    const next = { ...settings };
    delete next[id];
    settings = next;
    saveSettings();
  }
  let changed = false;
  evidence.forEach((_, key) => {
    if (key.indexOf(`${id}\n`) === 0) {
      evidence.delete(key);
      changed = true;
    }
  });
  if (changed) saveEvidence();
}

export function sportsSetting(addon: InstalledAddon): SportsSetting {
  return settings[addon.manifest.id] ?? 'auto';
}

/** "Show in Sports" for one addon; every install of it shares the setting. */
export function setSportsSetting(addon: InstalledAddon, setting: SportsSetting): void {
  const id = addon.manifest.id;
  if (sportsSetting(addon) === setting) return;
  const next = { ...settings };
  if (setting === 'auto') delete next[id];
  else next[id] = setting;
  settings = next;
  saveSettings();
  detect();
}

/**
 * Whether the addon could hold sport: it has a sports catalog now, a setting,
 * or a catalog that is neither movies nor series. Addons settings offers
 * "Show in Sports" only for these.
 */
export function mayHoldSports(addon: InstalledAddon): boolean {
  if (!SPORTS_IN_BUILD) return false;
  if (settings[addon.manifest.id]) return true;
  if (sportsState.get().catalogs.some((entry) => entry.addon === addon)) return true;
  return addon.manifest.catalogs.some((c) => c.type !== 'movie' && c.type !== 'series');
}

/**
 * What the first page of a catalog looked like, from a page Home or Discover
 * fetched anyway. Detection never asks for a page itself (docs/PLAN.md,
 * Detection, rule 1).
 */
export function noteFirstPage(
  addon: InstalledAddon,
  catalog: ManifestCatalog,
  items: readonly MetaPreview[],
): void {
  if (!SPORTS_IN_BUILD || items.length < MIN_EVIDENCE_ITEMS || !needsEvidence(catalog)) return;
  const key = evidenceKey(addon, catalog);
  const value = looksLikeSports(items);
  if (evidence.get(key) === value) return;
  // Newest last, so the oldest go first when the list is full.
  evidence.delete(key);
  evidence.set(key, value);
  saveEvidence();
  detect();
}

let matcherRequested = false;

function readData(value: unknown): SportsData | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const data = value as Partial<SportsData>;
  return typeof data.version === 'number' &&
    Array.isArray(data.competitions) &&
    Array.isArray(data.teams) &&
    Array.isArray(data.countries)
    ? (value as SportsData)
    : undefined;
}

/** Loads the team and league data once. Without it grouping goes by what addons say. */
function loadMatcher(): void {
  if (matcherRequested) return;
  matcherRequested = true;
  const script = document.createElement('script');
  script.src = `./${SPORTS_DATA_SCRIPT.file}`;
  script.onload = () => {
    const holder = window as unknown as Record<string, unknown>;
    const data = readData(holder[SPORTS_DATA_SCRIPT.global]);
    delete holder[SPORTS_DATA_SCRIPT.global];
    script.remove();
    if (!data) return;
    // Its maps take a moment to build on a TV: out of the key press that got here.
    window.setTimeout(() => {
      let matcher: Matcher | undefined;
      try {
        matcher = createMatcher(data);
      } catch {
        return;
      }
      sportsMatcher.set(matcher);
      sportsFeed.setMatcher(matcher);
    }, 0);
  };
  script.onerror = () => {
    script.remove();
    // Tried again the next time a sports catalog turns up.
    matcherRequested = false;
  };
  document.head.appendChild(script);
}

interface Claim {
  day: SportsDay;
  options: WantOptions;
}
const claims: Claim[] = [];

function applyClaims(): void {
  const top = claims[claims.length - 1];
  if (top) sportsFeed.want(top.day, top.options);
  else sportsFeed.want(null);
}

/**
 * Asks the feed for what a screen shows, until the returned function is
 * called. The latest claim wins; when none is left, queued sports requests
 * are dropped.
 */
export function wantSports(day: SportsDay, options: WantOptions = {}): () => void {
  if (!SPORTS_IN_BUILD) return () => undefined;
  const claim: Claim = { day, options };
  claims.push(claim);
  applyClaims();
  return () => {
    const index = claims.indexOf(claim);
    if (index === -1) return;
    claims.splice(index, 1);
    applyClaims();
  };
}

/** The addons behind an event's sources, as installed now. Sources of removed addons are left out. */
export function itemSources(sources: readonly EventSource[]): ItemSource[] {
  const { addons } = addonCollection.get();
  const found: ItemSource[] = [];
  for (const source of sources) {
    const addon = addons.find((a) => a.transportUrl === source.transportUrl);
    if (addon) found.push({ addon, type: source.type, id: source.id });
  }
  return found;
}

/**
 * Events read from items of one sports catalog that Discover or a search
 * fetched, with the same rules as the Sports screen. Empty when nothing reads
 * as an event (channels, placeholders) or when the catalog is not a sports one.
 */
export function eventsFromItems(
  addon: InstalledAddon,
  catalog: ManifestCatalog,
  items: readonly MetaPreview[],
): SportEvent[] {
  if (!SPORTS_IN_BUILD) return [];
  const { catalogs, searchLeaveOut } = sportsState.get();
  const entry = catalogs.find((e) => e.addon === addon && e.catalog === catalog);
  const searched = catalogAccepts(catalog, ['search']);
  if (!entry && !(searched && searchLeaveOut?.(addon, catalog))) return [];
  const { addons } = addonCollection.get();
  const context: CatalogContext = {
    addonIndex: Math.max(0, addons.indexOf(addon)),
    addonId: addon.manifest.id,
    transportUrl: addon.transportUrl,
    catalogId: catalog.id,
    replays: entry?.view === 'replays',
    channels: entry?.view === 'channels',
  };
  if (entry?.sport) context.sport = entry.sport;
  // The zone belongs to the install: a search catalog, not a sports catalog
  // itself, reads times as the addon's sports catalogs do.
  const zone =
    entry?.zone ??
    catalogs.find((e) => e.addon.transportUrl === addon.transportUrl && e.zone)?.zone;
  if (zone) context.zone = zone;
  const now = Date.now();
  const listings: Listing[] = [];
  for (const item of items) {
    try {
      const listing = readListing(item, context, now);
      if (listing.kind !== 'placeholder') listings.push(listing);
    } catch {
      // One odd item never takes the rest with it.
    }
  }
  try {
    // Clock-only times move on a day where the list wraps past midnight, as on the Sports screen.
    return buildEvents(rollClockWraps(listings, zone), {
      matcher: sportsMatcher.get(),
      remembered: (addonId, id) => kickoffs.get(addonId, id),
    });
  } catch {
    return [];
  }
}

/** The event as the feed has it now, for a page opened on an older copy. */
export function latestEvent(event: SportEvent): SportEvent {
  return sportsFeed.get().events.find((e) => e.key === event.key) ?? event;
}
