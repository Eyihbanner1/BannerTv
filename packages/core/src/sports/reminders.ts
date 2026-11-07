import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';
import type { SportEvent } from './types';

/**
 * "Remind me" on a match still to come (SP4): the phone notifies a few
 * minutes before kick-off, and the TV shows a banner then while BannerTV is
 * open. Reminders are the profile's, kept on the screen that set them, and
 * never synced: a reminder is for this phone or this TV.
 */

const KEY = 'sports.reminders';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** A reminder comes this long before kick-off: time to open the match and find a stream. */
export const REMIND_BEFORE_MS = 5 * MINUTE;
/**
 * A reminder the TV could not show at its time (the player was open) still
 * shows until this long after kick-off, and is then dropped.
 */
export const REMIND_LATE_MS = 30 * MINUTE;
/** The most a profile keeps on one screen; a phone schedules every one. */
export const MAX_REMINDERS = 50;
/** A kick-off that moved this far or less is still the match the reminder was set for. */
const SAME_MATCH_MS = 12 * HOUR;
const MAX_TEXT = 200;

export interface Reminder {
  /**
   * The match's key as the listing had it (SportEvent.key): the addon's
   * place in the collection and the item's id, never the addon's address.
   */
  key: string;
  /** Its two sides, either order (SportEvent.matchKey), to find it again if its key moved. */
  matchKey?: string;
  /** What the page called it: "Arsenal v Chelsea", "Formula 1: Mexican Grand Prix". */
  name: string;
  /** Kick-off, in milliseconds. */
  at: number;
}

/** When a reminder comes: REMIND_BEFORE_MS before kick-off. */
export function remindAt(reminder: Pick<Reminder, 'at'>): number {
  return reminder.at - REMIND_BEFORE_MS;
}

/**
 * Whether a match can have a reminder: one to watch live (not a replay),
 * with a kick-off time, whose reminder would still be to come.
 */
export function canRemind(event: SportEvent, now: number): boolean {
  const at = event.kickOff?.at;
  return event.kind === 'event' && at !== undefined && now < remindAt({ at });
}

/** The reminder for a match, under the name the page shows; undefined when it cannot have one. */
export function reminderFor(event: SportEvent, name: string): Reminder | undefined {
  const at = event.kickOff?.at;
  if (event.kind !== 'event' || at === undefined) return undefined;
  const reminder: Reminder = { key: event.key, name, at };
  if (event.matchKey !== undefined) reminder.matchKey = event.matchKey;
  return readReminder(reminder);
}

const near = (event: SportEvent, at: number) =>
  event.kickOff?.at !== undefined && Math.abs(event.kickOff.at - at) <= SAME_MATCH_MS;

/**
 * The match a reminder was set for, as the listing has it now: by its key,
 * or by its two sides near the same kick-off when the addons' order has
 * moved its key. Never by an addon's address, which a reminder never holds.
 */
export function findReminded(
  events: readonly SportEvent[],
  reminder: Pick<Reminder, 'key' | 'matchKey' | 'at'>,
): SportEvent | undefined {
  const live = (event: SportEvent) => event.kind === 'event' && near(event, reminder.at);
  const byKey = events.find((event) => event.key === reminder.key && live(event));
  if (byKey || reminder.matchKey === undefined) return byKey;
  return events.find((event) => event.matchKey === reminder.matchKey && live(event));
}

/** Whether a reminder's time has come and it is still worth showing at `now`. */
export function isDue(reminder: Pick<Reminder, 'at'>, now: number): boolean {
  return remindAt(reminder) <= now && now < reminder.at + REMIND_LATE_MS;
}

/** Reminders whose time has come and that are still worth showing, the soonest kick-off first. */
export function dueReminders(reminders: readonly Reminder[], now: number): Reminder[] {
  return reminders.filter((reminder) => isDue(reminder, now)).sort((a, b) => a.at - b.at);
}

/**
 * When the reminders next change what is due: the next one's time, or the
 * moment a due one becomes too late. Undefined when nothing will.
 */
export function nextReminderChange(
  reminders: readonly Reminder[],
  now: number,
): number | undefined {
  let next: number | undefined;
  for (const reminder of reminders) {
    for (const time of [remindAt(reminder), reminder.at + REMIND_LATE_MS]) {
      if (time > now && (next === undefined || time < next)) next = time;
    }
  }
  return next;
}

function cleanText(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return clean === '' ? undefined : clean;
}

function readReminder(value: unknown): Reminder | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const key = cleanText(raw.key);
  const name = cleanText(raw.name);
  if (key === undefined || name === undefined) return undefined;
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at) || raw.at <= 0) return undefined;
  const reminder: Reminder = { key, name, at: raw.at };
  const matchKey = cleanText(raw.matchKey);
  if (matchKey !== undefined) reminder.matchKey = matchKey;
  return reminder;
}

/** One per match, the soonest kick-off first, at most MAX_REMINDERS. */
function tidy(reminders: readonly Reminder[]): Reminder[] {
  const out: Reminder[] = [];
  for (const reminder of reminders.slice().sort((a, b) => a.at - b.at)) {
    if (out.some((kept) => kept.key === reminder.key)) continue;
    out.push(reminder);
    if (out.length === MAX_REMINDERS) break;
  }
  return out;
}

function readReminders(saved: unknown): readonly Reminder[] {
  if (!Array.isArray(saved)) return [];
  const reminders: Reminder[] = [];
  for (const value of saved) {
    const reminder = readReminder(value);
    if (reminder) reminders.push(reminder);
  }
  return tidy(reminders);
}

export interface Reminders {
  load(): Promise<void>;
  /** Whether the saved reminders have been read (or found missing or unreadable). */
  loaded(): boolean;
  /** Every reminder, the soonest kick-off first: the same array until they change. */
  list(): readonly Reminder[];
  has(key: string): boolean;
  /**
   * Sets a reminder, or sets it again with a new time or name. Resolves
   * false, changing nothing, when MAX_REMINDERS are set already.
   */
  add(reminder: Reminder): Promise<boolean>;
  remove(key: string): Promise<void>;
  /**
   * Moves reminders to the kick-offs the listing gives their matches now,
   * since addons correct their times, and to the keys it gives them, since
   * an addon listed above can move a match's key; drops those too late to
   * show.
   */
  refresh(events: readonly SportEvent[], now: number): Promise<void>;
  /** Told of every change, and once when the saved reminders have been read. */
  subscribe(listener: Listener): () => void;
}

/**
 * The reminders of one profile, saved under `sports.reminders` in
 * `storage`, which is already the profile's own (profileKv, ADR 0004).
 */
export function createReminders(options: { storage: KeyValueStore }): Reminders {
  const state = createPersisted<readonly Reminder[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readReminders,
    write: (reminders) => reminders.slice(),
  });
  return {
    load: state.load,
    loaded: state.loaded,
    list: () => state.get(),
    has: (key) => state.get().some((reminder) => reminder.key === key),
    async add(given) {
      const reminder = readReminder(given);
      if (!reminder) return false;
      let added = false;
      await state.update((current) => {
        const others = current.filter((kept) => kept.key !== reminder.key);
        if (others.length >= MAX_REMINDERS) return current;
        added = true;
        const was = current.find((kept) => kept.key === reminder.key);
        const same =
          was !== undefined &&
          was.at === reminder.at &&
          was.name === reminder.name &&
          was.matchKey === reminder.matchKey;
        return same ? current : tidy(others.concat(reminder));
      });
      return added;
    },
    remove: (key) =>
      state.update((current) =>
        current.some((reminder) => reminder.key === key)
          ? current.filter((reminder) => reminder.key !== key)
          : current,
      ),
    refresh: (events, now) =>
      state.update((current) => {
        let changed = false;
        const next: Reminder[] = [];
        for (const reminder of current) {
          const event = findReminded(events, reminder);
          const at = event?.kickOff?.at ?? reminder.at;
          if (now >= at + REMIND_LATE_MS) {
            changed = true;
            continue;
          }
          // Found by its sides under another key: the match page asks by the key it has now,
          // and would otherwise offer Remind me again for a match that has one.
          const key = event?.key ?? reminder.key;
          if (at === reminder.at && key === reminder.key) {
            next.push(reminder);
            continue;
          }
          changed = true;
          next.push({ ...reminder, key, at });
        }
        return changed ? tidy(next) : current;
      }),
    subscribe: state.subscribe,
  };
}
