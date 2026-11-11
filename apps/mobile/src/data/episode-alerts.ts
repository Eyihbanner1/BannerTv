import type { Query, QueryState } from '@bannertv/core';
import type { MetaDetail } from '@bannertv/protocol';
import { addonClient, addonCollection } from '@tv/data/addons';
import { library, watchedSet } from '@tv/data/library';
import { playedVideos, progress } from '@tv/data/playback';
import { activeProfileId, isKidsProfile } from '@tv/data/profiles';
import { welcomed } from '@tv/data/welcome';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import i18next from 'i18next';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { localStorage } from '../runtime/web-globals';
import { episodeAlertsOn } from './episode-alerts-on';
import {
  alertBody,
  alertChanges,
  alertTitle,
  type EpisodeAlert,
  episodeSeen,
  followedSeries,
  frontPassDue,
  noteOf,
  planEpisodeAlerts,
  profileAlerts,
  readAlertNote,
} from './episode-alerts-plan';
import { ALERTS_SENT_KEY, readSent, recordSent, sentVideos } from './episode-alerts-store';

/**
 * New-episode alerts as phone notifications: what episode-alerts-plan.ts works out, scheduled
 * as local notifications the way match reminders are (match-reminders.ts), and tapping one opens
 * the series' page. Nothing is pushed: the phone looks at the addons' dates itself, at launch,
 * on coming back to the front (at most every FRONT_PASS_EVERY_MS), when My List changes, and
 * when an episode with an alert to come is watched. The handler match-reminders.ts sets shows
 * these as well. The web build has its own stand-in (episode-alerts.web.ts).
 */

export { episodeAlertsOn };

const CHANNEL = 'new-episodes';
/** The first look at launch waits this long, so Home's own requests go first. */
const LAUNCH_PAUSE_MS = 10 * 1000;
/** A change to My List or to what was watched waits this long for the next, as a sync brings many. */
const CHANGE_PAUSE_MS = 2 * 1000;
/** How long a look waits for the addons to be read, and then for each series' meta. */
const READY_MS = 30 * 1000;

/**
 * The channel alerts come on, apart from match reminders' so either can be turned off in the
 * phone's settings. Android 13 and newer ask for the permission to notify when an app makes its
 * first channel, so it is made only once the person has switched alerts on.
 */
function makeChannel(): Promise<unknown> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return Notifications.setNotificationChannelAsync(CHANNEL, {
    name: i18next.t('phone.episodeAlerts.channel'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Asks for the permission to notify as the person switches alerts on, never before, as Remind me
 * does. Resolves whether alerts can notify; false once the person has said no, which only the
 * phone's settings can change.
 */
export async function allowEpisodeAlerts(): Promise<boolean> {
  try {
    const now = await Notifications.getPermissionsAsync();
    if (now.granted) {
      await makeChannel();
      return true;
    }
    if (!now.canAskAgain) return false;
    await makeChannel();
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Whether the phone lets BannerTV notify now, for Settings to say when it does not. */
export async function episodeAlertsPermitted(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

const translate = (key: string, options?: Record<string, unknown>) => i18next.t(key, options);

function seen(videoId: string): boolean {
  return episodeSeen(progress.get(videoId), watchedSet.has(videoId));
}

/** Resolves once the query has an answer, or as it stands after READY_MS. */
function answered<T>(query: Query<T>): Promise<QueryState<T>> {
  const done = () => {
    const { status } = query.get();
    return status === 'success' || status === 'error';
  };
  query.load();
  if (done()) return Promise.resolve(query.get());
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve(query.get());
    };
    const timer = setTimeout(finish, READY_MS);
    const unsubscribe = query.subscribe(() => {
      if (done()) finish();
    });
  });
}

/** Resolves whether the addons have been read, or false after READY_MS. */
function addonsReady(): Promise<boolean> {
  if (addonCollection.get().ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, READY_MS);
    const unsubscribe = addonCollection.subscribe(() => {
      if (!addonCollection.get().ready) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/** The followed series' meta from their addons (cached, as the calendar's), and those unread. */
async function readShows(
  ids: readonly string[],
): Promise<{ shows: MetaDetail[]; unread: Set<string> }> {
  const unread = new Set<string>(ids);
  if (!(await addonsReady())) return { shows: [], unread };
  const states = await Promise.all(ids.map((id) => answered(addonClient.meta('series', id))));
  const shows: MetaDetail[] = [];
  states.forEach((state, index) => {
    if (!state.data) return;
    shows.push(state.data);
    unread.delete(ids[index]!);
  });
  return { shows, unread };
}

/** What the last look found, for deciding when to look again. */
const last = {
  at: undefined as number | undefined,
  allowed: false,
  following: '',
  videos: [] as string[],
};

function readSentNow() {
  try {
    return readSent(localStorage.getItem(ALERTS_SENT_KEY));
  } catch {
    return [];
  }
}

/**
 * Makes the phone's scheduled alerts the profile's own: those it should have are scheduled, and
 * BannerTV's others (changed, no longer wanted, or another profile's) are cancelled. None for a
 * kids profile, with the switch off, or while the phone may not notify.
 */
async function pass(profile: string): Promise<void> {
  if (activeProfileId.get() !== profile) return;
  last.at = Date.now();
  const on = !isKidsProfile() && episodeAlertsOn.get();
  const allowed = on && (await episodeAlertsPermitted());
  last.allowed = allowed;
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  let plan: EpisodeAlert[] = [];
  if (allowed) {
    await Promise.all([library.load(), progress.load(), playedVideos.load(), watchedSet.load()]);
    const followed = followedSeries(library.items(), progress.recent());
    last.following = followed.join('|');
    const { shows, unread } = await readShows(followed);
    const now = Date.now();
    plan = planEpisodeAlerts({
      shows,
      unread,
      scheduled: profileAlerts(requests, profile),
      sent: sentVideos(readSentNow(), now),
      seen,
      now,
    });
  }
  const changes = alertChanges(requests, plan, profile);
  for (const identifier of changes.cancel) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }
  const done = changes.keep.slice();
  if (changes.add.length > 0) await makeChannel();
  for (const { identifier, alert } of changes.add) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: alertTitle(translate, alert),
          body: alertBody(translate, alert),
          data: { ...noteOf(alert, profile) },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: alert.at,
          channelId: CHANNEL,
        },
      });
      done.push(alert);
    } catch {
      // Not scheduled, so not remembered: the next pass tries again.
    }
  }
  // Those not seen yet: one of a run seen already would bring a pass on every save of the video.
  last.videos = done.flatMap((alert) => alert.videos).filter((video) => !seen(video));
  try {
    localStorage.setItem(
      ALERTS_SENT_KEY,
      JSON.stringify(recordSent(readSentNow(), done, Date.now())),
    );
  } catch {
    // Then an alert may come again for an episode on a later pass, the same day only.
  }
}

let queue: Promise<void> = Promise.resolve();
let launched = false;

/**
 * Looks again whenever it should while `profile` is in use: soon after launch (or at once when
 * the switch changed later), on coming back to the front at most every FRONT_PASS_EVERY_MS (or
 * when the phone's permission changed meanwhile), when the series followed change with My List,
 * and when an episode with an alert to come is watched or started. One pass at a time. Returns
 * the stop.
 */
function follow(profile: string): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    if (stopped) return;
    queue = queue.then(() => pass(profile)).catch(() => undefined);
  };
  const soon = (ms: number) => {
    if (timer === undefined && !stopped) timer = setTimeout(run, ms);
  };
  soon(launched ? 0 : LAUNCH_PAUSE_MS);
  launched = true;

  const app = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    if (frontPassDue(last.at, Date.now())) soon(0);
    else if (episodeAlertsOn.get()) {
      // Notifications turned back on in the phone's settings while BannerTV was away.
      void episodeAlertsPermitted().then((allowed) => {
        if (allowed !== last.allowed) soon(0);
      });
    }
  });
  const lists = library.subscribe(() => {
    if (!last.allowed) return;
    if (followedSeries(library.items(), progress.recent()).join('|') !== last.following) {
      soon(CHANGE_PAUSE_MS);
    }
  });
  // Saved every few seconds while a video plays: only an episode with an alert to come counts.
  const watching = () => {
    if (last.videos.some(seen)) soon(CHANGE_PAUSE_MS);
  };
  const stops = [progress.subscribe(watching), watchedSet.subscribe(watching)];

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    app.remove();
    lists();
    stops.forEach((stop) => stop());
  };
}

/**
 * Keeps the phone's alerts in step with the profile and its series, and opens the series when
 * one is tapped, at launch included, once the welcome and "Who's watching?" are done. Mounted
 * once, under the tabs.
 */
export function useEpisodeAlerts(): void {
  const profile = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const on = useSyncExternalStore(episodeAlertsOn.subscribe, episodeAlertsOn.get);
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | undefined>(undefined);

  // A pass for each profile chosen: a switch starts the app again, and its first pass cancels
  // the alerts of the profile before. The switch turned on or off looks again at once.
  useEffect(() => (profile === null ? undefined : follow(profile)), [profile, on]);

  useEffect(() => {
    if (!response || profile === null || !welcomeDone) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const note = readAlertNote(response.notification.request.content.data);
    const id = `${response.notification.request.identifier}|${response.notification.date}`;
    if (!note || handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse();
    // Another profile's alert, or a kids profile: the app just opens.
    if (note.profile !== profile || isKidsProfile()) return;
    router.push({ pathname: '/title', params: { type: note.type, id: note.id } });
  }, [response, profile, welcomeDone]);
}
