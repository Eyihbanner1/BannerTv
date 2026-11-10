import {
  CALENDAR_MAX_TITLES,
  followedTitles,
  isUnmarked,
  type LibraryItem,
  type ProgressEntry,
} from '@bannertv/core';
import type { MetaDetail, Video } from '@bannertv/protocol';

/**
 * New-episode alerts: a local notification on the day an episode of a series the profile
 * follows comes out, "New episode: Severance S2:E1 is out". This works out which alerts the
 * phone should have scheduled; episode-alerts.ts asks the phone for them. Pure, so it is
 * unit-tested.
 *
 * A series is followed when the calendar follows it: the series in the profile's history
 * (what Continue Watching is made from, so a series waiting for its next episode counts too)
 * and the series on My List, at most CALENDAR_MAX_TITLES of them, the most the calendar asks
 * the addons about. So the alerts are the calendar's episodes, and there is no other list to
 * keep. A series taken off Continue Watching is left out unless it is on My List: the person
 * said they had stopped, and a notification asks more of them than a calendar row does.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Alerts come at this hour on the day, local time: the evening, when people sit down to watch. */
export const ALERT_HOUR = 18;
/**
 * An episode first heard of after ALERT_HOUR on its day gets its alert LATE_DELAY_MS later,
 * until this hour. After it the calendar is enough: no alert late at night.
 */
export const LATE_UNTIL_HOUR = 22;
export const LATE_DELAY_MS = 5 * MINUTE;
/** Only the next three weeks: later dates still move, and the app opens again before then. */
export const ALERT_DAYS = 21;
/**
 * The most alerts scheduled at once. Android lets an app have 500 alarms, and match reminders
 * may take up to 50 (MAX_REMINDERS). Each launch schedules the next ones.
 */
export const MAX_ALERTS = 30;
/** An alert due this long ago or less may still be on its way: Android can show one late. */
export const DUE_GRACE_MS = 30 * MINUTE;
/** Coming back to the front looks again at most this often: dates seldom change within hours. */
export const FRONT_PASS_EVERY_MS = 3 * HOUR;

/** What every alert's identifier starts with, so a pass touches BannerTV's alerts only. */
export const ALERT_PREFIX = 'new-episode:';
const KIND = 'new-episode';

/** One alert: one series on one day, however many of its episodes come out that day. */
export interface EpisodeAlert {
  /** The series and the day, as "series:tt0123@2026-11-10". */
  key: string;
  /** When it comes, in milliseconds. */
  at: number;
  /** The series' type, id and name, to name it and open its page. */
  type: string;
  id: string;
  name: string;
  season?: number;
  episode?: number;
  /** Set when several episodes of one season come out that day: the last of them. */
  lastEpisode?: number;
  /** How many episodes it tells of. */
  count: number;
  /** The episode's own name, when it tells of one. */
  episodeTitle?: string;
  /** The video ids of the episodes it tells of. */
  videos: string[];
}

/**
 * The series to alert for, best first, as the calendar follows them (see the top of this file)
 * less those taken off Continue Watching that are not on My List.
 */
export function followedSeries(
  items: readonly LibraryItem[],
  entries: readonly ProgressEntry[],
  limit: number = CALENDAR_MAX_TITLES,
): string[] {
  // Most recent first, so a title's first entry says whether it was taken off the row.
  const met = new Set<string>();
  const leftRow = new Set<string>();
  for (const entry of entries) {
    if (met.has(entry.metaId)) continue;
    met.add(entry.metaId);
    if (entry.continueRow === false) leftRow.add(entry.metaId);
  }
  const watching = entries.filter((entry) => !leftRow.has(entry.metaId));
  return followedTitles(items, watching, limit)
    .filter((title) => title.type === 'series')
    .map((title) => title.id);
}

/**
 * Whether the profile has watched or started an episode, which then gets no alert: played or
 * marked watched here (`own`, its saved progress), or ticked on Trakt (`ticked`). One marked not
 * watched since counts as neither, as on Details (the TV's isWatched in data/marks.ts), so
 * Mark as unwatched never costs the episode its alert.
 */
export function episodeSeen(own: ProgressEntry | undefined, ticked: boolean): boolean {
  if (own !== undefined) return !isUnmarked(own);
  return ticked;
}

/** A calendar day; the month counts from 0, as Date's does. */
export interface AirDay {
  year: number;
  month: number;
  day: number;
}

/**
 * The day an episode comes out. Addons mostly date an episode by its day alone, written as
 * midnight UTC ("2026-11-10T00:00:00.000Z"): that is its day wherever the phone is, where read
 * as a moment it would be the evening before anywhere west of Greenwich. A date with a time of
 * day is a moment, and its day is the phone's.
 */
export function airDay(released: number): AirDay {
  const date = new Date(released);
  if (released % DAY === 0) {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  }
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

const at = (day: AirDay, hour = 0) => new Date(day.year, day.month, day.day, hour).getTime();
const pad = (value: number) => (value < 10 ? `0${value}` : String(value));
const dayKey = (day: AirDay) => `${day.year}-${pad(day.month + 1)}-${pad(day.day)}`;

/**
 * When an episode's alert comes: ALERT_HOUR on its day, or the moment it comes out when the
 * addon gives a time later than that, so an alert never says an episode is out before it is.
 */
export function alertTime(released: number): number {
  const evening = at(airDay(released), ALERT_HOUR);
  return released % DAY === 0 ? evening : Math.max(evening, released);
}

function timeOf(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const value = Date.parse(text);
  return Number.isFinite(value) ? value : undefined;
}

export interface AlertPlanInput {
  /** The followed series' meta, as the addons last sent it. */
  shows: readonly MetaDetail[];
  /** Followed series whose meta could not be read (offline): their alerts stay as they are. */
  unread?: ReadonlySet<string>;
  /** The profile's alerts the phone has scheduled now. */
  scheduled: readonly EpisodeAlert[];
  /** Episodes this phone has already alerted for, for whichever profile. */
  sent: ReadonlySet<string>;
  /** Whether the profile has watched or started the episode. */
  seen: (videoId: string) => boolean;
  now: number;
  /** MAX_ALERTS unless a test says otherwise. */
  max?: number;
}

interface Group {
  key: string;
  show: MetaDetail;
  released: number;
  videos: Video[];
}

const byEpisode = (a: Video, b: Video) =>
  (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0);

function alertOf(group: Group, when: number): EpisodeAlert {
  const videos = group.videos.slice().sort(byEpisode);
  const first = videos[0]!;
  const alert: EpisodeAlert = {
    key: group.key,
    at: when,
    type: group.show.type,
    id: group.show.id,
    name: group.show.name,
    count: videos.length,
    videos: videos.map((video) => video.id),
  };
  if (first.season !== undefined) alert.season = first.season;
  if (first.episode !== undefined) alert.episode = first.episode;
  if (videos.length === 1) {
    if (first.title) alert.episodeTitle = first.title;
    return alert;
  }
  // A whole season at once is one run, "S3:E1–8", as the calendar shows it.
  const oneSeason = videos.every(
    (video) => video.season === first.season && video.episode !== undefined,
  );
  const lastEpisode = Math.max(...videos.map((video) => video.episode ?? 0));
  if (oneSeason && first.episode !== undefined && lastEpisode > first.episode) {
    alert.lastEpisode = lastEpisode;
  }
  return alert;
}

/**
 * The alerts the profile should have scheduled: one per followed series per day an episode
 * comes out, today and over the next ALERT_DAYS, earliest first, at most `max`. Never for an
 * episode watched or started, nor one this phone has alerted for already; an episode whose day
 * had passed when the app heard of it has none. An episode heard of on its day after its time
 * gets one LATE_DELAY_MS later, until LATE_UNTIL_HOUR, and keeps that time on later passes.
 * Alerts due up to DUE_GRACE_MS ago stay as they are (Android may show one a few minutes late),
 * as do those of series that could not be read now.
 */
export function planEpisodeAlerts(input: AlertPlanInput): EpisodeAlert[] {
  const { now, seen, max = MAX_ALERTS } = input;
  const unread = input.unread ?? new Set<string>();
  const told = new Set(input.sent);
  const kept: EpisodeAlert[] = [];
  const keptKeys = new Set<string>();
  for (const alert of input.scheduled) {
    // Due a moment ago, it may still be on its way; long past due, it never will be (the phone
    // was off, or the app was stopped). One to come is worked out again below, unless its series
    // could not be read.
    if (alert.at <= now ? now - alert.at > DUE_GRACE_MS : !unread.has(alert.id)) continue;
    if (alert.videos.every(seen) || keptKeys.has(alert.key)) continue;
    kept.push(alert);
    keptKeys.add(alert.key);
    alert.videos.forEach((video) => told.add(video));
  }

  const today = new Date(now);
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ALERT_DAYS);
  const groups = new Map<string, Group>();
  const shows = new Set<string>();
  for (const show of input.shows) {
    if (show.type !== 'series' || shows.has(show.id) || unread.has(show.id)) continue;
    shows.add(show.id);
    const videos = new Set<string>();
    for (const video of show.videos) {
      // Specials (season 0) are left out, as on the calendar.
      if (video.season === 0 || videos.has(video.id)) continue;
      videos.add(video.id);
      if (told.has(video.id) || seen(video.id)) continue;
      const released = timeOf(video.released);
      if (released === undefined) continue;
      const day = airDay(released);
      const start = at(day);
      if (start < first || start > last.getTime()) continue;
      const key = `${show.type}:${show.id}@${dayKey(day)}`;
      if (keptKeys.has(key)) continue;
      const group = groups.get(key);
      if (group) {
        group.released = Math.min(group.released, released);
        group.videos.push(video);
      } else groups.set(key, { key, show, released, videos: [video] });
    }
  }

  const scheduledAt = new Map(input.scheduled.map((alert) => [alert.key, alert.at]));
  const fresh: EpisodeAlert[] = [];
  for (const group of groups.values()) {
    let when = alertTime(group.released);
    if (when <= now) {
      // Heard of after its time on the day: a few minutes from now, and the same time after.
      const before = scheduledAt.get(group.key);
      if (before !== undefined && before > now) when = before;
      else {
        when = now + LATE_DELAY_MS;
        if (when > at(airDay(group.released), LATE_UNTIL_HOUR)) continue;
      }
    }
    fresh.push(alertOf(group, when));
  }
  // The earliest go first when there are more than `max`; the rest wait for a later pass.
  fresh.sort(
    (a, b) =>
      a.at - b.at ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
      a.key.localeCompare(b.key),
  );
  return kept.concat(fresh.slice(0, Math.max(0, max - kept.length)));
}

/**
 * The alert's identifier on the phone: the profile's, and new whenever its time or episodes
 * change, so a pass replaces a changed alert rather than leave the old one.
 */
export function alertIdentifier(alert: EpisodeAlert, profile: string): string {
  return `${ALERT_PREFIX}${profile}:${alert.key}:${alert.videos.join(',')}@${alert.at}`;
}

/** What an alert's notification carries: the alert and the profile it is for. */
export interface AlertNote extends EpisodeAlert {
  kind: typeof KIND;
  profile: string;
}

export function noteOf(alert: EpisodeAlert, profile: string): AlertNote {
  return { ...alert, kind: KIND, profile };
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A notification's data read back as an alert, or undefined when it is not one of these. */
export function readAlertNote(data: unknown): AlertNote | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const raw = data as Record<string, unknown>;
  if (raw.kind !== KIND || typeof raw.profile !== 'string' || typeof raw.key !== 'string') {
    return undefined;
  }
  if (typeof raw.type !== 'string' || typeof raw.id !== 'string' || raw.id === '') {
    return undefined;
  }
  if (typeof raw.name !== 'string' || !isNumber(raw.at) || !isNumber(raw.count)) return undefined;
  if (!Array.isArray(raw.videos) || !raw.videos.every((video) => typeof video === 'string')) {
    return undefined;
  }
  const note: AlertNote = {
    kind: KIND,
    profile: raw.profile,
    key: raw.key,
    at: raw.at,
    type: raw.type,
    id: raw.id,
    name: raw.name,
    count: raw.count,
    videos: raw.videos.slice(),
  };
  if (isNumber(raw.season)) note.season = raw.season;
  if (isNumber(raw.episode)) note.episode = raw.episode;
  if (isNumber(raw.lastEpisode)) note.lastEpisode = raw.lastEpisode;
  if (typeof raw.episodeTitle === 'string') note.episodeTitle = raw.episodeTitle;
  return note;
}

/** A notification the phone has scheduled, as expo-notifications lists it. */
export interface ScheduledRequest {
  identifier: string;
  content: { data?: unknown };
}

/** The profile's own alerts among the phone's scheduled notifications. */
export function profileAlerts(
  requests: readonly ScheduledRequest[],
  profile: string,
): EpisodeAlert[] {
  const alerts: EpisodeAlert[] = [];
  for (const request of requests) {
    if (request.identifier.indexOf(ALERT_PREFIX) !== 0) continue;
    const note = readAlertNote(request.content.data);
    if (note && note.profile === profile) alerts.push(note);
  }
  return alerts;
}

export interface AlertChanges {
  /** BannerTV's alerts to cancel: changed, no longer wanted, or another profile's. */
  cancel: string[];
  /** The plan's alerts the phone has not scheduled yet. */
  add: Array<{ identifier: string; alert: EpisodeAlert }>;
  /** The plan's alerts the phone has already. */
  keep: EpisodeAlert[];
}

/**
 * What a pass changes to make the phone's scheduled alerts `plan`, for `profile`. Alerts belong
 * to the profile in use when they were scheduled, so after a switch every alert of the profile
 * before is cancelled. Other notifications (match reminders) are left alone.
 */
export function alertChanges(
  requests: readonly ScheduledRequest[],
  plan: readonly EpisodeAlert[],
  profile: string,
): AlertChanges {
  const wanted = new Map<string, EpisodeAlert>();
  for (const alert of plan) wanted.set(alertIdentifier(alert, profile), alert);
  const have = new Set<string>();
  const cancel: string[] = [];
  for (const request of requests) {
    if (request.identifier.indexOf(ALERT_PREFIX) !== 0) continue;
    if (wanted.has(request.identifier)) have.add(request.identifier);
    else cancel.push(request.identifier);
  }
  const changes: AlertChanges = { cancel, add: [], keep: [] };
  for (const [identifier, alert] of wanted) {
    if (have.has(identifier)) changes.keep.push(alert);
    else changes.add.push({ identifier, alert });
  }
  return changes;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "New episode: Severance S2:E1 is out", or "New episodes: Severance S2:E1–8 are out". */
export function alertTitle(t: Translate, alert: EpisodeAlert): string {
  const { name: show, season, episode, lastEpisode, count } = alert;
  const numbered = season !== undefined && episode !== undefined;
  if (count === 1) {
    return numbered
      ? t('phone.episodeAlerts.one', { show, season, episode })
      : t('phone.episodeAlerts.oneUnnumbered', { show });
  }
  if (numbered && lastEpisode !== undefined) {
    return t('phone.episodeAlerts.run', { show, season, first: episode, last: lastEpisode });
  }
  return t('phone.episodeAlerts.some', { show, count });
}

/** The line under it: the episode's name when it has one. */
export function alertBody(t: Translate, alert: EpisodeAlert): string {
  return alert.episodeTitle
    ? t('phone.episodeAlerts.bodyNamed', { title: alert.episodeTitle })
    : t('phone.episodeAlerts.body');
}

/** Whether coming back to the front should look again: never twice within FRONT_PASS_EVERY_MS. */
export function frontPassDue(lastPass: number | undefined, now: number): boolean {
  // A clock set back looks again rather than wait for it to catch up.
  return lastPass === undefined || now < lastPass || now - lastPass >= FRONT_PASS_EVERY_MS;
}
