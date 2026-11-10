import type { LibraryItem, ProgressEntry } from '@bannertv/core';
import type { MetaDetail, Video } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALERT_DAYS,
  ALERT_PREFIX,
  airDay,
  alertBody,
  alertChanges,
  alertIdentifier,
  alertTime,
  alertTitle,
  DUE_GRACE_MS,
  type EpisodeAlert,
  episodeSeen,
  followedSeries,
  FRONT_PASS_EVERY_MS,
  frontPassDue,
  LATE_DELAY_MS,
  MAX_ALERTS,
  noteOf,
  planEpisodeAlerts,
  profileAlerts,
  readAlertNote,
  type ScheduledRequest,
} from './episode-alerts-plan';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Runs the tests of a block as a phone in `zone`, and puts the phone's own zone back after. */
function inZone(zone: string) {
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });
}

const iso = (at: number) => new Date(at).toISOString();
/** An episode dated by its day alone, as addons mostly send it: midnight UTC. */
const onDay = (day: string) => `${day}T00:00:00.000Z`;

function episode(id: string, season: number, number: number, released?: string): Video {
  const video: Video = { id: `${id}:${season}:${number}`, title: `Episode ${number}`, season };
  video.episode = number;
  if (released) video.released = released;
  return video;
}

function series(id: string, name: string, videos: Video[]): MetaDetail {
  return {
    id,
    type: 'series',
    name,
    posterShape: 'poster',
    genres: [],
    trailers: [],
    videos,
    cast: [],
    directors: [],
    writers: [],
    links: [],
    behaviorHints: { hasScheduledVideos: true },
  };
}

const never = () => false;
const none: ReadonlySet<string> = new Set();

function plan(
  shows: MetaDetail[],
  now: number,
  extra: Partial<Parameters<typeof planEpisodeAlerts>[0]> = {},
): EpisodeAlert[] {
  return planEpisodeAlerts({ shows, scheduled: [], sent: none, seen: never, now, ...extra });
}

describe('followedSeries', () => {
  const item = (id: string, type: 'series' | 'movie'): LibraryItem => ({
    id,
    type,
    name: id,
    addedAt: 1,
  });
  const entry = (metaId: string, type: 'series' | 'movie', extra: Partial<ProgressEntry> = {}) =>
    ({
      metaId,
      type,
      videoId: `${metaId}:1:1`,
      position: 100,
      duration: 1000,
      updatedAt: 1,
      watched: false,
      ...extra,
    }) as ProgressEntry;

  it('follows the series being watched, most recent first, then the series on My List', () => {
    const items = [item('tt-list', 'series'), item('tt-film', 'movie'), item('tt-b', 'series')];
    const entries = [entry('tt-b', 'series'), entry('tt-a', 'series'), entry('tt-film2', 'movie')];
    expect(followedSeries(items, entries)).toEqual(['tt-b', 'tt-a', 'tt-list']);
  });

  it('leaves out a series taken off Continue Watching, unless it is on My List', () => {
    const entries = [
      entry('tt-off', 'series', { continueRow: false }),
      entry('tt-off', 'series', { videoId: 'tt-off:1:0' }),
      entry('tt-kept', 'series', { continueRow: false }),
      entry('tt-on', 'series'),
    ];
    expect(followedSeries([item('tt-kept', 'series')], entries)).toEqual(['tt-on', 'tt-kept']);
  });

  it('follows a series again once it played after it was taken off the row', () => {
    const entries = [
      entry('tt-back', 'series', { videoId: 'tt-back:1:2' }),
      entry('tt-back', 'series', { continueRow: false }),
    ];
    expect(followedSeries([], entries)).toEqual(['tt-back']);
  });

  it('follows no more series than the calendar asks about', () => {
    const entries = Array.from({ length: 50 }, (_, index) => entry(`tt${index}`, 'series'));
    expect(followedSeries([], entries)).toHaveLength(40);
    expect(followedSeries([], entries, 3)).toEqual(['tt0', 'tt1', 'tt2']);
  });
});

describe('airDay and alertTime in London', () => {
  inZone('Europe/London');

  it('reads a date alone as that day, and alerts at 18:00 in winter and in summer', () => {
    const winter = Date.parse(onDay('2026-11-10'));
    expect(airDay(winter)).toEqual({ year: 2026, month: 10, day: 10 });
    expect(iso(alertTime(winter))).toBe('2026-11-10T18:00:00.000Z');
    // British Summer Time: 18:00 is 17:00 UTC.
    expect(iso(alertTime(Date.parse(onDay('2026-07-10'))))).toBe('2026-07-10T17:00:00.000Z');
  });

  it('alerts at 18:00 on the days the clocks change', () => {
    expect(iso(alertTime(Date.parse(onDay('2026-03-29'))))).toBe('2026-03-29T17:00:00.000Z');
    expect(iso(alertTime(Date.parse(onDay('2026-10-25'))))).toBe('2026-10-25T18:00:00.000Z');
  });

  it('takes a time of day as a moment: its own day here, and never before it is out', () => {
    // 02:00 UTC is 02:00 in London, on the 11th: alerted at 18:00 that day.
    const early = Date.parse('2026-11-11T02:00:00.000Z');
    expect(airDay(early)).toEqual({ year: 2026, month: 10, day: 11 });
    expect(iso(alertTime(early))).toBe('2026-11-11T18:00:00.000Z');
    // Out at 21:00: alerted then, not at 18:00.
    expect(iso(alertTime(Date.parse('2026-11-11T21:00:00.000Z')))).toBe('2026-11-11T21:00:00.000Z');
  });
});

describe('airDay and alertTime west and east of Greenwich', () => {
  describe('New York', () => {
    inZone('America/New_York');

    it('keeps a date alone on its day rather than the evening before', () => {
      // Midnight UTC is 19:00 the day before in New York.
      const released = Date.parse(onDay('2026-11-10'));
      expect(new Date(released).getDate()).toBe(9);
      expect(airDay(released)).toEqual({ year: 2026, month: 10, day: 10 });
      expect(iso(alertTime(released))).toBe('2026-11-10T23:00:00.000Z');
    });

    it('reads a time of day in New York', () => {
      // 02:00 UTC on the 11th is 21:00 on the 10th in New York.
      const released = Date.parse('2026-11-11T02:00:00.000Z');
      expect(airDay(released)).toEqual({ year: 2026, month: 10, day: 10 });
      expect(iso(alertTime(released))).toBe('2026-11-11T02:00:00.000Z');
    });
  });

  describe('Auckland', () => {
    inZone('Pacific/Auckland');

    it('alerts at 18:00 on the day, 13 hours ahead of UTC in November', () => {
      const released = Date.parse(onDay('2026-11-10'));
      expect(airDay(released)).toEqual({ year: 2026, month: 10, day: 10 });
      expect(iso(alertTime(released))).toBe('2026-11-10T05:00:00.000Z');
    });
  });
});

describe('planEpisodeAlerts', () => {
  inZone('Europe/London');

  // Monday 9 November 2026, 10:00 in London (GMT).
  const now = Date.parse('2026-11-09T10:00:00.000Z');

  it('alerts at 18:00 on the day for an episode to come, naming it', () => {
    const show = series('tt1', 'Severance', [
      episode('tt1', 2, 1, onDay('2026-11-12')),
      episode('tt1', 2, 2, onDay('2026-11-19')),
    ]);
    const alerts = plan([show], now);
    expect(alerts.map((alert) => [alert.key, iso(alert.at)])).toEqual([
      ['series:tt1@2026-11-12', '2026-11-12T18:00:00.000Z'],
      ['series:tt1@2026-11-19', '2026-11-19T18:00:00.000Z'],
    ]);
    expect(alerts[0]).toMatchObject({
      type: 'series',
      id: 'tt1',
      name: 'Severance',
      season: 2,
      episode: 1,
      count: 1,
      episodeTitle: 'Episode 1',
      videos: ['tt1:2:1'],
    });
  });

  it('alerts for an episode out today at 18:00, and for none that came out before today', () => {
    const show = series('tt1', 'Show', [
      episode('tt1', 1, 1, onDay('2026-11-02')),
      episode('tt1', 1, 2, onDay('2026-11-08')),
      episode('tt1', 1, 3, onDay('2026-11-09')),
    ]);
    expect(plan([show], now).map((alert) => [alert.videos, iso(alert.at)])).toEqual([
      [['tt1:1:3'], '2026-11-09T18:00:00.000Z'],
    ]);
  });

  it('alerts a few minutes later for an episode first heard of after 18:00 on its day', () => {
    const show = series('tt1', 'Show', [episode('tt1', 1, 3, onDay('2026-11-09'))]);
    const evening = Date.parse('2026-11-09T20:30:00.000Z');
    const [late] = plan([show], evening);
    expect(late!.at).toBe(evening + LATE_DELAY_MS);
    // A later pass keeps that time, rather than put it off again and again.
    const again = plan([show], evening + 2 * MINUTE, { scheduled: [late!] });
    expect(again.map((alert) => alert.at)).toEqual([evening + LATE_DELAY_MS]);
  });

  it('alerts for none heard of on its day too late in the evening', () => {
    const show = series('tt1', 'Show', [episode('tt1', 1, 3, onDay('2026-11-09'))]);
    expect(plan([show], Date.parse('2026-11-09T21:56:00.000Z'))).toEqual([]);
    expect(plan([show], Date.parse('2026-11-09T21:50:00.000Z'))).toHaveLength(1);
  });

  it('looks only over the next three weeks', () => {
    const show = series('tt1', 'Show', [
      episode('tt1', 1, 1, onDay('2026-11-30')),
      episode('tt1', 1, 2, onDay('2026-12-01')),
    ]);
    expect(ALERT_DAYS).toBe(21);
    expect(plan([show], now).map((alert) => alert.key)).toEqual(['series:tt1@2026-11-30']);
  });

  it('tells of a whole season out on one day in one alert', () => {
    const videos = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => episode('tt1', 3, n, onDay('2026-11-13')));
    const alerts = plan([series('tt1', 'Show', videos.reverse())], now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ season: 3, episode: 1, lastEpisode: 8, count: 8 });
    expect(alerts[0]!.episodeTitle).toBeUndefined();
    expect(alerts[0]!.videos).toHaveLength(8);
  });

  it('never alerts twice for an episode: listed twice, a series twice, or sent before', () => {
    const twice = episode('tt1', 1, 1, onDay('2026-11-12'));
    const show = series('tt1', 'Show', [twice, { ...twice }]);
    const alerts = plan([show, show], now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.videos).toEqual(['tt1:1:1']);
    expect(plan([show], now, { sent: new Set(['tt1:1:1']) })).toEqual([]);
  });

  it('gives no second alert when an episode moves to a later day after its alert came', () => {
    // Sent for the 9th; the addon now says the 16th.
    const moved = series('tt1', 'Show', [episode('tt1', 1, 1, onDay('2026-11-16'))]);
    expect(plan([moved], now, { sent: new Set(['tt1:1:1']) })).toEqual([]);
  });

  it('never alerts for an episode watched or started, nor for specials', () => {
    const show = series('tt1', 'Show', [
      episode('tt1', 1, 1, onDay('2026-11-12')),
      episode('tt1', 1, 2, onDay('2026-11-13')),
      episode('tt1', 0, 1, onDay('2026-11-14')),
    ]);
    const alerts = plan([show], now, { seen: (id) => id === 'tt1:1:1' });
    expect(alerts.map((alert) => alert.videos)).toEqual([['tt1:1:2']]);
  });

  it('leaves out an episode of a run that was watched, and so changes the alert', () => {
    const show = series('tt1', 'Show', [
      episode('tt1', 1, 1, onDay('2026-11-12')),
      episode('tt1', 1, 2, onDay('2026-11-12')),
    ]);
    const before = plan([show], now)[0]!;
    const after = plan([show], now, { seen: (id) => id === 'tt1:1:1' })[0]!;
    expect(after).toMatchObject({ episode: 2, count: 1, videos: ['tt1:1:2'] });
    expect(alertIdentifier(after, 'main')).not.toBe(alertIdentifier(before, 'main'));
  });

  it('schedules at most MAX_ALERTS, the earliest first', () => {
    const shows = Array.from({ length: 40 }, (_, index) =>
      series(`tt${index}`, `Show ${index}`, [
        episode(`tt${index}`, 1, 1, onDay(iso(now + ((index + 1) * DAY) / 2).slice(0, 10))),
      ]),
    );
    const alerts = plan(shows, now);
    expect(MAX_ALERTS).toBe(30);
    expect(alerts).toHaveLength(MAX_ALERTS);
    const times = alerts.map((alert) => alert.at);
    expect(times).toEqual(times.slice().sort((a, b) => a - b));
    expect(alerts.some((alert) => alert.id === 'tt39')).toBe(false);
  });

  it('keeps an alert just due, which Android may show late, and drops one long past', () => {
    const show = series('tt1', 'Show', [episode('tt1', 1, 3, onDay('2026-11-09'))]);
    const [due] = plan([show], now);
    const justAfter = due!.at + 2 * MINUTE;
    expect(plan([show], justAfter, { scheduled: [due!] })).toEqual([due]);
    // Once its time has come it counts as sent, so it is never put off for a few minutes more.
    const sent = new Set(due!.videos);
    expect(plan([show], justAfter, { scheduled: [due!], sent })).toEqual([due]);
    expect(plan([show], due!.at + DUE_GRACE_MS + MINUTE, { scheduled: [due!], sent })).toEqual([]);
    // Watched meanwhile: dropped.
    expect(plan([show], justAfter, { scheduled: [due!], seen: () => true })).toEqual([]);
  });

  it('keeps the alerts of a series that could not be read, and counts them in the limit', () => {
    const show = series('tt1', 'Show', [episode('tt1', 1, 1, onDay('2026-11-12'))]);
    const [kept] = plan([show], now);
    const others = Array.from({ length: 35 }, (_, index) =>
      series(`tt${index + 10}`, `Other ${index}`, [
        episode(`tt${index + 10}`, 1, 1, onDay('2026-11-11')),
      ]),
    );
    const alerts = plan(others, now, { scheduled: [kept!], unread: new Set(['tt1']) });
    expect(alerts).toHaveLength(MAX_ALERTS);
    expect(alerts[0]).toEqual(kept);
    // Read again, the series' alert is worked out afresh: here the same.
    expect(plan([show], now, { scheduled: [kept!] })).toEqual([kept]);
  });

  it('drops an alert to come whose episode is no longer listed', () => {
    const show = series('tt1', 'Show', [episode('tt1', 1, 1, onDay('2026-11-12'))]);
    const [old] = plan([show], now);
    expect(plan([series('tt1', 'Show', [])], now, { scheduled: [old!] })).toEqual([]);
  });
});

describe('planEpisodeAlerts in New York', () => {
  inZone('America/New_York');

  it('alerts on the day itself, not the evening before', () => {
    // Monday 9 November, 10:00 in New York.
    const now = Date.parse('2026-11-09T15:00:00.000Z');
    const show = series('tt1', 'Show', [episode('tt1', 1, 1, onDay('2026-11-10'))]);
    expect(plan([show], now).map((alert) => [alert.key, iso(alert.at)])).toEqual([
      ['series:tt1@2026-11-10', '2026-11-10T23:00:00.000Z'],
    ]);
  });
});

describe('alertIdentifier, alertChanges and profileAlerts', () => {
  inZone('Europe/London');
  const now = Date.parse('2026-11-09T10:00:00.000Z');
  const show = series('tt1', 'Show', [
    episode('tt1', 1, 1, onDay('2026-11-12')),
    episode('tt1', 1, 2, onDay('2026-11-19')),
  ]);
  const alerts = plan([show], now);
  const requestOf = (alert: EpisodeAlert, profile: string): ScheduledRequest => ({
    identifier: alertIdentifier(alert, profile),
    content: { data: noteOf(alert, profile) },
  });
  const reminder: ScheduledRequest = {
    identifier: 'sports-reminder:main:abc@1',
    content: { data: { kind: 'sports-reminder' } },
  };

  it("gives each profile's alert its own identifier", () => {
    const [first] = alerts;
    expect(alertIdentifier(first!, 'main')).not.toBe(alertIdentifier(first!, 'guest4'));
    expect(alertIdentifier(first!, 'main').indexOf(ALERT_PREFIX)).toBe(0);
  });

  it('schedules what is missing, keeps what is there, and leaves match reminders alone', () => {
    const changes = alertChanges([requestOf(alerts[0]!, 'main'), reminder], alerts, 'main');
    expect(changes.cancel).toEqual([]);
    expect(changes.keep).toEqual([alerts[0]]);
    expect(changes.add.map((add) => add.alert)).toEqual([alerts[1]]);
    expect(changes.add[0]!.identifier).toBe(alertIdentifier(alerts[1]!, 'main'));
  });

  it("cancels the profile before's alerts after a switch, and schedules the new one's", () => {
    const before = alerts.map((alert) => requestOf(alert, 'main'));
    // Guest follows the same series: its own alerts, under its own identifiers.
    const changes = alertChanges([...before, reminder], alerts, 'guest4');
    expect(changes.cancel).toEqual(before.map((request) => request.identifier));
    expect(changes.add.map((add) => add.identifier)).toEqual(
      alerts.map((alert) => alertIdentifier(alert, 'guest4')),
    );
    // Only the profile's own count as scheduled for its plan.
    expect(profileAlerts([...before, reminder], 'guest4')).toEqual([]);
    expect(profileAlerts([...before, reminder], 'main').map((alert) => alert.key)).toEqual(
      alerts.map((alert) => alert.key),
    );
  });

  it('cancels every alert when there is nothing to schedule: switched off, or a kids profile', () => {
    const before = alerts.map((alert) => requestOf(alert, 'main'));
    expect(alertChanges([...before, reminder], [], 'main')).toEqual({
      cancel: before.map((request) => request.identifier),
      add: [],
      keep: [],
    });
  });

  it('replaces an alert whose time changed', () => {
    const moved = { ...alerts[0]!, at: alerts[0]!.at + HOUR };
    const changes = alertChanges([requestOf(alerts[0]!, 'main')], [moved], 'main');
    expect(changes.cancel).toEqual([alertIdentifier(alerts[0]!, 'main')]);
    expect(changes.add.map((add) => add.alert)).toEqual([moved]);
  });
});

describe('readAlertNote', () => {
  const alert: EpisodeAlert = {
    key: 'series:tt1@2026-11-12',
    at: 1,
    type: 'series',
    id: 'tt1',
    name: 'Show',
    season: 1,
    episode: 2,
    count: 1,
    episodeTitle: 'Pilot',
    videos: ['tt1:1:2'],
  };

  it('reads back what an alert carries, its profile included', () => {
    expect(readAlertNote(JSON.parse(JSON.stringify(noteOf(alert, 'main'))))).toEqual({
      ...alert,
      kind: 'new-episode',
      profile: 'main',
    });
  });

  it("reads nothing else: a match reminder's data, or damaged data", () => {
    expect(readAlertNote({ kind: 'sports-reminder', profile: 'main', key: 'k', at: 1 })).toBe(
      undefined,
    );
    expect(readAlertNote({ ...noteOf(alert, 'main'), videos: [1] })).toBeUndefined();
    expect(readAlertNote({ ...noteOf(alert, 'main'), id: '' })).toBeUndefined();
    expect(readAlertNote(null)).toBeUndefined();
    expect(readAlertNote('new-episode')).toBeUndefined();
  });
});

describe('alertTitle and alertBody', () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    `${key} ${JSON.stringify(options ?? {})}`;
  const base: EpisodeAlert = {
    key: 'k',
    at: 1,
    type: 'series',
    id: 'tt1',
    name: 'Severance',
    count: 1,
    videos: ['v'],
  };

  it('names one episode by season and number, or the series alone when it has none', () => {
    expect(alertTitle(t, { ...base, season: 2, episode: 1 })).toBe(
      'phone.episodeAlerts.one {"show":"Severance","season":2,"episode":1}',
    );
    expect(alertTitle(t, base)).toBe('phone.episodeAlerts.oneUnnumbered {"show":"Severance"}');
  });

  it('names a run of one season, and counts episodes of several', () => {
    expect(alertTitle(t, { ...base, season: 3, episode: 1, lastEpisode: 8, count: 8 })).toBe(
      'phone.episodeAlerts.run {"show":"Severance","season":3,"first":1,"last":8}',
    );
    expect(alertTitle(t, { ...base, season: 1, episode: 9, count: 2 })).toBe(
      'phone.episodeAlerts.some {"show":"Severance","count":2}',
    );
  });

  it("gives the episode's name under it when there is one", () => {
    expect(alertBody(t, { ...base, episodeTitle: 'Hello, Ms. Cobel' })).toBe(
      'phone.episodeAlerts.bodyNamed {"title":"Hello, Ms. Cobel"}',
    );
    expect(alertBody(t, base)).toBe('phone.episodeAlerts.body {}');
  });
});

describe('frontPassDue', () => {
  it('looks again on coming back at most every few hours', () => {
    expect(frontPassDue(undefined, 1000)).toBe(true);
    expect(frontPassDue(1000, 1000 + FRONT_PASS_EVERY_MS - 1)).toBe(false);
    expect(frontPassDue(1000, 1000 + FRONT_PASS_EVERY_MS)).toBe(true);
    // The clock was set back.
    expect(frontPassDue(1000, 500)).toBe(true);
  });
});

describe('episodeSeen', () => {
  const own = (extra: Partial<ProgressEntry>) =>
    ({
      metaId: 'tt1',
      type: 'series',
      videoId: 'tt1:1:1',
      position: 0,
      duration: 0,
      updatedAt: 100,
      watched: false,
      ...extra,
    }) as ProgressEntry;

  it('counts an episode played, started or marked watched here, or ticked on Trakt', () => {
    expect(episodeSeen(own({ watched: true }), false)).toBe(true);
    expect(episodeSeen(own({ position: 300, duration: 2400 }), false)).toBe(true);
    expect(episodeSeen(undefined, true)).toBe(true);
    expect(episodeSeen(undefined, false)).toBe(false);
  });

  it('counts none marked not watched since, whatever Trakt ticked', () => {
    expect(episodeSeen(own({ unmarkedAt: 100 }), false)).toBe(false);
    expect(episodeSeen(own({ unmarkedAt: 100 }), true)).toBe(false);
    // Played again after it was marked not watched: seen once more.
    expect(episodeSeen(own({ unmarkedAt: 50, position: 300, duration: 2400 }), false)).toBe(true);
  });
});
