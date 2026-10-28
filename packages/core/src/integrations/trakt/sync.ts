import type { LibraryChange, Library, RemoteLibraryItem } from '../../library/library';
import { createPersisted } from '../../persisted';
import type { ProgressEntry, ProgressStore } from '../../playback/progress';
import type { WatchedSet } from '../../playback/watched';
import type { KeyValueStore } from '../../storage';
import type { TraktAccount } from './account';
import { metaIdFromIds, type TraktIds, traktIds } from './ids';
import { list, positive, record, text, time, whole } from './read';
import {
  isOk,
  isSignedOutError,
  realTimers,
  TraktError,
  type TraktResponse,
  type TraktTimers,
} from './transport';

const KEY = 'traktSync';
/** A show watched this recently gets its latest episode as finished progress, for Continue Watching. */
export const TRAKT_RECENT_SHOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Trakt takes one change a second; a Retry-After longer than this waits for the next sync. */
const MAX_RETRY_AFTER_S = 10;

export type TraktSyncResult = 'done' | 'skipped' | 'failed';

export interface TraktSync {
  /**
   * Brings in what changed on Trakt since the last run, and sends My List's
   * waiting changes. Skipped while signed out; two runs at once share one.
   * Never rejects.
   */
  run(): Promise<TraktSyncResult>;
  /** Sends My List's waiting changes to Trakt's watchlist. Never rejects. */
  pushLibrary(): Promise<void>;
}

export interface TraktSyncOptions {
  account: Pick<TraktAccount, 'load' | 'get' | 'subscribe' | 'call'>;
  /** The profile's store, where the last activity times are kept. */
  storage: KeyValueStore;
  targets: {
    progress: Pick<ProgressStore, 'merge'>;
    library: Pick<Library, 'load' | 'outbox' | 'sent' | 'mergeRemote' | 'forgetRemote'>;
    watched: Pick<WatchedSet, 'replace'>;
  };
  now?: () => number;
  timers?: TraktTimers;
}

type Group = 'paused' | 'watched' | 'watchlist';

/** The fields of sync/last_activities that say when each group last changed. */
const FIELDS: Record<Group, readonly string[]> = {
  paused: ['movies.paused_at', 'episodes.paused_at'],
  watched: ['movies.watched_at', 'episodes.watched_at'],
  watchlist: ['movies.watchlisted_at', 'shows.watchlisted_at', 'watchlist.updated_at'],
};
const GROUPS: readonly Group[] = ['paused', 'watched', 'watchlist'];
const ALL_FIELDS = FIELDS.paused.concat(FIELDS.watched, FIELDS.watchlist);

/** Activity times by field, such as `movies.paused_at`. */
type Times = Record<string, string>;

/** The activity times of the last run, or null before the first. */
type SyncState = { times: Times } | null;

/** The times in a sync/last_activities answer. */
function readActivities(data: Record<string, unknown>): Times {
  const times: Times = {};
  for (const field of ALL_FIELDS) {
    const [section = '', name = ''] = field.split('.');
    const at = text(record(data[section])?.[name]);
    if (at) times[field] = at;
  }
  return times;
}

function readState(saved: unknown): SyncState {
  const raw = record(record(saved)?.times);
  if (!raw) return null;
  const times: Times = {};
  for (const field of ALL_FIELDS) {
    const at = text(raw[field]);
    if (at) times[field] = at;
  }
  return { times };
}

/** A paused film or episode from sync/playback, as progress. */
function pausedEntry(value: unknown): ProgressEntry | undefined {
  const item = record(value);
  const percent = item?.progress;
  const updatedAt = time(item?.paused_at);
  if (typeof percent !== 'number' || !(percent >= 0) || updatedAt === undefined) return undefined;
  let metaId: string | undefined;
  let videoId: string | undefined;
  let minutes: number | undefined;
  if (item?.type === 'movie') {
    const movie = record(item.movie);
    metaId = metaIdFromIds(movie?.ids);
    videoId = metaId;
    minutes = positive(movie?.runtime);
  } else if (item?.type === 'episode') {
    const show = record(item.show);
    const episode = record(item.episode);
    metaId = metaIdFromIds(show?.ids);
    const season = whole(episode?.season);
    const number = whole(episode?.number);
    if (metaId && season !== undefined && number !== undefined) {
      videoId = `${metaId}:${season}:${number}`;
    }
    // An episode Trakt has no length for takes its show's.
    minutes = positive(episode?.runtime) ?? positive(show?.runtime);
  }
  if (!metaId || !videoId || minutes === undefined) return undefined;
  const duration = minutes * 60;
  return {
    metaId,
    type: item?.type === 'movie' ? 'movie' : 'series',
    videoId,
    position: (Math.min(percent, 100) / 100) * duration,
    duration,
    updatedAt,
    watched: false,
  };
}

interface WatchedShows {
  videoIds: string[];
  /** The latest episode of each show watched lately, as finished progress. */
  finished: ProgressEntry[];
}

function watchedShows(items: readonly unknown[], since: number): WatchedShows {
  const videoIds: string[] = [];
  const finished: ProgressEntry[] = [];
  for (const value of items) {
    const item = record(value);
    const show = record(item?.show);
    const metaId = metaIdFromIds(show?.ids);
    if (!metaId) continue;
    let latest: { videoId: string; at: number; season: number; number: number } | undefined;
    for (const seasonValue of list(item?.seasons)) {
      const season = whole(record(seasonValue)?.number);
      if (season === undefined) continue;
      for (const episodeValue of list(record(seasonValue)?.episodes)) {
        const episode = record(episodeValue);
        const number = whole(episode?.number);
        if (number === undefined) continue;
        const videoId = `${metaId}:${season}:${number}`;
        videoIds.push(videoId);
        const at = time(episode?.last_watched_at);
        if (at === undefined) continue;
        // Episodes marked watched together share a time: the furthest one is the latest.
        const isLater =
          !latest ||
          at > latest.at ||
          (at === latest.at &&
            (season > latest.season || (season === latest.season && number > latest.number)));
        if (isLater) latest = { videoId, at, season, number };
      }
    }
    const minutes = positive(show?.runtime);
    if (!latest || minutes === undefined || latest.at < since) continue;
    finished.push({
      metaId,
      type: 'series',
      videoId: latest.videoId,
      position: minutes * 60,
      duration: minutes * 60,
      updatedAt: latest.at,
      watched: true,
    });
  }
  return { videoIds, finished };
}

function watchlistItem(value: unknown, kind: 'movie' | 'show'): RemoteLibraryItem | undefined {
  const item = record(value);
  const title = record(item?.[kind]);
  const id = metaIdFromIds(title?.ids);
  if (!id) return undefined;
  const entry: RemoteLibraryItem = {
    id,
    type: kind === 'movie' ? 'movie' : 'series',
    // Leaving a title out would read as taken off the list on Trakt, so a missing name is the id.
    name: text(title?.title) ?? id,
    addedAt: time(item?.listed_at) ?? 0,
  };
  const year = whole(title?.year);
  if (year) entry.releaseInfo = String(year);
  return entry;
}

/** The meta ids in an add's not_found, which Trakt did not put on the list. */
function notFound(data: unknown): Set<string> {
  const missing = new Set<string>();
  const raw = record(record(data)?.not_found);
  for (const kind of ['movies', 'shows']) {
    for (const value of list(raw?.[kind])) {
      const id = metaIdFromIds(record(value)?.ids);
      if (id) missing.add(id);
    }
  }
  return missing;
}

interface Batch {
  movies: { ids: TraktIds }[];
  shows: { ids: TraktIds }[];
  changes: LibraryChange[];
}

const emptyBatch = (): Batch => ({ movies: [], shows: [], changes: [] });

/**
 * Trakt sync for one profile (docs/adr/0004, item 12). Each run asks
 * sync/last_activities and fetches only what changed since the last run:
 * paused progress, what was watched, and the watchlist, which is kept the
 * same as My List both ways. Activity times are saved only for what was
 * fetched in full, so anything that failed is fetched again next run.
 *
 * Signing out forgets the sync: the activity times, My List's link to the
 * watchlist, and the watched ticks, so the next account starts afresh.
 */
export function createTraktSync(options: TraktSyncOptions): TraktSync {
  const { account, storage, targets, now = Date.now, timers = realTimers } = options;
  const { progress, library, watched } = targets;
  const saved = createPersisted<SyncState>({ storage, key: KEY, initial: null, read: readState });
  // Bumps at sign-out, so a run that began before it writes nothing.
  let generation = 0;
  let running: Promise<TraktSyncResult> | undefined;
  let pushing: Promise<boolean> | undefined;
  let pushNext: Promise<boolean> | undefined;

  let signedIn = account.get().status === 'signedIn';
  account.subscribe(() => {
    const was = signedIn;
    signedIn = account.get().status === 'signedIn';
    if (was && !signedIn) void forget();
  });

  async function forget() {
    generation += 1;
    await Promise.all([
      saved.update(() => null),
      library.forgetRemote(),
      watched.replace([]),
    ]).catch(() => undefined);
  }

  /** Stops a run that outlived its sign-in before it writes anything. */
  function check(mine: number) {
    if (mine !== generation) throw new TraktError('signedOut', 'Signed out of Trakt during sync');
  }

  async function get(path: string): Promise<unknown> {
    const response = await account.call('GET', path);
    if (!isOk(response.status)) throw new TraktError('other', `Trakt answered ${response.status}`);
    return response.data;
  }

  /** A list answer. Anything else fails, since an empty list would read as everything removed. */
  async function getList(path: string): Promise<readonly unknown[]> {
    const data = await get(path);
    if (!Array.isArray(data)) {
      throw new TraktError('other', 'Trakt sent a list BannerTV cannot read');
    }
    return data;
  }

  function wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      timers.setTimeout(() => resolve(), seconds * 1000);
    });
  }

  async function post(path: string, body: unknown): Promise<TraktResponse> {
    const response = await account.call('POST', path, body);
    const retryAfter = response.retryAfter ?? 1;
    if (response.status !== 429 || retryAfter > MAX_RETRY_AFTER_S) return response;
    // Trakt takes one change a second, and a sync can send two in a row.
    await wait(retryAfter);
    return account.call('POST', path, body);
  }

  async function syncPaused(mine: number) {
    const entries: ProgressEntry[] = [];
    for (const item of await getList('/sync/playback?extended=full')) {
      const entry = pausedEntry(item);
      if (entry) entries.push(entry);
    }
    check(mine);
    await progress.merge(entries);
  }

  async function syncWatched(mine: number) {
    const movies = await getList('/sync/watched/movies');
    const shows = await getList('/sync/watched/shows?extended=full');
    const videoIds: string[] = [];
    for (const item of movies) {
      const id = metaIdFromIds(record(record(item)?.movie)?.ids);
      if (id) videoIds.push(id);
    }
    const episodes = watchedShows(shows, now() - TRAKT_RECENT_SHOW_MS);
    check(mine);
    await watched.replace(videoIds.concat(episodes.videoIds));
    if (episodes.finished.length > 0) await progress.merge(episodes.finished);
  }

  async function pullWatchlist(mine: number) {
    const movies = await getList('/sync/watchlist/movies');
    const shows = await getList('/sync/watchlist/shows');
    const remote: RemoteLibraryItem[] = [];
    for (const item of movies) {
      const entry = watchlistItem(item, 'movie');
      if (entry) remote.push(entry);
    }
    for (const item of shows) {
      const entry = watchlistItem(item, 'show');
      if (entry) remote.push(entry);
    }
    check(mine);
    await library.mergeRemote(remote);
  }

  /** Sends the outbox once. Resolves false when a request failed, so its changes wait for the next push. */
  async function sendOutbox(): Promise<boolean> {
    await library.load();
    const outbox = library.outbox().slice();
    if (outbox.length === 0) return true;
    await account.load();
    if (account.get().status !== 'signedIn') return true;
    const mine = generation;
    const adds = emptyBatch();
    const removes = emptyBatch();
    const done: LibraryChange[] = [];
    for (const change of outbox) {
      const ids = traktIds(change.id);
      const kind = change.type === 'movie' ? 'movies' : change.type === 'series' ? 'shows' : null;
      if (!ids || !kind) {
        // Trakt cannot take it. A removal can go; an addition stays queued, because
        // one marked sent counts as on Trakt's list and the next sync would take it
        // out of My List.
        if (change.op === 'remove') done.push(change);
        continue;
      }
      const batch = change.op === 'add' ? adds : removes;
      batch[kind].push({ ids });
      batch.changes.push(change);
    }
    let ok = true;
    for (const [path, batch] of [
      ['/sync/watchlist', adds],
      ['/sync/watchlist/remove', removes],
    ] as const) {
      if (batch.changes.length === 0) continue;
      let response: TraktResponse;
      try {
        response = await post(path, { movies: batch.movies, shows: batch.shows });
      } catch (error) {
        if (isSignedOutError(error)) throw error;
        ok = false;
        continue;
      }
      if (!isOk(response.status)) {
        ok = false;
        continue;
      }
      // Titles Trakt does not know yet stay queued, to be tried again next time.
      const missing = batch === adds ? notFound(response.data) : new Set<string>();
      for (const change of batch.changes) {
        if (!missing.has(change.id)) done.push(change);
      }
    }
    check(mine);
    if (done.length > 0) await library.sent(done);
    return ok;
  }

  /** One push at a time; one asked for during a push runs after it, for what came since. */
  function push(): Promise<boolean> {
    if (!pushing) {
      pushing = sendOutbox().finally(() => {
        pushing = undefined;
      });
      return pushing;
    }
    if (!pushNext) {
      const after = () => {
        pushNext = undefined;
        return push();
      };
      pushNext = pushing.then(after, after);
    }
    return pushNext;
  }

  async function syncWatchlist(
    changed: boolean,
    mine: number,
  ): Promise<{ pulled: boolean; pushed: boolean }> {
    // What the TV changed goes first, so the pull does not undo it.
    let pushed = await pushOrFail();
    if (!changed) return { pulled: true, pushed };
    try {
      await pullWatchlist(mine);
    } catch (error) {
      if (isSignedOutError(error)) throw error;
      return { pulled: false, pushed };
    }
    // The merge queues titles saved here that Trakt never had.
    pushed = (await pushOrFail()) && pushed;
    return { pulled: true, pushed };
  }

  async function pushOrFail(): Promise<boolean> {
    try {
      return await push();
    } catch (error) {
      if (isSignedOutError(error)) throw error;
      return false;
    }
  }

  async function sync(): Promise<TraktSyncResult> {
    await account.load();
    if (account.get().status !== 'signedIn') return 'skipped';
    await saved.load();
    const mine = generation;
    const activities = record(await get('/sync/last_activities'));
    if (!activities) throw new TraktError('other', 'Trakt sent activity BannerTV cannot read');
    const times = readActivities(activities);
    const last = saved.get();
    const kept: Times = last ? { ...last.times } : {};
    let failed = false;
    for (const group of GROUPS) {
      const changed = !last || FIELDS[group].some((field) => times[field] !== last.times[field]);
      let fetched = true;
      try {
        if (group === 'watchlist') {
          const result = await syncWatchlist(changed, mine);
          fetched = result.pulled;
          if (!result.pushed) failed = true;
        } else if (changed) {
          await (group === 'paused' ? syncPaused(mine) : syncWatched(mine));
        }
      } catch (error) {
        if (isSignedOutError(error)) throw error;
        fetched = false;
      }
      if (!fetched) {
        failed = true;
        continue;
      }
      for (const field of FIELDS[group]) {
        const at = times[field];
        if (at === undefined) delete kept[field];
        else kept[field] = at;
      }
    }
    check(mine);
    const same =
      last !== null &&
      Object.keys(kept).length === Object.keys(last.times).length &&
      Object.keys(kept).every((field) => kept[field] === last.times[field]);
    if (!same) await saved.update(() => ({ times: kept }));
    return failed ? 'failed' : 'done';
  }

  return {
    run() {
      if (!running) {
        running = sync()
          .catch((error: unknown): TraktSyncResult =>
            isSignedOutError(error) ? 'skipped' : 'failed',
          )
          .finally(() => {
            running = undefined;
          });
      }
      return running;
    },
    pushLibrary: () =>
      push().then(
        () => undefined,
        () => undefined,
      ),
  };
}
