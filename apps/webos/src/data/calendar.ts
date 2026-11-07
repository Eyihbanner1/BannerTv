import {
  type CalendarDay,
  type CalendarEntry,
  calendarView,
  type FollowedTitle,
  followedTitles,
  kidsTitleAllowed,
  type LibraryKind,
  libraryPreview,
} from '@bannertv/core';
import type { MetaDetail } from '@bannertv/protocol';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { addonClient } from './addons';
import { library, watchedSet } from './library';
import { playedVideos, progress } from './playback';
import { isKidsProfile } from './profiles';
import { tmdbClient, useTmdbOn } from './tmdb';

export interface CalendarState {
  days: CalendarDay[];
  /** Some followed titles' dates are still being asked for. */
  loading: boolean;
  /** How many titles the calendar follows. */
  following: number;
}

const subscribeLists = (listener: () => void) => {
  const undo = [
    library.subscribe(listener),
    progress.subscribe(listener),
    playedVideos.subscribe(listener),
  ];
  return () => undo.forEach((stop) => stop());
};
const listVersions = () => `${library.version()}:${progress.version()}:${playedVideos.version()}`;

/** What the calendar follows, for useSyncExternalStore. */
export interface CalendarWatch {
  subscribe(listener: () => void): () => void;
  version(): string;
}

const followLists: CalendarWatch = { subscribe: subscribeLists, version: listVersions };
const followNothing: CalendarWatch = { subscribe: () => () => undefined, version: () => 'off' };

/**
 * My List and the history while the calendar is on show, and nothing while it is not, so a
 * screen that keeps it off (the Library on My List) is not drawn again each time a video
 * saves its place, every 10 seconds.
 */
export function calendarWatch(enabled: boolean): CalendarWatch {
  return enabled ? followLists : followNothing;
}

/** Followed while the calendar is off, or before the lists have loaded: one shared list. */
const NOT_FOLLOWING: readonly FollowedTitle[] = [];

/**
 * The calendar of the series this profile watches and the series and films
 * on its My List, from their addons' meta (cached, so a second visit opens
 * at once). Shared by the TV and the phone. While `enabled` is false nothing
 * is asked for, and no store is followed.
 */
export function useCalendar(kind: LibraryKind, enabled = true): CalendarState {
  const watch = calendarWatch(enabled);
  const lists = useSyncExternalStore(watch.subscribe, watch.version);
  const [loaded, setLoaded] = useState(false);
  const [changes, setChanges] = useState(0);
  // Read once per visit; a screen left open past midnight shows yesterday's "Today".
  const [now] = useState(Date.now);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.all([library.load(), progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [enabled]);

  const followed = useMemo(() => {
    if (!enabled || !loaded) return NOT_FOLLOWING;
    const kids = isKidsProfile();
    const items = kids
      ? library.items().filter((item) => kidsTitleAllowed(libraryPreview(item), true))
      : library.items();
    return followedTitles(items, progress.recent());
    // `lists` stands for the contents of My List and the history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loaded, lists]);
  const queries = useMemo(
    () => followed.map((title) => addonClient.meta(title.type, title.id)),
    [followed],
  );
  // With TMDB on, a film is dated by when it comes out at home, from the details Details
  // reads (and caches) anyway. Only IMDb ids can be looked up there.
  const tmdbOn = useTmdbOn();
  const homeQueries = useMemo(
    () =>
      tmdbOn
        ? followed.map((title) =>
            title.type === 'movie' && title.id.startsWith('tt')
              ? tmdbClient.details('movie', title.id)
              : null,
          )
        : [],
    [followed, tmdbOn],
  );

  useEffect(() => {
    const all = [...queries, ...homeQueries.filter((query) => query !== null)];
    const stops = all.map((query) => query.subscribe(() => setChanges((n) => n + 1)));
    all.forEach((query) => query.load());
    return () => stops.forEach((stop) => stop());
  }, [queries, homeQueries]);

  return useMemo(() => {
    const states = queries.map((query) => query.get());
    const homeStates = homeQueries.map((query) => query?.get());
    const kids = isKidsProfile();
    const metas: MetaDetail[] = [];
    const homeReleases = new Map<string, number>();
    states.forEach((state, index) => {
      const meta = state.data;
      if (!meta || (kids && !kidsTitleAllowed(meta, true))) return;
      metas.push(meta);
      const home = homeStates[index]?.data?.homeRelease;
      if (home !== undefined) homeReleases.set(meta.id, home);
    });
    const waiting = (state: { status: string } | undefined) =>
      state !== undefined && (state.status === 'idle' || state.status === 'loading');
    return {
      days: calendarView(metas, now, kind, undefined, homeReleases),
      loading: enabled && (!loaded || states.some(waiting) || homeStates.some(waiting)),
      following: queries.length,
    };
    // `changes` stands for the queries' answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries, homeQueries, changes, kind, now, loaded, enabled]);
}

const weekday = (start: number, form: 'long' | 'short') =>
  new Date(start).toLocaleDateString('en-GB', { weekday: form });
const dayAndMonth = (start: number) =>
  new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "Today", "Tomorrow", "Thursday" within the week, else "Thu"; and the date under it. */
export function calendarDayLabel(t: TFunction, day: CalendarDay): { name: string; date: string } {
  const date = dayAndMonth(day.start);
  if (day.offset === 0) return { name: t('calendar.today'), date };
  if (day.offset === 1) return { name: t('calendar.tomorrow'), date };
  if (day.offset === -1) return { name: t('calendar.yesterday'), date };
  if (day.offset > 1 && day.offset < 7) return { name: weekday(day.start, 'long'), date };
  return { name: weekday(day.start, 'short'), date };
}

/**
 * The line under the title: "S2 · E5 · Name", "S3 · E1–8 · 8 episodes", "Film release", or
 * "Out to watch at home" for a film dated by its home release.
 */
export function calendarEntryLine(t: TFunction, entry: CalendarEntry): string {
  if (entry.kind === 'movie') return entry.atHome ? t('calendar.atHome') : t('calendar.film');
  const parts: string[] = [];
  if (entry.season !== undefined) parts.push(t('calendar.season', { season: entry.season }));
  if (entry.episode !== undefined) {
    parts.push(
      entry.lastEpisode !== undefined
        ? t('calendar.episodes', { first: entry.episode, last: entry.lastEpisode })
        : t('calendar.episode', { episode: entry.episode }),
    );
  }
  if (entry.lastEpisode !== undefined && entry.episode !== undefined) {
    parts.push(t('calendar.count', { number: entry.lastEpisode - entry.episode + 1 }));
  } else if (entry.episodeTitle) {
    parts.push(entry.episodeTitle);
  }
  return parts.join(' · ');
}

/** A short tag for the entry, or '': an episode already seen, a premiere, or one out now. */
export function calendarEntryTag(t: TFunction, entry: CalendarEntry, day: CalendarDay): string {
  if (entry.kind === 'episode' && isWatched(entry.videoId)) return t('calendar.watched');
  if (entry.kind === 'episode' && entry.episode === 1) {
    return entry.season === 1 ? t('calendar.seriesPremiere') : t('calendar.seasonPremiere');
  }
  if (day.offset <= 0) return t('calendar.new');
  return '';
}

function isWatched(videoId: string): boolean {
  return watchedSet.has(videoId) || progress.get(videoId)?.watched === true;
}
