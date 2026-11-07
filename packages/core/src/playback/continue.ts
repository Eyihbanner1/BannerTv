import type { ContentType, MetaDetail, MetaPreview } from '@bannertv/protocol';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';
import { nextVideo } from './next';
import { END_SECONDS, MIN_RESUME_SECONDS, type ProgressEntry } from './progress';

const KEY = 'played';
const MAX_CARDS = 200;
/** Home shows at most this many titles to continue. */
export const CONTINUE_LIMIT = 20;

/**
 * What Home needs to show a video that played, kept beside its progress: the
 * title's name and artwork, the episode, and the episode after it. Artwork
 * addresses come from the addons' catalog and meta answers, which are cached
 * the same way; nothing about streams is kept.
 */
export interface PlayedVideo {
  videoId: string;
  metaId: string;
  type: ContentType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  releaseInfo?: string;
  runtime?: string;
  imdbRating?: string;
  /** For the hero above the row. */
  description?: string;
  /** The first three, for the hero. */
  genres?: string[];
  season?: number;
  episode?: number;
  episodeName?: string;
  /**
   * The episode after this one, aired or not: the row offers it once its
   * release time (milliseconds, when the addon gives one) has passed.
   */
  next?: { videoId: string; season?: number; episode?: number; name?: string; released?: number };
  /** Milliseconds since 1970. */
  updatedAt: number;
  /**
   * Set on a card this screen made from the meta addon for progress that had
   * none, rather than from what played: the BannerTV account does not send
   * it (ADR 0006, decision 4).
   */
  filled?: true;
}

/** What the BannerTV account changes in the cards. */
export interface PlayedAdoption {
  set?: readonly PlayedVideo[];
  remove?: readonly string[];
}

export interface PlayedVideos {
  /** Reads what was saved. Safe to call more than once. */
  load(): Promise<void>;
  get(videoId: string): PlayedVideo | undefined;
  /**
   * Saves or replaces a video's card. `filled` says the card was made from
   * the meta addon for progress without one, not from playing the video.
   */
  record(card: Omit<PlayedVideo, 'updatedAt' | 'filled'>, options?: { filled?: boolean }): void;
  /**
   * Makes the cards match a change from the BannerTV account: cards in `set`
   * are kept as given, their time included, and videos in `remove` lose theirs.
   * Once the cards have been read, the change is made before adopt() returns.
   */
  adopt(change: PlayedAdoption): Promise<void>;
  /** Bumps on every change, for screens that show the cards. */
  version(): number;
  subscribe(listener: Listener): () => void;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The card for a video, from the title (and its episode list, for a series).
 * `route` is the id and type the video's progress is saved under, which an
 * addon's answer may not repeat (asked for one id, it can answer with another).
 */
export function playedCard(
  item: MetaPreview,
  videoId: string,
  meta: MetaDetail | undefined,
  route?: { metaId: string; type: ContentType },
): Omit<PlayedVideo, 'updatedAt'> {
  const card: Omit<PlayedVideo, 'updatedAt'> = {
    videoId,
    metaId: route?.metaId ?? item.id,
    type: route?.type ?? item.type,
    name: item.name,
  };
  if (item.poster) card.poster = item.poster;
  if (item.background) card.background = item.background;
  if (item.logo) card.logo = item.logo;
  if (item.releaseInfo) card.releaseInfo = item.releaseInfo;
  if (item.runtime) card.runtime = item.runtime;
  if (item.imdbRating) card.imdbRating = item.imdbRating;
  if (item.description) card.description = item.description;
  if (item.genres.length > 0) card.genres = item.genres.slice(0, 3);
  const video = meta?.videos.find((v) => v.id === videoId);
  if (video) {
    if (video.season !== undefined) card.season = video.season;
    if (video.episode !== undefined) card.episode = video.episode;
    if (video.title) card.episodeName = video.title;
  }
  // Whether it has aired by then: a weekly show comes back to the row on its own.
  const next = meta && video ? nextVideo(meta, videoId, Infinity) : undefined;
  if (next) {
    card.next = { videoId: next.id };
    if (next.season !== undefined) card.next.season = next.season;
    if (next.episode !== undefined) card.next.episode = next.episode;
    if (next.title) card.next.name = next.title;
    const released = next.released === undefined ? NaN : Date.parse(next.released);
    if (isCount(released)) card.next.released = released;
  }
  return card;
}

function readNext(value: unknown): PlayedVideo['next'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const { videoId, season, episode, name, released } = value as Record<string, unknown>;
  if (!isText(videoId)) return undefined;
  const next: NonNullable<PlayedVideo['next']> = { videoId };
  if (isCount(season)) next.season = season;
  if (isCount(episode)) next.episode = episode;
  if (isText(name)) next.name = name;
  if (isCount(released)) next.released = released;
  return next;
}

/** A saved card, or undefined when its ids, name or time are missing. */
function readCard(value: unknown): PlayedVideo | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const { videoId, metaId, type, name, updatedAt } = raw;
  if (!isText(videoId) || !isText(metaId) || !isText(type) || !isText(name)) return undefined;
  if (!isCount(updatedAt)) return undefined;
  const card: PlayedVideo = { videoId, metaId, type, name, updatedAt };
  const texts = [
    'poster',
    'background',
    'logo',
    'releaseInfo',
    'runtime',
    'imdbRating',
    'description',
    'episodeName',
  ] as const;
  for (const field of texts) {
    const text = raw[field];
    if (isText(text)) card[field] = text;
  }
  if (Array.isArray(raw.genres)) {
    const genres = raw.genres.filter(isText).slice(0, 3);
    if (genres.length > 0) card.genres = genres;
  }
  if (isCount(raw.season)) card.season = raw.season;
  if (isCount(raw.episode)) card.episode = raw.episode;
  const next = readNext(raw.next);
  if (next) card.next = next;
  if (raw.filled === true) card.filled = true;
  return card;
}

/**
 * The cards of videos that played, one per video, at most `maxCards`, the
 * least recently played dropped first. Nothing is written until the saved
 * list has been read, so an early record never wipes it.
 */
export function createPlayedVideos(options: {
  storage: KeyValueStore;
  now?: () => number;
  maxCards?: number;
}): PlayedVideos {
  const { storage, now = Date.now, maxCards = MAX_CARDS } = options;
  // Least recently played first, so trimming drops from the front.
  const cards = new Map<string, PlayedVideo>();
  const listeners = new Set<Listener>();
  let changes = 0;
  let loading: Promise<void> | undefined;
  let loaded = false;
  let writing = false;
  let dirty = false;

  function changed() {
    changes += 1;
    listeners.forEach((listener) => listener());
  }

  function put(card: PlayedVideo) {
    cards.delete(card.videoId);
    cards.set(card.videoId, card);
    for (const videoId of cards.keys()) {
      if (cards.size <= maxCards) break;
      cards.delete(videoId);
    }
  }

  async function read() {
    let saved: unknown;
    try {
      saved = await storage.get(KEY);
    } catch {
      saved = undefined;
    }
    const early = Array.from(cards.values());
    cards.clear();
    const stored = (Array.isArray(saved) ? saved : [])
      .map(readCard)
      .filter((card): card is PlayedVideo => card !== undefined)
      // Saved least recent first; equal times keep their saved order (Chromium 68 sorts unstably).
      .map((card, index) => ({ card, index }))
      .sort((a, b) => a.card.updatedAt - b.card.updatedAt || a.index - b.index)
      .map(({ card }) => card);
    stored.forEach(put);
    early.forEach(put);
    loaded = true;
    if (stored.length > 0) changed();
  }

  function load() {
    if (!loading) loading = read();
    return loading;
  }

  async function writeLatest() {
    try {
      await load().catch(() => undefined);
      if (!loaded) return;
      while (dirty) {
        dirty = false;
        try {
          await storage.set(KEY, Array.from(cards.values()));
        } catch {
          // Out of space, for example: the cards live on in memory and the next record tries again.
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
    get: (videoId) => cards.get(videoId),
    record(card, options = {}) {
      const saved: PlayedVideo = { ...card, updatedAt: now() };
      delete saved.filled;
      if (options.filled) saved.filled = true;
      put(saved);
      save();
      changed();
    },
    adopt(change) {
      const take = () => {
        let touched = false;
        for (const videoId of change.remove ?? []) {
          if (cards.delete(videoId)) touched = true;
        }
        const set = (change.set ?? [])
          .map(readCard)
          .filter((card): card is PlayedVideo => card !== undefined);
        if (set.length === 0 && !touched) return;
        const replaced = new Set(set.map((card) => card.videoId));
        // Least recently played first again, so the limit drops the oldest wherever they came from.
        const all = Array.from(cards.values())
          .filter((card) => !replaced.has(card.videoId))
          .concat(set)
          .map((card, index) => ({ card, index }))
          .sort((a, b) => a.card.updatedAt - b.card.updatedAt || a.index - b.index);
        cards.clear();
        all.forEach(({ card }) => put(card));
        save();
        changed();
      };
      // Once the cards have been read, the change is made before adopt() returns (SyncPart.adopt).
      if (loaded) {
        take();
        return Promise.resolve();
      }
      return load()
        .catch(() => undefined)
        .then(() => {
          if (loaded) take();
        });
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

/** One title on Home's Continue Watching row. */
export interface ContinueItem {
  /** The title, for the tile, the hero and the player. */
  preview: MetaPreview;
  /** What Play opens: the video left part-way, or the next episode. */
  videoId: string;
  /** Seconds to start at. */
  startAt: number;
  /** How far through, 0 to 1, when the duration is known. */
  progress?: number;
  season?: number;
  episode?: number;
  /** True when this is the episode after one that was finished. */
  upNext: boolean;
}

function previewOf(card: PlayedVideo): MetaPreview {
  const preview: MetaPreview = {
    id: card.metaId,
    type: card.type,
    name: card.name,
    posterShape: 'poster',
    genres: card.genres ?? [],
    trailers: [],
  };
  if (card.poster) preview.poster = card.poster;
  if (card.background) preview.background = card.background;
  if (card.logo) preview.logo = card.logo;
  if (card.releaseInfo) preview.releaseInfo = card.releaseInfo;
  if (card.runtime) preview.runtime = card.runtime;
  if (card.imdbRating) preview.imdbRating = card.imdbRating;
  if (card.description) preview.description = card.description;
  return preview;
}

type ProgressReader = {
  recent(): readonly ProgressEntry[];
  get(videoId: string): ProgressEntry | undefined;
  resumeAt(videoId: string): number | undefined;
};

/** How far through, 0 to 1, when the duration is known. */
function fraction(entry: ProgressEntry | undefined): number | undefined {
  return entry && entry.duration > 0 ? Math.min(1, entry.position / entry.duration) : undefined;
}

/**
 * What a title's latest entry puts on the row, if anything. A video left
 * part-way resumes where it stopped. An episode stopped in its first seconds
 * starts again from the beginning. A finished episode, or one stopped in its
 * closing minute, gives way to the next one once it has aired (undated
 * episodes count as aired). Anything else is left out: a finished film, the
 * end of a series, a film barely started, a video whose length never became
 * known, such as a live broadcast, and one kept only to resume, such as a
 * sports replay (see ProgressEntry.continueRow).
 */
export function continueItem(
  entry: ProgressEntry,
  card: PlayedVideo,
  progress: ProgressReader,
  now: number,
): ContinueItem | undefined {
  if (entry.duration <= 0 || entry.continueRow === false) return undefined;
  const preview = previewOf(card);
  const resumeAt = progress.resumeAt(entry.videoId);
  if (resumeAt !== undefined) {
    const item: ContinueItem = {
      preview,
      videoId: entry.videoId,
      startAt: resumeAt,
      upNext: false,
    };
    const done = fraction(entry);
    if (done !== undefined) item.progress = done;
    if (card.season !== undefined) item.season = card.season;
    if (card.episode !== undefined) item.episode = card.episode;
    return item;
  }
  if (!entry.watched && entry.position < MIN_RESUME_SECONDS) {
    // Just started: the series is still on the go; a film is left out.
    if (card.episode === undefined) return undefined;
    const item: ContinueItem = { preview, videoId: entry.videoId, startAt: 0, upNext: false };
    if (card.season !== undefined) item.season = card.season;
    item.episode = card.episode;
    return item;
  }
  // Stopped in its closing minute counts as finished.
  const ending = entry.duration > 0 && entry.duration - entry.position < END_SECONDS;
  if (entry.watched || ending) {
    const next = card.next;
    if (!next || (next.released !== undefined && next.released > now)) return undefined;
    const startAt = progress.resumeAt(next.videoId);
    const item: ContinueItem = {
      preview,
      videoId: next.videoId,
      startAt: startAt ?? 0,
      upNext: true,
    };
    // Already started: its tile shows how far.
    const done = startAt !== undefined ? fraction(progress.get(next.videoId)) : undefined;
    if (done !== undefined) item.progress = done;
    if (next.season !== undefined) item.season = next.season;
    if (next.episode !== undefined) item.episode = next.episode;
    return item;
  }
  return undefined;
}

/**
 * The titles to continue, most recently watched first: for each title, what
 * its last video played puts on the row (see continueItem). Titles whose last
 * video has no card are left out. `now` decides which next episodes have aired.
 */
export function continueWatching(
  progress: ProgressReader,
  played: (videoId: string) => PlayedVideo | undefined,
  now: number,
  limit = CONTINUE_LIMIT,
): ContinueItem[] {
  const items: ContinueItem[] = [];
  const seen = new Set<string>();
  for (const entry of progress.recent()) {
    if (items.length >= limit) break;
    if (seen.has(entry.metaId)) continue;
    seen.add(entry.metaId);
    const card = played(entry.videoId);
    const item = card && continueItem(entry, card, progress, now);
    if (item) items.push(item);
  }
  return items;
}
