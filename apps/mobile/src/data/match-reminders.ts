import { localClock, type Reminder, remindAt } from '@bannertv/core';
import { activeProfileId, isKidsProfile } from '@tv/data/profiles';
import { sportsFeed, sportsState } from '@tv/data/sports';
import { findReminderEvent, sportsReminders } from '@tv/data/sports-reminders';
import { welcomed } from '@tv/data/welcome';
import { useReminders } from '@tv/screens/sports/use-reminder';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import i18next from 'i18next';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { openEvent } from '../nav/routes';

/**
 * Match reminders as phone notifications (SP4): each reminder of the profile
 * in use is a local notification REMIND_BEFORE_MS before kick-off, and
 * tapping it opens the match, found again in the listing, or Sports when it
 * has gone. The web build has its own stand-in (match-reminders.web.ts).
 */

const CHANNEL = 'sports-reminders';
const PREFIX = 'sports-reminder:';
const KIND = 'sports-reminder';
/** How long a tap at launch waits for the addons to say whether Sports is shown. */
const READY_MS = 10 * 1000;

/** Whether this build can notify. */
export const canNotify = true;

/**
 * What a reminder's notification carries: the profile, and the match's key,
 * sides, name and kick-off. Never an addon's address, which a reminder
 * never holds.
 */
interface ReminderNote extends Reminder {
  kind: typeof KIND;
  profile: string;
}

function noteOf(reminder: Reminder, profile: string): ReminderNote {
  return { ...reminder, kind: KIND, profile };
}

function readNote(data: unknown): ReminderNote | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const raw = data as Record<string, unknown>;
  if (raw.kind !== KIND || typeof raw.profile !== 'string' || typeof raw.key !== 'string') {
    return undefined;
  }
  if (typeof raw.at !== 'number' || typeof raw.name !== 'string') return undefined;
  const note: ReminderNote = {
    kind: KIND,
    profile: raw.profile,
    key: raw.key,
    name: raw.name,
    at: raw.at,
  };
  if (typeof raw.matchKey === 'string') note.matchKey = raw.matchKey;
  return note;
}

// Shown while the app is open too: the person asked for it.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

/**
 * The channel reminders come on. Android 13 and newer ask for the permission
 * to notify when an app makes its first channel, so it is made only once the
 * person has tapped Remind me, never at launch.
 */
function makeChannel(): Promise<unknown> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return Notifications.setNotificationChannelAsync(CHANNEL, {
    name: i18next.t('phone.reminders.channel'),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Asks for the permission to notify, the first time Remind me is tapped.
 * Resolves whether reminders can notify; false once the person has said no,
 * which only the phone's settings can change.
 */
export async function allowReminders(): Promise<boolean> {
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

/** One notification per profile, reminder and time, so a kick-off that moved is a new one. */
const idOf = (reminder: Reminder, profile: string) =>
  `${PREFIX}${profile}:${reminder.key}@${remindAt(reminder)}`;

/**
 * Makes the phone's scheduled reminders the profile's own: those to come are
 * scheduled, and BannerTV's others (taken off, moved, or another profile's)
 * are cancelled. None for a kids profile, which has no Sports, or while the
 * phone may not notify.
 */
async function schedule(reminders: readonly Reminder[], profile: string): Promise<void> {
  const allowed = (await Notifications.getPermissionsAsync()).granted && !isKidsProfile();
  const now = Date.now();
  const wanted = new Map<string, Reminder>();
  if (allowed) {
    for (const reminder of reminders) {
      if (remindAt(reminder) > now) wanted.set(idOf(reminder, profile), reminder);
    }
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const have = new Set<string>();
  for (const request of scheduled) {
    if (request.identifier.indexOf(PREFIX) !== 0) continue;
    if (wanted.has(request.identifier)) have.add(request.identifier);
    else await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
  if (wanted.size === 0) return;
  await makeChannel();
  for (const [identifier, reminder] of wanted) {
    if (have.has(identifier)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: i18next.t('phone.reminders.title', { name: reminder.name }),
        body: i18next.t('phone.reminders.body', { time: localClock(reminder.at) }),
        data: { ...noteOf(reminder, profile) },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: remindAt(reminder),
        channelId: CHANNEL,
      },
    });
  }
}

/** Resolves whether Sports is shown, once the addons have been read, or false after READY_MS. */
function sportsShownSoon(): Promise<boolean> {
  if (sportsState.get().ready) return Promise.resolve(sportsState.get().shown);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, READY_MS);
    const unsubscribe = sportsState.subscribe(() => {
      if (!sportsState.get().ready) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(sportsState.get().shown);
    });
  });
}

/** Opens the match a tapped reminder is for, or Sports when the addons no longer list it. */
async function openNote(note: ReminderNote): Promise<void> {
  // Another profile's reminder, or a kids profile: the app just opens.
  if (note.profile !== activeProfileId.get() || isKidsProfile()) return;
  if (!(await sportsShownSoon())) return;
  const event = await findReminderEvent(note);
  if (event) openEvent(event);
  else router.navigate('/sports');
}

/**
 * Keeps the phone's notifications in step with the profile's reminders, and
 * opens the match when one is tapped, at launch included, once the welcome
 * and "Who's watching?" are done. Mounted once, under the tabs.
 */
export function useMatchReminders(): void {
  const profile = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const reminders = useReminders();
  const loaded = useSyncExternalStore(sportsReminders.subscribe, sportsReminders.loaded);
  const response = Notifications.useLastNotificationResponse();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const handled = useRef<string | undefined>(undefined);
  // Counts BannerTV's returns to the front, for one more pass each time. While notifications are
  // off in the phone's settings a pass cancels what was scheduled; turned back on while BannerTV
  // is in the background, nothing else would schedule the reminders again until they changed.
  const [returns, setReturns] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setReturns((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);

  // Kick-offs the addons have corrected since, and reminders too late to matter.
  useEffect(
    () =>
      sportsFeed.subscribe(() => {
        if (activeProfileId.get() !== null) {
          void sportsReminders.refresh(sportsFeed.get().events, Date.now());
        }
      }),
    [],
  );

  // One pass at a time, each with the reminders as they are when it starts. Not before they
  // have been read, when an empty list would cancel what was scheduled.
  useEffect(() => {
    if (profile === null || !loaded) return;
    queue.current = queue.current.then(() => schedule(reminders, profile)).catch(() => undefined);
  }, [reminders, profile, loaded, returns]);

  useEffect(() => {
    if (!response || profile === null || !welcomeDone) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const note = readNote(response.notification.request.content.data);
    const id = `${response.notification.request.identifier}|${response.notification.date}`;
    if (!note || handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse();
    void openNote(note);
  }, [response, profile, welcomeDone]);
}
