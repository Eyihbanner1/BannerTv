import type { ContentType, MetaDetail, MetaPreview } from '@bannertv/protocol';
import type { ProgressEntry } from '../playback/progress';
import type { LibraryItem } from './library';
import type { LibraryKind } from './views';

/**
 * The calendar: when the next episodes of the series a profile follows come
 * out, and when the films on its list are released. It is built only from
 * the meta the addons already send (a series' `videos` carry each episode's
 * `released` date, a film's meta its own), so it needs no account and no
 * other service, and it is only as right as those dates.
 */

/** How far back and ahead the calendar looks, in whole days around today. */
export interface CalendarWindow {
  /** Days before today still shown, for episodes that came out lately. */
  pastDays: number;
  /** Days after today shown. */
  aheadDays: number;
}

export const CALENDAR_WINDOW: CalendarWindow = { pastDays: 7, aheadDays: 60 };

/**
 * The most titles the calendar asks addons about. Each is one meta request,
 * cached for half a day, so a long list costs at most this many at a time.
 */
export const CALENDAR_MAX_TITLES = 40;

/** A title the calendar follows, by the id and type its meta is asked for. */
export interface FollowedTitle {
  id: string;
  type: ContentType;
}

export type CalendarKind = 'episode' | 'movie';

/** One thing coming out on a day: an episode (or a run of them), or a film. */
export interface CalendarEntry {
  /** Unique within the calendar. */
  key: string;
  kind: CalendarKind;
  /** The series or film as a tile's preview, to open its page. */
  title: MetaPreview;
  /** Milliseconds since 1970, as the addon dated it. */
  at: number;
  /** The episode's video id, or the film's own id. */
  videoId: string;
  season?: number;
  episode?: number;
  /**
   * Set when several episodes of one season come out on the same day (a
   * whole season at once): the last of them. `episode` is the first.
   */
  lastEpisode?: number;
  /** The episode's own name, when the addon gave one and it is a single episode. */
  episodeTitle?: string;
  thumbnail?: string;
  /** A film dated by when it comes out to watch at home (TMDB), not by the addon's date. */
  atHome?: true;
}

/** One day of the calendar, with what comes out on it. */
export interface CalendarDay {
  /** The local date, YYYY-MM-DD. */
  key: string;
  /** Local midnight, milliseconds since 1970. */
  start: number;
  /** Days from today: -1 yesterday, 0 today, 1 tomorrow. */
  offset: number;
  entries: CalendarEntry[];
}

const SERIES = 'series';
const MOVIE = 'movie';

function startOfDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Midnight `days` days after the one at `start`, the same in local time whatever the clocks did. */
function addDays(start: number, days: number): number {
  const date = new Date(start);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

const pad = (value: number) => (value < 10 ? `0${value}` : String(value));

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeOf(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const at = Date.parse(text);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * The titles to follow, best first, at most `limit`: series this profile is
 * watching (most recently played first), then the series and the films on My
 * List. A film it played is already out, so only My List brings films in.
 */
export function followedTitles(
  items: readonly LibraryItem[],
  entries: readonly ProgressEntry[],
  limit: number = CALENDAR_MAX_TITLES,
): FollowedTitle[] {
  const seen = new Set<string>();
  const followed: FollowedTitle[] = [];
  const follow = (id: string, type: ContentType) => {
    const key = `${type}:${id}`;
    if (followed.length >= limit || seen.has(key)) return;
    seen.add(key);
    followed.push({ id, type });
  };
  for (const entry of entries) {
    if (entry.type === SERIES) follow(entry.metaId, SERIES);
  }
  for (const item of items) {
    if (item.type === SERIES) follow(item.id, SERIES);
  }
  for (const item of items) {
    if (item.type === MOVIE) follow(item.id, MOVIE);
  }
  return followed;
}

/** A series' or film's meta as a tile's preview, without its episodes and cast. */
function previewOf(meta: MetaDetail): MetaPreview {
  const preview: MetaPreview = {
    id: meta.id,
    type: meta.type,
    name: meta.name,
    posterShape: meta.posterShape,
    genres: meta.genres.slice(),
    trailers: meta.trailers.slice(),
  };
  if (meta.poster) preview.poster = meta.poster;
  if (meta.background) preview.background = meta.background;
  if (meta.logo) preview.logo = meta.logo;
  if (meta.description) preview.description = meta.description;
  if (meta.releaseInfo) preview.releaseInfo = meta.releaseInfo;
  if (meta.imdbRating) preview.imdbRating = meta.imdbRating;
  if (meta.runtime) preview.runtime = meta.runtime;
  return preview;
}

/**
 * What one title brings to the calendar between `pastDays` before today and
 * `aheadDays` after it: a series' dated episodes (specials, season 0, left
 * out), or a film's release. A film's `homeRelease` (milliseconds), when
 * known, dates it instead of the addon's date, which is usually the cinema's.
 */
export function calendarEntries(
  meta: MetaDetail,
  now: number,
  window: CalendarWindow = CALENDAR_WINDOW,
  homeRelease?: number,
): CalendarEntry[] {
  const today = startOfDay(now);
  const from = addDays(today, -window.pastDays);
  const to = addDays(today, window.aheadDays + 1);
  const inWindow = (at: number | undefined): at is number =>
    at !== undefined && at >= from && at < to;
  const title = previewOf(meta);
  const entries: CalendarEntry[] = [];
  if (meta.type === MOVIE) {
    const at = homeRelease ?? timeOf(meta.released);
    if (!inWindow(at)) return entries;
    const entry: CalendarEntry = { key: meta.id, kind: 'movie', title, at, videoId: meta.id };
    if (homeRelease !== undefined) entry.atHome = true;
    entries.push(entry);
    return entries;
  }
  for (const video of meta.videos) {
    if (video.season === 0) continue;
    const at = timeOf(video.released);
    if (!inWindow(at)) continue;
    const entry: CalendarEntry = { key: video.id, kind: 'episode', title, at, videoId: video.id };
    if (video.season !== undefined) entry.season = video.season;
    if (video.episode !== undefined) entry.episode = video.episode;
    if (video.title) entry.episodeTitle = video.title;
    if (video.thumbnail) entry.thumbnail = video.thumbnail;
    entries.push(entry);
  }
  return entries;
}

/** Earliest first; on the same moment by name, then season and episode. */
function compare(a: CalendarEntry, b: CalendarEntry): number {
  return (
    a.at - b.at ||
    a.title.name.localeCompare(b.title.name, 'en', { sensitivity: 'base' }) ||
    (a.season ?? 0) - (b.season ?? 0) ||
    (a.episode ?? 0) - (b.episode ?? 0)
  );
}

/**
 * The entries by local day, earliest first. Episodes of one season that come
 * out on the same day become one entry, from the first to the last.
 */
export function calendarDays(entries: readonly CalendarEntry[], now: number): CalendarDay[] {
  const today = startOfDay(now);
  // Chromium 68 sorts unstably, so ties keep their order by hand.
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compare(a.entry, b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
  const days: CalendarDay[] = [];
  const runs = new Map<string, CalendarEntry>();
  for (const entry of sorted) {
    const key = dayKey(entry.at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const start = startOfDay(entry.at);
      day = { key, start, offset: Math.round((start - today) / 86400000), entries: [] };
      days.push(day);
      runs.clear();
    }
    const run = `${entry.title.type}:${entry.title.id}:${entry.season ?? ''}`;
    const first = entry.kind === 'episode' ? runs.get(run) : undefined;
    if (first && entry.episode !== undefined && first.episode !== undefined) {
      first.lastEpisode = Math.max(first.lastEpisode ?? first.episode, entry.episode);
      delete first.episodeTitle;
      continue;
    }
    const copy: CalendarEntry = { ...entry };
    if (entry.kind === 'episode') runs.set(run, copy);
    day.entries.push(copy);
  }
  return days;
}

/**
 * The calendar for a screen: every followed title's entries, of one kind or
 * both (series for episodes, films for releases), by day. `homeReleases`
 * dates films by when they come out at home, by the meta's id.
 */
export function calendarView(
  metas: readonly MetaDetail[],
  now: number,
  kind: LibraryKind = 'all',
  window: CalendarWindow = CALENDAR_WINDOW,
  homeReleases?: ReadonlyMap<string, number>,
): CalendarDay[] {
  const entries: CalendarEntry[] = [];
  for (const meta of metas) {
    const home = meta.type === MOVIE ? homeReleases?.get(meta.id) : undefined;
    for (const entry of calendarEntries(meta, now, window, home)) {
      if (kind === 'all' || (kind === 'movie') === (entry.kind === 'movie')) entries.push(entry);
    }
  }
  return calendarDays(entries, now);
}

/** Where the calendar opens: the first day from today on, or the last day when all have passed. */
export function calendarStart(days: readonly CalendarDay[]): number {
  const index = days.findIndex((day) => day.offset >= 0);
  return index >= 0 ? index : Math.max(0, days.length - 1);
}
