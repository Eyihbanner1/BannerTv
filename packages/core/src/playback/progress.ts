import type { ContentType } from '@bannertv/protocol';
import type { Listener } from '../store';
import type { KeyValueStore } from '../storage';

/** Past this share of the video it counts as watched (docs/PLAN.md: 90%, configurable later). */
export const WATCHED_FRACTION = 0.9;
/** Closer to the start than this, playback simply starts over. */
export const MIN_RESUME_SECONDS = 30;
/** Resuming this close to the end would only show the credits, so it starts over instead. */
export const END_SECONDS = 60;
/**
 * Trakt keeps progress as a rounded percentage. Within this share of the
 * video's own place it is the same place, as when the TV's stop comes back.
 */
const SAME_PLACE_FRACTION = 0.01;
const KEY = 'progress';

export interface ProgressEntry {
  /** The title: the movie's or the series' meta id. */
  metaId: string;
  type: ContentType;
  /** What played: the movie's id again, or the episode's video id. */
  videoId: string;
  /** Seconds. */
  position: number;
  /** Seconds; 0 while unknown. */
  duration: number;
  /** Milliseconds since 1970. */
  updatedAt: number;
  watched: boolean;
}

export type ProgressUpdate = Pick<
  ProgressEntry,
  'metaId' | 'type' | 'videoId' | 'position' | 'duration'
>;

export interface ProgressStore {
  /** Reads saved progress. Safe to call more than once. */
  load(): Promise<void>;
  get(videoId: string): ProgressEntry | undefined;
  /** Every entry of one title, most recent first. */
  forMeta(metaId: string): ProgressEntry[];
  /** Every entry, most recent first. */
  recent(): ProgressEntry[];
  /**
   * Saves where playback is. Marks the video watched once the position
   * passes WATCHED_FRACTION of a known duration; a watched video stays
   * watched until it is started over. Writes to storage straight away.
   */
  record(update: ProgressUpdate): ProgressEntry;
  /** Forgets the position (Start over); keeps nothing about the video. */
  clear(videoId: string): void;
  /**
   * Brings in progress made elsewhere (Trakt): each entry replaces the
   * video's own only when it is newer. A video watched here stays watched.
   * When the TV knows the video's length, an entry's place is read as a
   * share of the video and put onto that length, and one within about a
   * percentage point of the TV's own place leaves it as it is.
   * Resolves with how many entries were taken.
   */
  merge(entries: readonly ProgressEntry[]): Promise<number>;
  /**
   * Where to resume in seconds, or undefined to start from the beginning:
   * never near either end, nor in a video whose length is unknown.
   */
  resumeAt(videoId: string): number | undefined;
  /** Bumps on every change, for screens that show progress. */
  version(): number;
  subscribe(listener: Listener): () => void;
}

/**
 * Players report NaN before metadata and Infinity for live streams; both mean
 * "unknown". The player saves nothing for a live stream; an unknown length
 * saved before it knew better is never resumed.
 */
function seconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** A saved entry, or undefined when any field is missing or of the wrong kind. */
function readEntry(value: unknown): ProgressEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { metaId, type, videoId, position, duration, updatedAt, watched } = value as Record<
    string,
    unknown
  >;
  if (!isId(metaId) || !isId(type) || !isId(videoId)) return undefined;
  if (!isAmount(position) || !isAmount(duration) || !isAmount(updatedAt)) return undefined;
  if (typeof watched !== 'boolean') return undefined;
  return { metaId, type, videoId, position, duration, updatedAt, watched };
}

/** Chromium 68 does not sort stably, so equal times keep their order in `entries` by hand. */
function newestFirst(entries: ProgressEntry[]): ProgressEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * The readable saved entries, one per video (the latest), oldest first. The
 * list is saved least recent first, so of two entries with the same time the
 * later one in the list is the more recent: reversing a newest-first sort
 * would swap them on every launch.
 */
function readEntries(saved: unknown): ProgressEntry[] {
  if (!Array.isArray(saved)) return [];
  const latest = new Map<string, { entry: ProgressEntry; index: number }>();
  for (let index = 0; index < saved.length; index++) {
    const entry = readEntry(saved[index]);
    if (!entry) continue;
    const other = latest.get(entry.videoId);
    if (!other || other.entry.updatedAt <= entry.updatedAt) {
      latest.set(entry.videoId, { entry, index });
    }
  }
  return Array.from(latest.values())
    .sort((a, b) => a.entry.updatedAt - b.entry.updatedAt || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Watch progress for every video, kept as one list in the key-value store
 * and capped at `maxEntries`, oldest dropped first. Writes are serialised so
 * an older list never lands after a newer one.
 *
 * Nothing is written until the saved list has been read, because writing
 * first would wipe it; a record() before load() starts the read itself.
 */
export function createProgressStore(options: {
  storage: KeyValueStore;
  now?: () => number;
  maxEntries?: number;
}): ProgressStore {
  const { storage, now = Date.now, maxEntries = 500 } = options;
  // In the order they were last updated, least recent first, so trimming drops from the front.
  const entries = new Map<string, ProgressEntry>();
  const listeners = new Set<Listener>();
  let changes = 0;
  let loading: Promise<void> | undefined;
  let loaded = false;
  // Videos started over before the saved list arrived: their saved entries must not come back.
  const clearedEarly = new Set<string>();
  let writing = false;
  let dirty = false;

  function changed() {
    changes += 1;
    listeners.forEach((listener) => listener());
  }

  function put(entry: ProgressEntry) {
    entries.delete(entry.videoId);
    entries.set(entry.videoId, entry);
  }

  function trim() {
    for (const videoId of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(videoId);
    }
  }

  async function read() {
    let saved: unknown;
    try {
      saved = await storage.get(KEY);
    } catch {
      saved = undefined;
    }
    const early = Array.from(entries.values());
    const stored = readEntries(saved).filter((entry) => !clearedEarly.has(entry.videoId));
    entries.clear();
    stored.forEach(put);
    for (const entry of early) {
      // A rewatch begun before the list arrived did not know the video was already watched.
      const watchedBefore = entries.get(entry.videoId)?.watched === true;
      put(watchedBefore && !entry.watched ? { ...entry, watched: true } : entry);
    }
    trim();
    loaded = true;
    clearedEarly.clear();
    if (stored.length > 0) changed();
  }

  function load() {
    if (!loading) loading = read();
    return loading;
  }

  async function writeLatest() {
    try {
      // load() also rejects when a listener throws, but by then the list has
      // been read; only an unread list must never be written over.
      await load().catch(() => undefined);
      if (!loaded) return;
      // Records that arrive during a write only mark the list dirty, so the next
      // write carries all of them at once and storage ends with the newest list.
      while (dirty) {
        dirty = false;
        try {
          await storage.set(KEY, Array.from(entries.values()));
        } catch {
          // Out of space, for example: the list lives on in memory and the next record tries again.
        }
      }
    } finally {
      writing = false;
    }
  }

  function save() {
    dirty = true;
    if (writing) return;
    writing = true;
    void writeLatest();
  }

  return {
    load,
    get: (videoId) => entries.get(videoId),
    forMeta(metaId) {
      const ofMeta = Array.from(entries.values()).filter((entry) => entry.metaId === metaId);
      return newestFirst(ofMeta.reverse());
    },
    recent: () => newestFirst(Array.from(entries.values()).reverse()),
    record(update) {
      const position = seconds(update.position);
      const duration = seconds(update.duration);
      const reachedEnd = duration > 0 && position >= WATCHED_FRACTION * duration;
      const entry: ProgressEntry = {
        metaId: update.metaId,
        type: update.type,
        videoId: update.videoId,
        position,
        duration,
        updatedAt: now(),
        watched: reachedEnd || entries.get(update.videoId)?.watched === true,
      };
      put(entry);
      trim();
      save();
      changed();
      return entry;
    },
    clear(videoId) {
      const had = entries.delete(videoId);
      if (!loaded) clearedEarly.add(videoId);
      if (had || !loaded) save();
      if (had) changed();
    },
    async merge(incoming) {
      await load().catch(() => undefined);
      if (!loaded) return 0;
      let taken = 0;
      for (const value of incoming) {
        let entry = readEntry(value);
        if (!entry) continue;
        const own = entries.get(entry.videoId);
        if (own && own.updatedAt >= entry.updatedAt) continue;
        if (own && own.duration > 0 && entry.duration > 0) {
          // Trakt's length for a video is its runtime, not the stream's: a share
          // of it lands somewhere else in the stream the TV plays.
          const share = Math.min(entry.position / entry.duration, 1);
          const same = Math.abs(share - own.position / own.duration) <= SAME_PLACE_FRACTION;
          // Most often the TV's own stop coming back. One finished elsewhere still counts.
          if (same && (own.watched || !entry.watched)) continue;
          entry = { ...entry, position: share * own.duration, duration: own.duration };
        }
        entries.set(entry.videoId, own?.watched ? { ...entry, watched: true } : entry);
        taken += 1;
      }
      if (taken === 0) return 0;
      // Kept least recently updated first, so trimming drops the oldest, wherever they came from.
      const sorted = readEntries(Array.from(entries.values()));
      entries.clear();
      sorted.forEach(put);
      trim();
      save();
      changed();
      return taken;
    },
    resumeAt(videoId) {
      const entry = entries.get(videoId);
      if (!entry || entry.position < MIN_RESUME_SECONDS) return undefined;
      // No known length, as for a live broadcast: there is no place in it to come back to.
      if (entry.duration <= 0) return undefined;
      if (entry.duration - entry.position < END_SECONDS) return undefined;
      // A rewatch resumes too, but never from the credits of one already seen.
      if (entry.position >= entry.duration * WATCHED_FRACTION) return undefined;
      return entry.position;
    },
    version: () => changes,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
