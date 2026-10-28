import type { ExtraArg, MetaDetail, MetaPreview } from '@bannertv/protocol';
import type { AddonClient } from '../addons/client';
import { HttpError } from '../http';
import { DroppedError, type Lane } from '../lane';
import type { CachePolicy, Query } from '../query';
import { createStore, type Store } from '../store';
import type { Timers } from '../timers';
import type { SportsCatalog } from './detect';
import type { Matcher } from './dictionary';
import { buildEvents } from './events';
import { dayEvidence, type KickoffMemory } from './kickoffs';
import { type CatalogContext, type Listing, readListing, rollClockWraps } from './listing';
import { sportOf } from './sport';
import { cleanTitle } from './text';
import { addDays, localDate, localDayStart, readKickOff } from './time';
import type { EventSource, SportEvent, SportsDay } from './types';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Sports catalogs without cache hints: live ones are fresh for 2 minutes, the
 * rest for 15, and none is shown once it is 6 hours old (docs/PLAN.md,
 * Fetching and paging).
 */
export const SPORTS_LIVE_POLICY: CachePolicy = {
  freshFor: 2 * MINUTE,
  revalidateFor: 6 * HOUR - 2 * MINUTE,
  errorFor: 0,
};
export const SPORTS_POLICY: CachePolicy = {
  freshFor: 15 * MINUTE,
  revalidateFor: 6 * HOUR - 15 * MINUTE,
  errorFor: 0,
};
/** A page this long from a catalog that does not declare `skip` may have more behind it. */
export const FULL_PAGE = 50;
/** A page shorter than this is the catalog's last: no addon pages by fewer. */
export const SHORT_PAGE = 10;
/** Paging stops here for one catalog, so one day fits without paging forever. */
export const MAX_PAGES = 10;
export const MAX_ITEMS = 600;
/** Genre pages asked for one catalog that cannot page. */
export const MAX_GENRES = 12;
/** Meta pages asked per addon and refresh for live items with no time at all. */
export const META_LOOKUPS = 20;
/** Replay catalogs asked per addon: one addon has seventy. */
export const REPLAY_CATALOGS = 2;
/**
 * While sport is on screen: a new round of meta lookups this often, and no
 * catalog page asked again sooner after its last answer.
 */
export const REFRESH_EVERY_MS = 2 * MINUTE;
/**
 * How often the feed looks for copies that are no longer fresh while sport is
 * on screen, so a live catalog is asked again within this long of its copy
 * turning stale, about every 2 minutes (docs/PLAN.md, Fetching and paging).
 */
export const CHECK_EVERY_MS = 15 * 1000;
const REBUILD_DELAY_MS = 30;
/** A live-first catalog is past the Live day once its kick-offs are this far ahead. */
const LIVE_HORIZON_MS = HOUR;
/**
 * A LIVE item with no time gets its earlier neighbour's kick-off only when
 * the two around it are this close, so its live window cannot end long
 * before the match does.
 */
export const LIVE_ESTIMATE_SPAN_MS = HOUR;

export interface SportsFeedState {
  /** Every event so far, merged across catalogs and addons. */
  events: readonly SportEvent[];
  /** A catalog for what is on screen has not answered yet. */
  loading: boolean;
  /** Addons with a catalog that could not answer, by name, with nothing older to show. */
  failed: readonly string[];
  /** A genre page was still full: the addon may hold more than BannerTV shows. */
  more: boolean;
  /** How many sports catalogs the collection has. */
  catalogs: number;
}

export interface WantOptions {
  /**
   * Home's Live sport row: only the first page of each addon's live
   * catalogs (or its Today ones, or all of them for an addon with neither).
   */
  light?: boolean;
}

export interface SportsFeed extends Pick<Store<SportsFeedState>, 'get' | 'subscribe'> {
  setCatalogs(catalogs: readonly SportsCatalog[]): void;
  setMatcher(matcher: Matcher | undefined): void;
  /**
   * What is on screen: a day of the Sports screen, `live` for Live now or
   * the Live sport row, or null when no sport is shown. Null drops every
   * request still queued.
   */
  want(day: SportsDay | null, options?: WantOptions): void;
  /** Asks the catalogs that failed again. */
  retry(): void;
  /**
   * Asks the catalogs on screen again when their copy is no longer fresh,
   * and allows a new round of meta lookups. The feed's own timer does both
   * while sport is wanted.
   */
  refresh(): void;
  /** When BannerTV first saw an event, for the limits on events with no time. */
  firstSeen(event: SportEvent): number | undefined;
  dispose(): void;
}

interface PageRead {
  data: readonly MetaPreview[];
  /** Every item but placeholders and items that could not be read. */
  listings: Listing[];
  /** The ids of every item as the addon sent them, placeholders included, for how it counts. */
  items: string[];
  /** The ids of the events among them, in order. */
  events: string[];
}

interface Page {
  skip: number;
  query: Query<MetaPreview[]>;
  unsubscribe: () => void;
  read?: PageRead;
  /** When BannerTV last asked for it. */
  asked: number;
  /** When its copy arrived, or for an older copy from storage, the latest it can be from. */
  answered?: number;
}

interface TrackListings {
  /** The reads they came from, page by page; undefined for a page not shown. */
  reads: Array<PageRead | undefined>;
  /** As read. */
  read: Listing[];
  /** The same, clock-only times moved on a day where the list wraps past midnight. */
  listings: Listing[];
}

type StopReason = 'unpaged' | 'no-new' | 'end' | 'cap';

interface Track {
  key: string;
  entry: SportsCatalog;
  genre?: string;
  pages: Page[];
  stopped?: StopReason;
  /** Asked once with `skip` although the catalog does not declare it. */
  probed: boolean;
  /** The probe's failures with no answer at all, each counted once. */
  probeMisses?: Error[];
  pageable: boolean;
  /** How the addon counts `skip`, once the second page shows it. */
  counting?: 'items' | 'events';
  genresOpened: boolean;
  listings?: TrackListings;
}

/** The same catalog of the same install, asked the same way, whatever the objects. */
function sameCatalog(a: SportsCatalog, b: SportsCatalog): boolean {
  if (a.catalog === b.catalog && a.addon === b.addon) return true;
  return (
    a.addon.transportUrl === b.addon.transportUrl &&
    a.addon.manifest.id === b.addon.manifest.id &&
    a.catalog.type === b.catalog.type &&
    a.catalog.id === b.catalog.id &&
    a.catalog.name === b.catalog.name &&
    JSON.stringify(a.catalog.extra) === JSON.stringify(b.catalog.extra)
  );
}

function isEvent(listing: Listing): boolean {
  return listing.kind === 'event' || listing.kind === 'replay';
}

/**
 * The probe with `skip` asks what the addon never offered: any answer, an
 * error page of any status included, is a refusal. Only no answer at all is
 * asked again, and only once.
 */
function probeRefused(track: Track, error: Error | undefined): boolean {
  const unanswered =
    error instanceof HttpError && (error.kind === 'timeout' || error.kind === 'network');
  if (!unanswered) return true;
  const misses = track.probeMisses ?? (track.probeMisses = []);
  if (misses.indexOf(error) === -1) misses.push(error);
  return misses.length >= 2;
}

/** No answer in time, the server's own error, or too many asked: asking later may get one. */
function mayPass(error: Error | undefined): boolean {
  if (!(error instanceof HttpError)) return false;
  const status = error.status ?? 0;
  return (
    error.kind === 'timeout' ||
    error.kind === 'network' ||
    status >= 500 ||
    status === 408 ||
    status === 429
  );
}

function policyOf(entry: SportsCatalog): CachePolicy {
  return entry.view === 'live' ? SPORTS_LIVE_POLICY : SPORTS_POLICY;
}

/** What a listing depends on besides its item: it is read again when any of it changes. */
function contextKey(ctx: CatalogContext): string {
  return [
    ctx.addonIndex,
    ctx.addonId,
    ctx.transportUrl,
    ctx.catalogId,
    ctx.replays,
    ctx.channels,
    ctx.sport ?? '',
    ctx.genreOption ?? '',
    ctx.zone ?? '',
  ].join('\n');
}

const VIEW_ORDER: Record<SportsCatalog['view'], number> = {
  live: 0,
  today: 1,
  upcoming: 2,
  sport: 3,
  other: 4,
  replays: 5,
  channels: 6,
};

// One addon lists replays by day, by competition and by sport: today's and recent ones first.
function replayScore(entry: SportsCatalog): number {
  const name = entry.catalog.name.toLowerCase();
  if (/today/.test(name)) return 0;
  if (/recent|latest|new/.test(name)) return 1;
  if (!entry.sport) return 2;
  return 3;
}

/**
 * Fetches and merges the sports catalogs for what is on screen
 * (docs/PLAN.md, Fetching and paging). Requests go through `lane`, so they
 * hold at most its share of the request slots; pages after the first are
 * kept for the launch only.
 */
export function createSportsFeed(options: {
  client: AddonClient;
  lane: Lane;
  memory?: KickoffMemory;
  timers: Timers;
  now?: () => number;
}): SportsFeed {
  const { client, lane, memory, timers } = options;
  const now = options.now ?? Date.now;
  const state = createStore<SportsFeedState>({
    events: [],
    loading: false,
    failed: [],
    more: false,
    catalogs: 0,
  });
  let catalogs: readonly SportsCatalog[] = [];
  let tracks = new Map<string, Track>();
  let matcher: Matcher | undefined;
  let wanted: SportsDay | null = null;
  let light = false;
  let scheduled = false;
  let disposed = false;
  let stopRefresh: (() => void) | undefined;
  /** The pages followed for what is on screen, as the last pass found them. */
  const followed = new Set<Page>();
  /** When the current round of meta lookups began. */
  let lookupsAt = now();
  /** The day each clock-only kick-off was remembered on, by the listing as read. */
  const notedClocks = new WeakMap<Listing, number>();
  /**
   * Each item read once, until the catalog it came from changes: a moved or
   * removed addon gives the same items another place in the collection.
   */
  const listingCache = new WeakMap<MetaPreview, { context: string; listing: Listing }>();
  /** Meta pages asked since the last refresh, per addon id. */
  const metaCount = new Map<string, number>();
  /** Items whose meta was asked, by addon id and item id. */
  const metaAsked = new Set<string>();
  /** Of those, the ones that timed out or met a server error: asked again after the next refresh. */
  const metaFailed = new Set<string>();
  /** Lookups still waiting for an answer, by the same key, with the install they went to. */
  const metaLookups = new Map<string, { transportUrl: string; stop: () => void }>();
  const more = new Set<string>();
  // Clock-only days are read with the kick-offs earlier launches saw, so none is noted
  // before those are in: a list read first after midnight would put its own guess there.
  let memoryLoaded = memory === undefined;
  let memoryAsked = false;

  function context(track: Track): CatalogContext {
    const { entry } = track;
    const result: CatalogContext = {
      addonIndex: entry.addonIndex,
      addonId: entry.addon.manifest.id,
      transportUrl: entry.addon.transportUrl,
      catalogId: entry.catalog.id,
      replays: entry.view === 'replays',
      channels: entry.view === 'channels',
    };
    const sport = (track.genre ? sportOf(track.genre) : undefined) ?? entry.sport;
    if (sport) result.sport = sport;
    if (track.genre) result.genreOption = track.genre;
    if (entry.zone) result.zone = entry.zone;
    return result;
  }

  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    // Pages arrive one after another: one rebuild for all that land together.
    timers.after(REBUILD_DELAY_MS, () => {
      scheduled = false;
      if (!disposed) update();
    });
  }

  function addPage(track: Track, skip: number) {
    const { entry } = track;
    const extra: ExtraArg[] = [];
    if (track.genre) extra.push(['genre', track.genre]);
    if (skip > 0 || entry.skipRequired) extra.push(['skip', String(skip)]);
    const query = client.catalog(entry.addon, entry.catalog.type, entry.catalog.id, extra, {
      // Pages after the first are for this launch only, like searches.
      persist: skip === 0 && !track.genre,
      policy: policyOf(entry),
      lane,
    });
    track.pages.push({ skip, query, unsubscribe: query.subscribe(schedule), asked: now() });
    query.load();
  }

  function ask(page: Page, again = false) {
    page.asked = now();
    if (again) page.query.retry();
    else page.query.load();
  }

  function trackFor(entry: SportsCatalog, genre?: string): Track {
    const key = genre === undefined ? entry.key : `${entry.key}\ngenre:${genre}`;
    let track = tracks.get(key);
    if (!track) {
      track = {
        key,
        entry,
        pages: [],
        probed: false,
        pageable: entry.pageable && genre === undefined,
        genresOpened: false,
      };
      if (genre !== undefined) track.genre = genre;
      tracks.set(key, track);
    }
    return track;
  }

  /** Reads a page once its data is here, or again when it was refreshed. */
  function readPage(track: Track, page: Page): PageRead | undefined {
    const state = page.query.get();
    const data = state.data;
    if (!data) {
      // Asked again after its copy expired (6 hours without hints): the old copy is not shown.
      delete page.read;
      delete page.answered;
      return undefined;
    }
    if (page.read && page.read.data === data) return page.read;
    // A copy from storage shown while a new one is asked for is at least this old.
    page.answered = state.stale ? now() - policyOf(track.entry).freshFor : now();
    // A refreshed page can bring more, or less: whether to page on is worked out again.
    if (page.read && track.genre === undefined) delete track.stopped;
    const ctx = context(track);
    const key = contextKey(ctx);
    const at = now();
    const listings: Listing[] = [];
    const items: string[] = [];
    const events: string[] = [];
    for (const item of data) {
      items.push(item.id);
      const cached = listingCache.get(item);
      let listing = cached && cached.context === key ? cached.listing : undefined;
      if (!listing) {
        try {
          listing = readListing(item, ctx, at);
        } catch {
          // One odd item never takes the rest of the page with it.
          continue;
        }
        listingCache.set(item, { context: key, listing });
        if (memory && isEvent(listing)) {
          // A clock-only time is remembered once its day is known (noteClocks).
          const own = listing.kickOff?.source === 'clock' ? undefined : listing.kickOff;
          memory.note(ctx.addonId, item.id, own);
        }
      }
      if (listing.kind === 'placeholder') continue;
      listings.push(listing);
      if (isEvent(listing)) events.push(item.id);
    }
    page.read = { data, listings, items, events };
    return page.read;
  }

  /**
   * How many ids a page brought that the pages before it do not have, as
   * they read now: a refreshed catalog may have dropped what they had.
   */
  function freshIn(track: Track, index: number): number {
    const ids = new Set<string>();
    for (let i = 0; i < index; i++) {
      for (const listing of track.pages[i]!.read?.listings ?? []) ids.add(listing.source.id);
    }
    let fresh = 0;
    for (const listing of track.pages[index]!.read?.listings ?? []) {
      if (ids.has(listing.source.id)) continue;
      ids.add(listing.source.id);
      fresh++;
    }
    return fresh;
  }

  /** Ids across the catalog's pages as they read now. */
  function itemCount(track: Track): number {
    const ids = new Set<string>();
    for (const page of track.pages) {
      for (const listing of page.read?.listings ?? []) ids.add(listing.source.id);
    }
    return ids.size;
  }

  /**
   * Whether a page's copy is shown. One no longer followed is left out once
   * it is past its policy's 6 hours: nothing asks for it again, so the query
   * never finds it expired (docs/PLAN.md, Fetching and paging).
   */
  function shown(track: Track, page: Page): boolean {
    if (!page.read) return false;
    if (followed.has(page) || page.answered === undefined) return true;
    const { freshFor, revalidateFor } = policyOf(track.entry);
    return now() - page.answered < freshFor + revalidateFor;
  }

  /** The catalog's listings across the pages shown, in the addon's order. */
  function trackListings(track: Track): TrackListings {
    const reads = track.pages.map((page) => (shown(track, page) ? page.read : undefined));
    const known = track.listings;
    if (known && known.reads.length === reads.length && known.reads.every((r, i) => r === reads[i]))
      return known;
    const read: Listing[] = [];
    for (const pageRead of reads) {
      if (pageRead) for (const listing of pageRead.listings) read.push(listing);
    }
    // Clock-only times are on the addon's day until the list wraps past midnight, or on
    // the days remembered for the same matches (docs/PLAN.md, Time, live and finished).
    track.listings = {
      reads,
      read,
      listings: rollClockWraps(read, track.entry.zone, memory && dayEvidence(memory, now())),
    };
    return track.listings;
  }

  function sorted(listings: readonly Listing[]): boolean {
    let previous: number | undefined;
    let pairs = 0;
    let backwards = 0;
    for (const listing of listings) {
      const at = listing.kickOff?.at;
      if (at === undefined || !isEvent(listing)) continue;
      if (previous !== undefined) {
        pairs++;
        // Live-first lists start with matches already under way: an hour's slack.
        if (at < previous - HOUR) backwards++;
      }
      previous = at;
    }
    return pairs >= 2 && backwards * 10 <= pairs;
  }

  /** The catalog lists by kick-off and its last page already reaches past the day on screen. */
  function pastDay(track: Track, day: SportsDay): boolean {
    const { listings } = trackListings(track);
    if (!sorted(listings)) return false;
    const end = day === 'live' ? now() + LIVE_HORIZON_MS : localDayStart(addDays(day, 1));
    const lastCount = track.pages[track.pages.length - 1]?.read?.listings.length ?? 0;
    let latest: number | undefined;
    for (let i = Math.max(0, listings.length - lastCount); i < listings.length; i++) {
      const at = listings[i]!.kickOff?.at;
      if (at !== undefined && (latest === undefined || at > latest)) latest = at;
    }
    return latest !== undefined && latest >= end;
  }

  function openGenres(track: Track) {
    const { entry } = track;
    if (track.genre !== undefined || track.genresOpened || entry.genres.length === 0) return;
    const first = track.pages[0]?.read;
    if (!first || first.data.length < FULL_PAGE) return;
    track.genresOpened = true;
    for (const genre of entry.genres.slice(0, MAX_GENRES)) {
      const genreTrack = trackFor(entry, genre);
      genreTrack.stopped = 'unpaged';
      if (genreTrack.pages.length === 0) addPage(genreTrack, 0);
    }
  }

  function nextSkip(track: Track): number {
    const last = track.pages[track.pages.length - 1]!;
    const read = last.read!;
    // Where the last page ends in the addon's list as it is now, counted the addon's way,
    // so matches that left the top of a live list since do not push skip past others.
    const counted = track.counting === 'items' ? read.items.length : read.events.length;
    // A couple of repeats are cheap; a skipped match is not (docs/PLAN.md, paging by events).
    return Math.max(last.skip + 1, last.skip + counted - 2);
  }

  /** After the second page: whether the addon's skip counts every item or only events. */
  function learnCounting(track: Track) {
    if (track.counting || track.pages.length < 2) return;
    const second = track.pages[1]!;
    const firstId = second.read?.items[0];
    const first = track.pages[0]!.read;
    if (!firstId || !first) return;
    // Every item the addon sent counts here, placeholders and unreadable ones too.
    const { items, events } = first;
    if (items[second.skip] === firstId && events[second.skip] !== firstId) track.counting = 'items';
    else if (events[second.skip] === firstId) track.counting = 'events';
  }

  function decide(track: Track, day: SportsDay) {
    if (track.stopped) return;
    const pages = track.pages;
    const last = pages[pages.length - 1]!;
    const read = last.read;
    if (!read) return;
    if (pages.length > 1 && freshIn(track, pages.length - 1) === 0) {
      // Nothing new: the addon ignores skip, or the catalog is at its end.
      track.stopped = 'no-new';
      if (!track.pageable) openGenres(track);
      return;
    }
    if (read.data.length < SHORT_PAGE) {
      track.stopped = 'end';
      return;
    }
    if (pages.length >= MAX_PAGES || itemCount(track) >= MAX_ITEMS) {
      track.stopped = 'cap';
      return;
    }
    if (!track.pageable) {
      if (!track.probed && pages.length === 1 && read.data.length >= FULL_PAGE) {
        // Undeclared skip and a full page: asked once the Stremio way.
        track.probed = true;
        addPage(track, read.data.length);
        return;
      }
      if (track.probed && pages.length === 2) {
        track.pageable = true;
      } else {
        track.stopped = 'unpaged';
        openGenres(track);
        return;
      }
    }
    learnCounting(track);
    if (pastDay(track, day)) return;
    addPage(track, nextSkip(track));
  }

  /** The catalogs to fetch for what is on screen, in the order to ask them. */
  function active(): SportsCatalog[] {
    if (wanted === null) return [];
    const usable = catalogs.filter((entry) => entry.view !== 'channels');
    if (light) {
      const picked: SportsCatalog[] = [];
      const byAddon = new Map<number, SportsCatalog[]>();
      for (const entry of usable) {
        if (entry.view === 'replays') continue;
        const list = byAddon.get(entry.addonIndex);
        if (list) list.push(entry);
        else byAddon.set(entry.addonIndex, [entry]);
      }
      byAddon.forEach((list) => {
        const live = list.filter((entry) => entry.view === 'live');
        const today = list.filter((entry) => entry.view === 'today');
        for (const entry of live.length > 0 ? live : today.length > 0 ? today : list) {
          picked.push(entry);
        }
      });
      return picked;
    }
    const today = localDate(now());
    const replays = new Map<number, number>();
    const picked: SportsCatalog[] = [];
    const ordered = usable
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const view = VIEW_ORDER[a.entry.view] - VIEW_ORDER[b.entry.view];
        if (view !== 0) return view;
        if (a.entry.view === 'replays') {
          const score = replayScore(a.entry) - replayScore(b.entry);
          if (score !== 0) return score;
        }
        return a.index - b.index;
      });
    for (const { entry } of ordered) {
      if (entry.view === 'replays') {
        // The Replays row is on Today only.
        if (wanted !== today) continue;
        const count = replays.get(entry.addonIndex) ?? 0;
        if (count >= REPLAY_CATALOGS) continue;
        replays.set(entry.addonIndex, count + 1);
      }
      picked.push(entry);
    }
    return picked;
  }

  /** The probe with `skip` was refused: the catalog does not page, and its first page stays. */
  function dropProbe(track: Track) {
    track.pages.pop()!.unsubscribe();
    track.stopped = 'unpaged';
    openGenres(track);
  }

  /** The catalogs followed for what is on screen, with their genre pages, in the order to ask. */
  function followedTracks(): Track[] {
    const out: Track[] = [];
    for (const entry of active()) {
      const track = trackFor(entry);
      out.push(track);
      if (!track.genresOpened) continue;
      for (const genre of entry.genres.slice(0, MAX_GENRES)) out.push(trackFor(entry, genre));
    }
    return out;
  }

  /** The pages a track follows: the first only for the Live sport row. */
  function followedPages(track: Track): Page[] {
    return light ? track.pages.slice(0, 1) : track.pages;
  }

  /**
   * Asks again the pages on screen whose copy is no longer fresh: load() asks
   * only then, 2 minutes for live catalogs and 15 for the rest (docs/PLAN.md,
   * Fetching and paging), and never sooner than REFRESH_EVERY_MS after the
   * last answer. A page that could not answer is asked again that long after
   * it was last asked, so a down addon holds no request slot for long.
   */
  function recheckPages() {
    if (wanted === null) return;
    const time = now();
    for (const track of followedTracks()) {
      for (const page of followedPages(track)) {
        const { status, error } = page.query.get();
        if (status === 'loading') continue;
        // Dropped before it reached the addon: asked now.
        if (!(error instanceof DroppedError)) {
          const since = error ? time - page.asked : time - (page.answered ?? page.asked);
          const wait = error ? policyOf(track.entry).freshFor : REFRESH_EVERY_MS;
          // A clock that went back asks now.
          if (since >= 0 && since < wait) continue;
        }
        ask(page);
      }
    }
  }

  function advance(): boolean {
    let loading = false;
    followed.clear();
    if (wanted === null) return loading;
    for (const current of followedTracks()) {
      const { entry } = current;
      if (current.pages.length === 0) addPage(current, 0);
      for (const page of followedPages(current)) followed.add(page);
      // A page can come from the cache already loaded, and so never call back:
      // its next page is decided at once (bounded by MAX_PAGES).
      for (;;) {
        const last = current.pages[current.pages.length - 1]!;
        const page = last.query.get();
        if (page.status === 'idle') {
          ask(last);
          loading = true;
          break;
        }
        if (page.status === 'loading') {
          loading = true;
          break;
        }
        if (page.status === 'error') {
          // Dropped when the screen closed: asked again now it is back.
          if (page.error instanceof DroppedError) {
            ask(last);
            loading = true;
          } else if (
            !light &&
            current.probed &&
            !current.pageable &&
            current.pages.length === 2 &&
            probeRefused(current, page.error)
          ) {
            // Addons that do not expect `skip` may refuse it, with any status. One that did
            // not answer in time stays a failed page, asked again by Try again or the next
            // recheck, and is given up the second time.
            dropProbe(current);
            continue;
          }
          break;
        }
        if (page.error instanceof DroppedError && page.stale) ask(last);
        readPage(current, last);
        if (light || entry.view === 'replays' || current.genre !== undefined) break;
        const count = current.pages.length;
        decide(current, wanted);
        if (current.pages.length === count) break;
        followed.add(current.pages[current.pages.length - 1]!);
      }
      // An earlier page asked again after its copy expired has nothing to show yet either.
      if (current.pages.some((page) => page.query.get().status === 'loading')) loading = true;
    }
    return loading;
  }

  /**
   * Until memory or the meta gives a time, in a catalog sorted by kick-off:
   * an untimed match between two of the same day gets that day, and a LIVE
   * one between two close kick-offs gets the earlier, unsure, so it is placed
   * in Live now (docs/PLAN.md, Time, live and finished).
   */
  function withEstimates(listings: readonly Listing[]): readonly Listing[] {
    if (!sorted(listings)) return listings;
    const out = listings.slice();
    let previous: number | undefined;
    for (let i = 0; i < out.length; i++) {
      const listing = out[i]!;
      if (!isEvent(listing)) continue;
      const at = listing.kickOff?.at;
      if (at !== undefined) {
        previous = at;
        continue;
      }
      if (listing.kickOff || previous === undefined) continue;
      // A remembered time is better than any estimate, and grouping takes it.
      const { source } = listing;
      if (listing.liveLabel && memory?.get(source.addonId, source.id)) continue;
      let next: number | undefined;
      for (let j = i + 1; j < out.length && next === undefined; j++) {
        if (isEvent(out[j]!)) next = out[j]!.kickOff?.at;
      }
      if (next === undefined || localDate(next) !== localDate(previous)) continue;
      if (listing.liveLabel) {
        if (next - previous > LIVE_ESTIMATE_SPAN_MS) continue;
        out[i] = { ...listing, kickOff: { at: previous, sure: false, source: 'estimated' } };
      } else {
        out[i] = {
          ...listing,
          kickOff: { date: localDate(previous), sure: false, source: 'estimated' },
        };
      }
    }
    return out;
  }

  /** The install that listed an item, while it is still installed and in Sports. */
  function installOf(source: EventSource): SportsCatalog | undefined {
    return catalogs.find(
      (c) => c.addon.transportUrl === source.transportUrl && c.addon.manifest.id === source.addonId,
    );
  }

  /** A new refresh: a new round of meta lookups, and those that failed are asked again. */
  function allowLookups() {
    lookupsAt = now();
    metaCount.clear();
    metaFailed.forEach((key) => metaAsked.delete(key));
    metaFailed.clear();
  }

  function lookUpMeta(listings: readonly Listing[]) {
    if (light || wanted === null) return;
    for (const listing of listings) {
      if (listing.kind !== 'event' || !listing.liveLabel) continue;
      // An estimate stands in only until the meta gives a time.
      if (listing.kickOff && listing.kickOff.source !== 'estimated') continue;
      const { source } = listing;
      if (memory?.get(source.addonId, source.id)) continue;
      const asked = metaCount.get(source.addonId) ?? 0;
      const key = `${source.addonId}\n${source.id}`;
      if (asked >= META_LOOKUPS || metaAsked.has(key)) continue;
      // Only the install that listed the item is asked (docs/PLAN.md, Play and playback).
      const entry = installOf(source);
      if (!entry) continue;
      metaCount.set(source.addonId, asked + 1);
      metaAsked.add(key);
      const query = client.metaFrom(
        { addon: entry.addon, type: source.type, id: source.id },
        { lane },
      );
      let unsubscribe = () => undefined as void;
      const finish = () => {
        unsubscribe();
        metaLookups.delete(key);
      };
      const read = () => {
        const current = query.get();
        if (current.status === 'error') {
          finish();
          if (current.error instanceof DroppedError) {
            // Dropped before it started: its place goes back, and it is asked when sport is back.
            metaAsked.delete(key);
            metaCount.set(source.addonId, Math.max(0, (metaCount.get(source.addonId) ?? 0) - 1));
          } else if (mayPass(current.error)) {
            metaFailed.add(key);
          }
          return;
        }
        const meta: MetaDetail | undefined = current.data;
        if (!meta) return;
        finish();
        // Removed while this ran: nothing more is kept about the addon.
        if (!installOf(source)) return;
        const clean = cleanTitle(meta.name);
        const kickOff = readKickOff(
          {
            released: meta.released,
            releaseInfo: meta.releaseInfo,
            description: meta.description,
            nameClock: clean.clock,
            name: meta.name,
            replay: false,
          },
          { now: now(), zone: entry.zone },
        );
        if (kickOff && memory) {
          memory.note(source.addonId, source.id, kickOff);
          schedule();
        }
      };
      metaLookups.set(key, { transportUrl: source.transportUrl, stop: () => unsubscribe() });
      unsubscribe = query.subscribe(read);
      query.load();
      read();
    }
  }

  /** Clock-only kick-offs are remembered once their day is known, and again if it changes. */
  function noteClocks({ read, listings }: TrackListings) {
    if (!memory || !memoryLoaded) return;
    for (let i = 0; i < read.length; i++) {
      const listing = read[i]!;
      const kickOff = listings[i]!.kickOff;
      if (listing.kickOff?.source !== 'clock' || kickOff?.at === undefined || !isEvent(listing))
        continue;
      if (notedClocks.get(listing) === kickOff.at) continue;
      notedClocks.set(listing, kickOff.at);
      memory.note(listing.source.addonId, listing.source.id, kickOff);
    }
  }

  function update() {
    if (memory && !memoryAsked) {
      memoryAsked = true;
      void memory.load().then(() => {
        memoryLoaded = true;
        // Read the days again with what earlier launches saw.
        tracks.forEach((track) => delete track.listings);
        schedule();
      });
    }
    const loading = advance();
    const listings: Listing[] = [];
    const failed: string[] = [];
    const activeKeys = new Set(active().map((entry) => entry.key));
    tracks.forEach((track) => {
      for (const page of track.pages) readPage(track, page);
      const own = trackListings(track);
      noteClocks(own);
      for (const listing of withEstimates(own.listings)) listings.push(listing);
      // Any page followed that could not answer and has nothing older to show names its
      // addon, so Try again is offered and asks it. A refused skip probe is gone by now.
      const broken = track.pages.some((page) => {
        const state = page.query.get();
        return (
          followed.has(page) && state.status === 'error' && !(state.error instanceof DroppedError)
        );
      });
      if (broken) {
        const name = track.entry.addon.manifest.name;
        if (failed.indexOf(name) === -1) failed.push(name);
      }
      if (
        track.genre !== undefined &&
        track.pages[0]?.read &&
        track.pages[0].read.data.length >= FULL_PAGE
      ) {
        more.add(track.entry.key);
      }
    });
    let events: SportEvent[];
    try {
      events = buildEvents(listings, {
        matcher,
        remembered: memory ? (addonId, id) => memory.get(addonId, id) : undefined,
      });
    } catch {
      // Grouping must never take the screen down; what was there stays.
      events = state.get().events.slice();
    }
    lookUpMeta(listings);
    state.set({
      events,
      loading,
      failed,
      more: Array.from(more).some((key) => activeKeys.has(key)),
      catalogs: catalogs.length,
    });
  }

  function stopTimer() {
    stopRefresh?.();
    stopRefresh = undefined;
  }

  /**
   * On a timer while sport is on screen. Nothing is rebuilt unless a page
   * answers or a new round of meta lookups begins.
   */
  function tick() {
    if (wanted === null) return;
    recheckPages();
    const since = now() - lookupsAt;
    if (since >= REFRESH_EVERY_MS || since < 0) {
      allowLookups();
      schedule();
    }
  }

  const feed: SportsFeed = {
    get: state.get,
    subscribe: state.subscribe,

    setCatalogs(next) {
      catalogs = next;
      const keep = new Map<string, Track>();
      tracks.forEach((track, key) => {
        const still = next.find((entry) => entry.key === track.entry.key);
        // An addon refresh hands back new objects for the same catalog: its pages stay.
        if (still && sameCatalog(still, track.entry)) {
          track.entry = still;
          keep.set(key, track);
        } else {
          for (const page of track.pages) page.unsubscribe();
        }
      });
      tracks = keep;
      // A removed install's lookups write nothing after it is gone (docs/PLAN.md, Store and privacy).
      metaLookups.forEach((lookup, key) => {
        if (next.some((entry) => entry.addon.transportUrl === lookup.transportUrl)) return;
        lookup.stop();
        metaLookups.delete(key);
        metaAsked.delete(key);
      });
      more.forEach((key) => {
        if (!next.some((entry) => entry.key === key)) more.delete(key);
      });
      update();
    },

    setMatcher(next) {
      if (next === matcher) return;
      matcher = next;
      schedule();
    },

    want(day, opts = {}) {
      const nextLight = day !== null && opts.light === true;
      if (day === wanted && nextLight === light) return;
      const back = wanted === null;
      wanted = day;
      light = nextLight;
      if (day === null) {
        lane.drop();
        stopTimer();
        schedule();
        return;
      }
      if (!stopRefresh) stopRefresh = timers.every(CHECK_EVERY_MS, tick);
      // What went stale while sport was away is asked now, not at the next tick.
      recheckPages();
      if (back) allowLookups();
      update();
    },

    retry() {
      tracks.forEach((track) => {
        for (const page of track.pages) {
          if (page.query.get().status === 'error') ask(page, true);
        }
      });
    },

    refresh() {
      if (wanted === null) return;
      recheckPages();
      allowLookups();
      schedule();
    },

    firstSeen(event) {
      if (!memory) return undefined;
      let first: number | undefined;
      for (const source of event.sources) {
        const seen = memory.firstSeen(source.addonId, source.id);
        if (seen !== undefined && (first === undefined || seen < first)) first = seen;
      }
      return first;
    },

    dispose() {
      disposed = true;
      stopTimer();
      lane.drop();
      tracks.forEach((track) => {
        for (const page of track.pages) page.unsubscribe();
      });
      tracks.clear();
      metaLookups.forEach((lookup) => lookup.stop());
      metaLookups.clear();
    },
  };
  return feed;
}
