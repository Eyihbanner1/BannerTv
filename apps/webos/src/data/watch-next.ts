import {
  type ContinueItem,
  continueWatching,
  kidsTitleAllowed,
  type PlayedVideo,
  type ProgressEntry,
} from '@bannertv/core';
import i18next from 'i18next';
import { router, topRoute } from '../app/router';
import { playedVideos, progress } from './playback';
import { activeProfile, activeProfileId, isKidsProfile, profiles } from './profiles';

/**
 * One title for the system's own "Continue watching" row (Android TV's Watch
 * Next), from Home's Continue Watching. Ids, words and artwork addresses
 * only: nothing about addons or streams, since the row belongs to the device
 * and anyone at the TV sees it. Kept free of any platform so another shell
 * can publish the same list.
 */
export interface WatchNextCard {
  type: string;
  /** The title's id. The row holds one card per title, as Continue Watching does. */
  meta: string;
  /** What Resume plays: the video left part way, or the next episode. */
  video: string;
  /** The title's name, with the episode for a series ("Morevna Project S1:E2"). */
  title: string;
  /** The episode's own name, when the addon gave one. */
  episodeTitle?: string;
  season?: number;
  episode?: number;
  description?: string;
  /** The title's wide artwork (its backdrop), which the row shows first. */
  landscape?: string;
  /** The title's poster, for a title with no wide artwork. */
  poster?: string;
  /** Seconds in, where Resume starts; 0 when it starts from the beginning. */
  position: number;
  /** Seconds; 0 while unknown, as for a next episode not yet started. */
  duration: number;
  /**
   * Starts from the beginning: the episode after one finished, or one barely
   * begun (the row's "next" kind of card, rather than "continue").
   */
  next: boolean;
  /** When the title was last watched, in milliseconds since 1970: the row's order. */
  watchedAt: number;
}

/** What the cards need of saved progress. */
export interface WatchedReader {
  get(videoId: string): ProgressEntry | undefined;
  /** Every entry of one title, most recent first. */
  forMeta(metaId: string): ProgressEntry[];
}

/** The card title of an episode: the series' name and its number. */
export type EpisodeTitle = (name: string, season: number, episode: number) => string;

/** The episode's own name, from the card of the video that put the title on the row. */
function episodeName(item: ContinueItem, card: PlayedVideo | undefined): string | undefined {
  if (!card) return undefined;
  if (card.videoId === item.videoId) return card.episodeName;
  return card.next?.videoId === item.videoId ? card.next.name : undefined;
}

/**
 * The cards for Continue Watching's titles, in the row's order. A title's
 * time is that of its latest progress, which is what put it on the row.
 */
export function watchNextCards(
  items: readonly ContinueItem[],
  watched: WatchedReader,
  played: (videoId: string) => PlayedVideo | undefined,
  episodeTitle: EpisodeTitle,
): WatchNextCard[] {
  const cards: WatchNextCard[] = [];
  for (const item of items) {
    const { preview } = item;
    const latest = watched.forMeta(preview.id)[0];
    // A title is only on the row because of its progress, so this never happens.
    if (!latest) continue;
    const numbered = item.season !== undefined && item.episode !== undefined;
    const card: WatchNextCard = {
      type: preview.type,
      meta: preview.id,
      video: item.videoId,
      title: numbered ? episodeTitle(preview.name, item.season!, item.episode!) : preview.name,
      position: item.startAt,
      duration: watched.get(item.videoId)?.duration ?? 0,
      next: item.startAt <= 0,
      watchedAt: latest.updatedAt,
    };
    const name = episodeName(item, played(latest.videoId));
    if (name) card.episodeTitle = name;
    if (item.season !== undefined) card.season = item.season;
    if (item.episode !== undefined) card.episode = item.episode;
    if (preview.description) card.description = preview.description;
    if (preview.background) card.landscape = preview.background;
    if (preview.poster) card.poster = preview.poster;
    cards.push(card);
  }
  return cards;
}

/** How long Continue Watching stays the same before the row follows it. */
export const QUIET_MS = 10_000;
/** How soon the row follows once playback stops or the app leaves the screen. */
export const SOON_MS = 1000;

export interface WatchNextSchedule {
  /**
   * Continue Watching may have changed: the row follows once nothing has
   * changed for QUIET_MS. While a film plays its progress is saved every few
   * seconds, so nothing goes out until it stops.
   */
  changed(): void;
  /** Playback stopped or the app left the screen: the row follows within SOON_MS. */
  soon(): void;
  /** The row follows at once, as when a profile with a PIN comes into use. */
  now(): void;
  stop(): void;
}

/**
 * When to publish. `read` gives the cards as they are now, or null to leave
 * the row as it is; a list the same as the last one sent is not sent again.
 */
export function createWatchNextSchedule(options: {
  read(): readonly WatchNextCard[] | null;
  publish(cards: readonly WatchNextCard[]): void;
}): WatchNextSchedule {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A short wait already set, which a change must not put back to the long one.
  let urgent = false;
  let sent: string | undefined;

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    urgent = false;
  }

  function run(): void {
    cancel();
    const cards = options.read();
    if (cards === null) return;
    const text = JSON.stringify(cards);
    if (text === sent) return;
    sent = text;
    options.publish(cards);
  }

  function wait(ms: number, short: boolean): void {
    if (urgent) return;
    cancel();
    urgent = short;
    timer = setTimeout(run, ms);
  }

  return {
    changed: () => wait(QUIET_MS, false),
    soon: () => wait(SOON_MS, true),
    now: run,
    stop: cancel,
  };
}

/**
 * The profile in use's cards, as its Continue Watching row has them, or null
 * to leave the row as it is: while "Who's watching?" waits for an answer the
 * row keeps what the last profile left there, and until its progress has been
 * read nothing is known. A profile with a PIN keeps its history to itself,
 * and the system's home screen is anyone's to see, so it empties the row. A
 * kids profile's titles that say they are not for children are left out, as
 * on its row.
 */
function profileCards(loaded: boolean): readonly WatchNextCard[] | null {
  const profile = activeProfile();
  if (!profile) return null;
  if (profile.pin) return [];
  if (!loaded) return null;
  let items = continueWatching(progress, playedVideos.get, Date.now());
  if (isKidsProfile()) items = items.filter((item) => kidsTitleAllowed(item.preview, true));
  return watchNextCards(items, progress, playedVideos.get, (name, season, episode) =>
    i18next.t('watchNext.episodeTitle', { name, season, episode }),
  );
}

const HOUR_MS = 60 * 60 * 1000;

/** Runs `run` just after each hour, as Home's row looks again for next episodes that have aired. */
function everyHour(run: () => void): void {
  const next = () => {
    setTimeout(
      () => {
        run();
        next();
      },
      HOUR_MS - (Date.now() % HOUR_MS) + 1000,
    );
  };
  next();
}

/**
 * Keeps the system's "Continue watching" row in step with the profile in
 * use's Continue Watching, through `publish`. The row belongs to the whole
 * device, so it shows one profile's titles at a time; a switch reloads the
 * app, which then publishes the new profile's.
 */
export function startWatchNext(publish: (cards: readonly WatchNextCard[]) => void): void {
  let loaded = false;
  const schedule = createWatchNextSchedule({ read: () => profileCards(loaded), publish });
  // A PIN set on the profile in use, or a profile with one chosen, empties the row at once.
  const followProfile = () => (activeProfile()?.pin ? schedule.now() : schedule.changed());
  activeProfileId.subscribe(followProfile);
  profiles.subscribe(followProfile);
  progress.subscribe(schedule.changed);
  playedVideos.subscribe(schedule.changed);
  // Just after launch, Home fills in cards for titles that had none: the quiet wait lets them land.
  void Promise.all([progress.load(), playedVideos.load()])
    .catch(() => undefined)
    .then(() => {
      loaded = true;
      schedule.changed();
    });
  let playing = topRoute().name === 'player';
  router.subscribe(() => {
    const now = topRoute().name === 'player';
    if (playing && !now) schedule.soon();
    playing = now;
  });
  // Off screen, the person is likely looking at the system's home screen and its row.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) schedule.soon();
  });
  everyHour(schedule.changed);
  followProfile();
}
