import {
  createReminders,
  findReminded,
  localDate,
  type Reminder,
  SOON_MS,
  type SportEvent,
  type SportsDay,
} from '@bannertv/core';
import { SPORTS_IN_BUILD } from '../app/features';
import { sportsFeed, wantSports } from './sports';
import { profileKv } from './storage';

/** How long opening a reminded match waits for the sports addons to list it. */
const LOOKUP_MS = 10 * 1000;

/**
 * The profile in use's match reminders (SP4), kept on this screen with its
 * other stores and never synced: the phone notifies, the TV shows a banner.
 */
export const sportsReminders = createReminders({ storage: profileKv });

/**
 * The match a reminder is for, as the sports addons list it now. When the
 * listing does not have it yet (Sports has not been opened since launch, or
 * the phone was started by the notification), the day it belongs to is asked
 * for, and the answer waited for until it lists the match, has nothing more
 * to give, or LOOKUP_MS pass. Undefined when it is not listed any more.
 */
export function findReminderEvent(reminder: Reminder): Promise<SportEvent | undefined> {
  const listed = findReminded(sportsFeed.get().events, reminder);
  if (listed || !SPORTS_IN_BUILD) return Promise.resolve(listed);
  // A reminder comes just before kick-off, when the match is on Live now.
  const day: SportsDay = Date.now() >= reminder.at - SOON_MS ? 'live' : localDate(reminder.at);
  return new Promise((resolve) => {
    const release = wantSports(day);
    let asked = false;
    let done = false;
    const finish = (event: SportEvent | undefined) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      unsubscribe();
      release();
      resolve(event);
    };
    const check = () => {
      const state = sportsFeed.get();
      const event = findReminded(state.events, reminder);
      if (event) finish(event);
      else if (state.loading) asked = true;
      else if (asked) finish(undefined);
    };
    const timer = window.setTimeout(() => finish(undefined), LOOKUP_MS);
    const unsubscribe = sportsFeed.subscribe(check);
    check();
  });
}
