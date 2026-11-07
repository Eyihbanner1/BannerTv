import { canRemind, type Reminder, reminderFor, type SportEvent } from '@bannertv/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isKidsProfile } from '../../data/profiles';
import { sportsReminders } from '../../data/sports-reminders';

/** Remind me on a match page, as the TV and the phone both offer it (SP4). */
export interface ReminderControl {
  /** Whether to offer it: a reminder is on, or one set now would still come. */
  offered: boolean;
  /** The reminder set for this match, if any. */
  reminder?: Reminder;
  /** The last try was refused: MAX_REMINDERS are set already. */
  full: boolean;
  /** Sets the reminder, or takes it off. */
  toggle(): void;
}

/** The reminders, read again when they change; read from storage the first time. */
export function useReminders(): readonly Reminder[] {
  useEffect(() => {
    void sportsReminders.load();
  }, []);
  return useSyncExternalStore(sportsReminders.subscribe, sportsReminders.list);
}

/**
 * Remind me for one match. `name` is what the page calls it, kept for when
 * the match is no longer listed. `allow` runs before a reminder is set, for
 * the phone to ask for its notification permission at the first tap only;
 * it resolves false to set nothing. Never for a kids profile, which has no
 * Sports.
 */
export function useReminder(
  event: SportEvent,
  name: string,
  now: number,
  allow?: () => Promise<boolean>,
): ReminderControl {
  const reminders = useReminders();
  const [full, setFull] = useState(false);
  const reminder = reminders.find((each) => each.key === event.key);
  const offered = !isKidsProfile() && (reminder !== undefined || canRemind(event, now));
  const toggle = () => {
    if (reminder) {
      setFull(false);
      void sportsReminders.remove(reminder.key);
      return;
    }
    const wanted = reminderFor(event, name);
    if (!wanted) return;
    void (allow ? allow() : Promise.resolve(true)).then(async (allowed) => {
      if (!allowed) return;
      setFull(!(await sportsReminders.add(wanted)));
    });
  };
  return { offered, ...(reminder ? { reminder } : {}), full, toggle };
}
