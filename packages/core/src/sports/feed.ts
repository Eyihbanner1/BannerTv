import type { ExtraArg, MetaDetail, MetaPreview } from '@bannertv/protocol';
import type { AddonClient } from '../addons/client';
import { DroppedError, type Lane } from '../lane';
import type { CachePolicy, Query } from '../query';
import { createStore, type Store } from '../store';
import type { Timers } from '../timers';
import type { SportsCatalog } from './detect';
import type { Matcher } from './dictionary';
import { buildEvents } from './events';
import type { KickoffMemory } from './kickoffs';
import { type CatalogContext, type Listing, readListing } from './listing';
import { sportOf } from './sport';
import { cleanTitle } from './text';
import { addDays, localDate, localDayStart, readKickOff } from './time';
import type { SportEvent, SportsDay } from './types';

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
/** Meta pages asked per addon for live items with no time at all. */
export const META_LOOKUPS = 20;
/** Replay catalogs asked per addon: one addon has seventy. */
export const REPLAY_CATALOGS = 2;
/** Live catalogs are asked again this often while sport is on screen, when their copy is old. */
export const REFRESH_EVERY_MS = 2 * MINUTE;
const REBUILD_DELAY_MS = 30;
/** A live-first catalog is past the Live day once its kick-offs are this far ahead. */
const LIVE_HORIZON_MS = HOUR;

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
  /** Asks live catalogs again when their copy is no longer fresh. Called on a timer while wanted. */
  refresh(): void;
  /** When BannerTV first saw an event, for the limits on events with no time. */
  firstSeen(event: SportEvent): number | undefined;
  dispose(): void;
}

interface PageRead {
  data: readonly MetaPreview[];
  listings: Listing[];
  /** Ids this page brought that earlier pages of its catalog had not. */
  fresh: number;
}

interface Page {
  skip: number;
  query: Query<MetaPreview[]>;
  unsubscribe: () => void;
  read?: PageRead;
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
  pageable: boolean;
  /** How the addon counts `skip`, once the second page shows it. */
  counting?: 'items' | 'events';
  genresOpened: boolean;
  /** Ids this catalog has sent, in order, and which of them were events. */
  ids: string[];
  eventIds: string[];
  seen: Set<string>;
}

function isEvent(listing: Listing): boolean {
  return listing.kind === 'event' || listing.kind === 'replay';
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
  const listingCache = new WeakMap<MetaPreview, Listing>();
  /** Meta pages asked so far, per addon id, and which items they were for. */
  const metaCount = new Map<string, number>();
  const metaAsked = new Set<string>();
  const metaLookups: Array<() => void> = [];
  const more = new Set<string>();

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
      policy: entry.view === 'live' ? SPORTS_LIVE_POLICY : SPORTS_POLICY,
      lane,
    });
    track.pages.push({ skip, query, unsubscribe: query.subscribe(schedule) });
    query.load();
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
        ids: [],
        eventIds: [],
        seen: new Set(),
      };
      if (genre !== undefined) track.genre = genre;
      tracks.set(key, track);
    }
    return track;
  }

  /** Reads a page once its data is here, or again when it was refreshed. */
  function readPage(track: Track, page: Page): PageRead | undefined {
    const data = page.query.get().data;
    if (!data) return page.read;
    if (page.read && page.read.data === data) return page.read;
    const ctx = context(track);
    const at = now();
    const listings: Listing[] = [];
    let fresh = 0;
    for (const item of data) {
      let listing = listingCache.get(item);
      if (!listing) {
        try {
          listing = readListing(item, ctx, at);
        } catch {
          // One odd item never takes the rest of the page with it.
          continue;
        }
        listingCache.set(item, listing);
        if (memory && isEvent(listing)) memory.note(ctx.addonId, item.id, listing.kickOff);
      }
      if (listing.kind === 'placeholder') continue;
      listings.push(listing);
      if (!track.seen.has(item.id)) {
        track.seen.add(item.id);
        track.ids.push(item.id);
        fresh++;
        if (isEvent(listing)) track.eventIds.push(item.id);
      }
    }
    page.read = { data, listings, fresh };
    return page.read;
  }

  function sorted(track: Track): boolean {
    let previous: number | undefined;
    let pairs = 0;
    let backwards = 0;
    for (const page of track.pages) {
      for (const listing of page.read?.listings ?? []) {
        const at = listing.kickOff?.at;
        if (at === undefined || !isEvent(listing)) continue;
        if (previous !== undefined) {
          pairs++;
          // Live-first lists start with matches already under way: an hour's slack.
          if (at < previous - HOUR) backwards++;
        }
        previous = at;
      }
    }
    return pairs >= 2 && backwards * 10 <= pairs;
  }

  /** The catalog lists by kick-off and its last page already reaches past the day on screen. */
  function pastDay(track: Track, day: SportsDay): boolean {
    if (!sorted(track)) return false;
    const end = day === 'live' ? now() + LIVE_HORIZON_MS : localDayStart(addDays(day, 1));
    const last = track.pages[track.pages.length - 1]?.read;
    let latest: number | undefined;
    for (const listing of last?.listings ?? []) {
      const at = listing.kickOff?.at;
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
    const counted = track.counting === 'items' ? track.ids.length : track.eventIds.length;
    // A couple of repeats are cheap; a skipped match is not (docs/PLAN.md, paging by events).
    return Math.max(last.skip + 1, counted - 2);
  }

  /** After the second page: whether the addon's skip counts every item or only events. */
  function learnCounting(track: Track) {
    if (track.counting || track.pages.length < 2) return;
    const second = track.pages[1]!;
    const firstId = second.query.get().data?.[0]?.id;
    const first = track.pages[0]!.read;
    if (!firstId || !first) return;
    const items = first.listings.map((listing) => listing.source.id);
    const events = first.listings.filter(isEvent).map((listing) => listing.source.id);
    if (items[second.skip] === firstId && events[second.skip] !== firstId) track.counting = 'items';
    else if (events[second.skip] === firstId) track.counting = 'events';
  }

  function decide(track: Track, day: SportsDay) {
    if (track.stopped) return;
    const pages = track.pages;
    const last = pages[pages.length - 1]!;
    const read = last.read;
    if (!read) return;
    if (pages.length > 1 && read.fresh === 0) {
      // Nothing new: the addon ignores skip, or the catalog is at its end.
      track.stopped = 'no-new';
      if (!track.pageable) openGenres(track);
      return;
    }
    if (read.data.length < SHORT_PAGE) {
      track.stopped = 'end';
      return;
    }
    if (pages.length >= MAX_PAGES || track.ids.length >= MAX_ITEMS) {
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

  function advance(): boolean {
    let loading = false;
    if (wanted === null) return loading;
    for (const entry of active()) {
      const track = trackFor(entry);
      const followers: Track[] = [track];
      if (track.genresOpened) {
        for (const genre of entry.genres.slice(0, MAX_GENRES))
          followers.push(trackFor(entry, genre));
      }
      for (const current of followers) {
        if (current.pages.length === 0) {
          addPage(current, 0);
          loading = true;
          continue;
        }
        const last = current.pages[current.pages.length - 1]!;
        const page = last.query.get();
        if (page.status === 'idle') {
          last.query.load();
          loading = true;
          continue;
        }
        if (page.status === 'loading') {
          loading = true;
          continue;
        }
        if (page.status === 'error') {
          // Dropped when the screen closed: asked again now it is back.
          if (page.error instanceof DroppedError) {
            last.query.load();
            loading = true;
          }
          continue;
        }
        if (page.error instanceof DroppedError && page.stale) last.query.load();
        readPage(current, last);
        if (light || entry.view === 'replays' || current.genre !== undefined) continue;
        decide(current, wanted);
        const after = current.pages[current.pages.length - 1]!.query.get().status;
        if (after === 'loading' || after === 'idle') loading = true;
      }
    }
    return loading;
  }

  /** Untimed matches between two of the same day, in a catalog sorted by kick-off, get that day. */
  function withEstimates(track: Track, listings: Listing[]): Listing[] {
    if (!sorted(track)) return listings;
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
      if (listing.kickOff || listing.liveLabel || previous === undefined) continue;
      let next: number | undefined;
      for (let j = i + 1; j < out.length && next === undefined; j++) {
        if (isEvent(out[j]!)) next = out[j]!.kickOff?.at;
      }
      if (next === undefined || localDate(next) !== localDate(previous)) continue;
      out[i] = {
        ...listing,
        kickOff: { date: localDate(previous), sure: false, source: 'estimated' },
      };
    }
    return out;
  }

  function lookUpMeta(listings: readonly Listing[]) {
    if (light || wanted === null) return;
    for (const listing of listings) {
      if (listing.kind !== 'event' || !listing.liveLabel || listing.kickOff) continue;
      const { source } = listing;
      if (memory?.get(source.addonId, source.id)) continue;
      const asked = metaCount.get(source.addonId) ?? 0;
      const key = `${source.addonIndex}\n${source.id}`;
      if (asked >= META_LOOKUPS || metaAsked.has(key)) continue;
      const entry = catalogs.find((c) => c.addonIndex === source.addonIndex);
      if (!entry) continue;
      metaCount.set(source.addonId, asked + 1);
      metaAsked.add(key);
      const query = client.metaFrom(
        { addon: entry.addon, type: source.type, id: source.id },
        { lane },
      );
      let unsubscribe = () => undefined as void;
      const read = () => {
        const current = query.get();
        if (current.status === 'error') unsubscribe();
        const meta: MetaDetail | undefined = current.data;
        if (!meta) return;
        unsubscribe();
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
      unsubscribe = query.subscribe(read);
      metaLookups.push(() => unsubscribe());
      query.load();
      read();
    }
  }

  function update() {
    const loading = advance();
    const listings: Listing[] = [];
    const failed: string[] = [];
    const activeKeys = new Set(active().map((entry) => entry.key));
    tracks.forEach((track) => {
      const own: Listing[] = [];
      for (const page of track.pages) {
        const read = readPage(track, page);
        if (read) for (const listing of read.listings) own.push(listing);
      }
      for (const listing of withEstimates(track, own)) listings.push(listing);
      const last = track.pages[track.pages.length - 1];
      const page = last?.query.get();
      if (
        page?.status === 'error' &&
        !(page.error instanceof DroppedError) &&
        activeKeys.has(track.entry.key)
      ) {
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

  const feed: SportsFeed = {
    get: state.get,
    subscribe: state.subscribe,

    setCatalogs(next) {
      catalogs = next;
      const keep = new Map<string, Track>();
      tracks.forEach((track, key) => {
        const still = next.find((entry) => entry.key === track.entry.key);
        if (still && still.catalog === track.entry.catalog && still.addon === track.entry.addon) {
          keep.set(key, track);
        } else {
          for (const page of track.pages) page.unsubscribe();
        }
      });
      tracks = keep;
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
      wanted = day;
      light = nextLight;
      if (day === null) {
        lane.drop();
        stopTimer();
        schedule();
        return;
      }
      if (!stopRefresh) stopRefresh = timers.every(REFRESH_EVERY_MS, () => feed.refresh());
      update();
    },

    retry() {
      tracks.forEach((track) => {
        const last = track.pages[track.pages.length - 1];
        if (last?.query.get().status === 'error') last.query.retry();
      });
    },

    refresh() {
      if (wanted === null) return;
      tracks.forEach((track) => {
        // load() asks again only when the copy is no longer fresh.
        if (track.entry.view === 'live') track.pages[0]?.query.load();
      });
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
      for (const unsubscribe of metaLookups.splice(0)) unsubscribe();
    },
  };
  return feed;
}
