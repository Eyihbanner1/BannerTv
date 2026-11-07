import { type MetaPreview, parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { createMatcher } from './dictionary';
import { buildEvents } from './events';
import mini from './fixtures/mini-data.json';
import { type CatalogContext, type Listing, readListing } from './listing';
import {
  canRemind,
  createReminders,
  dueReminders,
  findReminded,
  isDue,
  MAX_REMINDERS,
  nextReminderChange,
  type Reminder,
  REMIND_BEFORE_MS,
  REMIND_LATE_MS,
  reminderFor,
  remindAt,
} from './reminders';
import type { SportsData } from './types';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-10-28T19:00:00Z');
const matcher = createMatcher(mini as unknown as SportsData);

function context(addonIndex: number): CatalogContext {
  return {
    addonIndex,
    addonId: `test.sports.${addonIndex}`,
    transportUrl: `https://sports${addonIndex}.example/manifest.json`,
    catalogId: 'all',
    replays: false,
    channels: false,
  };
}

function item(fields: Record<string, unknown>): MetaPreview {
  const parsed = parseMetaPreview({ type: 'sport', ...fields });
  if (!parsed) throw new Error('not an item');
  return parsed;
}

/** A listing whose kick-off is `at`, as an addon sends it in `released`. */
function listing(id: string, name: string, at: number, addonIndex = 0, extra = {}): Listing {
  const released = new Date(at).toISOString();
  return readListing(
    item({ id, name, released, genres: ['Football', 'Premier League'], ...extra }),
    context(addonIndex),
    NOW,
  );
}

const events = (...listings: Listing[]) => buildEvents(listings, { matcher });

describe('what can have a reminder', () => {
  it('is a match still to come, with a kick-off far enough off for the reminder to come first', () => {
    const [later, soon, started] = events(
      listing('a', 'Arsenal vs Chelsea', NOW + HOUR),
      listing('b', 'Liverpool vs Everton', NOW + REMIND_BEFORE_MS - MINUTE, 1),
      listing('c', 'Leeds United vs Burnley', NOW - MINUTE, 2),
    );
    expect(canRemind(later!, NOW)).toBe(true);
    expect(canRemind(soon!, NOW)).toBe(false);
    expect(canRemind(started!, NOW)).toBe(false);
    const reminder = reminderFor(later!, 'Arsenal v Chelsea');
    expect(reminder).toEqual({
      key: later!.key,
      matchKey: later!.matchKey,
      name: 'Arsenal v Chelsea',
      at: NOW + HOUR,
    });
    // Never the addon's address.
    expect(JSON.stringify(reminder)).not.toContain('example');
    expect(remindAt(reminder!)).toBe(NOW + HOUR - REMIND_BEFORE_MS);
  });

  it('is never a replay or a match with no time', () => {
    const [replay, untimed] = events(
      listing('r', 'Arsenal vs Chelsea (Full match replay)', NOW + HOUR),
      readListing(
        item({ id: 'u', name: 'Arsenal vs Chelsea', genres: ['Football'] }),
        context(1),
        NOW,
      ),
    );
    expect(replay!.kind).toBe('replay');
    expect(canRemind(replay!, NOW)).toBe(false);
    expect(reminderFor(replay!, 'Arsenal v Chelsea')).toBeUndefined();
    expect(canRemind(untimed!, NOW)).toBe(false);
  });
});

describe('finding the match again', () => {
  it('goes by its key, then by its sides near the same kick-off when the key moved', () => {
    const [match] = events(listing('a', 'Arsenal vs Chelsea', NOW + HOUR));
    const reminder = reminderFor(match!, 'Arsenal v Chelsea')!;
    expect(findReminded([match!], reminder)).toBe(match);

    // Another addon installed above it: the same match under another key.
    const [other, moved] = events(
      listing('x', 'Liverpool vs Everton', NOW + HOUR, 0),
      listing('a', 'Arsenal FC vs Chelsea FC', NOW + HOUR + 15 * MINUTE, 1),
    );
    expect(moved!.key).not.toBe(reminder.key);
    expect(findReminded([other!, moved!], reminder)).toBe(moved);

    // The same sides a week on are another match.
    const [nextWeek] = events(listing('a', 'Arsenal vs Chelsea', NOW + 7 * 24 * HOUR));
    expect(findReminded([nextWeek!], reminder)).toBeUndefined();
    expect(findReminded([], reminder)).toBeUndefined();
  });
});

describe('when reminders are due', () => {
  const at = NOW + HOUR;
  const reminder: Reminder = { key: 'k', name: 'Arsenal v Chelsea', at };

  it('from REMIND_BEFORE_MS before kick-off until REMIND_LATE_MS after it', () => {
    expect(isDue(reminder, at - REMIND_BEFORE_MS - 1)).toBe(false);
    expect(isDue(reminder, at - REMIND_BEFORE_MS)).toBe(true);
    expect(isDue(reminder, at + REMIND_LATE_MS - 1)).toBe(true);
    expect(isDue(reminder, at + REMIND_LATE_MS)).toBe(false);
  });

  it('lists the due ones by kick-off, and says when that next changes', () => {
    const early: Reminder = { key: 'e', name: 'Early', at: NOW };
    const later: Reminder = { key: 'l', name: 'Later', at: NOW + 2 * HOUR };
    const list = [later, reminder, early];
    expect(dueReminders(list, NOW)).toEqual([early]);
    expect(dueReminders(list, at)).toEqual([reminder]);
    expect(nextReminderChange(list, NOW)).toBe(NOW + REMIND_LATE_MS);
    expect(nextReminderChange(list, NOW + REMIND_LATE_MS)).toBe(at - REMIND_BEFORE_MS);
    expect(nextReminderChange([], NOW)).toBeUndefined();
    expect(nextReminderChange([early], NOW + REMIND_LATE_MS)).toBeUndefined();
  });
});

describe('createReminders', () => {
  it('sets, sets again and takes off reminders, the soonest first, and keeps them', async () => {
    const storage = memoryKeyValueStore();
    const reminders = createReminders({ storage });
    expect(reminders.loaded()).toBe(false);
    await reminders.load();
    expect(reminders.loaded()).toBe(true);
    const changes: number[] = [];
    reminders.subscribe(() => changes.push(reminders.list().length));
    expect(await reminders.add({ key: 'b', name: 'Later', at: NOW + 2 * HOUR })).toBe(true);
    expect(await reminders.add({ key: 'a', name: 'Sooner', at: NOW + HOUR })).toBe(true);
    expect(reminders.list().map((r) => r.key)).toEqual(['a', 'b']);
    const before = reminders.list();
    // The same again changes nothing; a new kick-off moves it.
    await reminders.add({ key: 'a', name: 'Sooner', at: NOW + HOUR });
    expect(reminders.list()).toBe(before);
    await reminders.add({ key: 'a', name: 'Sooner', at: NOW + 3 * HOUR });
    expect(reminders.list().map((r) => r.key)).toEqual(['b', 'a']);
    expect(reminders.has('a')).toBe(true);
    await reminders.remove('a');
    expect(reminders.has('a')).toBe(false);
    expect(changes).toEqual([1, 2, 2, 1]);

    const again = createReminders({ storage });
    await again.load();
    expect(again.list()).toEqual([{ key: 'b', name: 'Later', at: NOW + 2 * HOUR }]);
  });

  it('refuses more than MAX_REMINDERS, and what it cannot keep', async () => {
    const reminders = createReminders({ storage: memoryKeyValueStore() });
    await reminders.load();
    for (let i = 0; i < MAX_REMINDERS; i++) {
      expect(await reminders.add({ key: `k${i}`, name: `Match ${i}`, at: NOW + i * MINUTE })).toBe(
        true,
      );
    }
    expect(await reminders.add({ key: 'more', name: 'One more', at: NOW })).toBe(false);
    expect(reminders.list()).toHaveLength(MAX_REMINDERS);
    // One already set can still be set again.
    expect(await reminders.add({ key: 'k0', name: 'Match 0', at: NOW + HOUR })).toBe(true);
    expect(await reminders.add({ key: '', name: 'No key', at: NOW })).toBe(false);
    expect(await reminders.add({ key: 'n', name: '  ', at: NOW })).toBe(false);
    expect(await reminders.add({ key: 'n', name: 'No time', at: Number.NaN })).toBe(false);
  });

  it('reads what was saved, leaving out what it cannot read and the second of one match', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('sports.reminders', [
      { key: 'a', name: '  Arsenal   v Chelsea ', at: NOW, matchKey: 'arsenal|chelsea|' },
      { key: 'a', name: 'Again', at: NOW + HOUR },
      { key: 'b', name: 'No time' },
      'not a reminder',
      { key: 'c', name: 'Leeds v Burnley', at: NOW - HOUR, matchKey: 7 },
    ]);
    const reminders = createReminders({ storage });
    await reminders.load();
    expect(reminders.list()).toEqual([
      { key: 'c', name: 'Leeds v Burnley', at: NOW - HOUR },
      { key: 'a', name: 'Arsenal v Chelsea', at: NOW, matchKey: 'arsenal|chelsea|' },
    ]);
    await storage.set('sports.reminders', { not: 'a list' });
    const none = createReminders({ storage });
    await none.load();
    expect(none.list()).toEqual([]);
  });

  it('follows a kick-off the addon moved, and drops reminders too late to show', async () => {
    const [match, other] = events(
      listing('a', 'Arsenal vs Chelsea', NOW + 2 * HOUR),
      listing('b', 'Liverpool vs Everton', NOW + HOUR, 1),
    );
    const reminders = createReminders({ storage: memoryKeyValueStore() });
    await reminders.load();
    await reminders.add({ ...reminderFor(match!, 'Arsenal v Chelsea')!, at: NOW + HOUR });
    await reminders.add(reminderFor(other!, 'Liverpool v Everton')!);
    await reminders.add({ key: 'gone', name: 'Not listed', at: NOW - REMIND_LATE_MS + MINUTE });
    await reminders.add({ key: 'old', name: 'Long over', at: NOW - REMIND_LATE_MS });

    await reminders.refresh([match!, other!], NOW);
    expect(reminders.list().map((r) => [r.key, r.at])).toEqual([
      ['gone', NOW - REMIND_LATE_MS + MINUTE],
      [other!.key, NOW + HOUR],
      [match!.key, NOW + 2 * HOUR],
    ]);
    const before = reminders.list();
    await reminders.refresh([match!, other!], NOW);
    expect(reminders.list()).toBe(before);
    await reminders.refresh([], NOW + 2 * MINUTE);
    expect(reminders.list().map((r) => r.key)).toEqual([other!.key, match!.key]);
  });

  it("takes the match's new key when another addon listed above it moved the key", async () => {
    const [match] = events(listing('a', 'Arsenal vs Chelsea', NOW + HOUR));
    const reminders = createReminders({ storage: memoryKeyValueStore() });
    await reminders.load();
    await reminders.add(reminderFor(match!, 'Arsenal v Chelsea')!);

    const [, moved] = events(
      listing('x', 'Liverpool vs Everton', NOW + HOUR, 0),
      listing('a', 'Arsenal FC vs Chelsea FC', NOW + HOUR + 15 * MINUTE, 1),
    );
    await reminders.refresh([moved!], NOW);
    // The match page, which asks by the key it has now, says the reminder is on.
    expect(reminders.has(moved!.key)).toBe(true);
    expect(reminders.has(match!.key)).toBe(false);
    expect(reminders.list()).toEqual([
      {
        key: moved!.key,
        matchKey: match!.matchKey,
        name: 'Arsenal v Chelsea',
        at: NOW + HOUR + 15 * MINUTE,
      },
    ]);

    // Set again there before the listing moved it: one reminder, not two.
    const twice = createReminders({ storage: memoryKeyValueStore() });
    await twice.load();
    await twice.add(reminderFor(match!, 'Arsenal v Chelsea')!);
    await twice.add(reminderFor(moved!, 'Arsenal v Chelsea')!);
    await twice.refresh([moved!], NOW);
    expect(twice.list().map((r) => r.key)).toEqual([moved!.key]);
  });
});
