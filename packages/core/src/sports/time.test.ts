import { type MetaPreview, parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createKickoffMemory, dayEvidence } from './kickoffs';
import { type Listing, readListing, rollClockWraps } from './listing';
import {
  addDays,
  localClock,
  localDate,
  localDayStart,
  nextDayAt,
  readClock,
  readDatedText,
  readDateOnly,
  readKickOff,
  readReleased,
  readStartKey,
  zoneFromAddress,
} from './time';

const NOW = Date.parse('2026-10-28T04:05:00Z');
const at = (iso: string) => Date.parse(iso);
const HOUR = 60 * 60 * 1000;

describe('dated text', () => {
  it('reads the forms addons write, with their zone', () => {
    expect(readDatedText('28 Oct 2026 · 17:00 UTC', { now: NOW })).toEqual({
      at: at('2026-10-28T17:00:00Z'),
      sure: true,
      source: 'dated-text',
    });
    expect(readDatedText('Oct 28, 2026 8:00 PM ET', { now: NOW })?.at).toBe(
      at('2026-10-29T00:00:00Z'),
    );
    expect(readDatedText('2026-10-28 19:45 GMT+1', { now: NOW })?.at).toBe(
      at('2026-10-28T18:45:00Z'),
    );
    expect(readDatedText('28.10.2026 20:00 (Europe/Berlin)', { now: NOW })?.at).toBe(
      at('2026-10-28T19:00:00Z'),
    );
  });

  it('marks abbreviations unsure, and places no time without a zone', () => {
    expect(readDatedText('Oct 28, 2026 8:00 PM ET', { now: NOW })?.sure).toBe(false);
    // No zone written and none from the addon: none is assumed, so the time stays out of Live now.
    expect(readDatedText('28 Oct 2026 20:00', { now: NOW })).toBeUndefined();
    expect(readDatedText('Oct 28, 2026 8:00 PM', { now: NOW })).toBeUndefined();
    const zoned = readDatedText('28 Oct 2026 20:00', { now: NOW, zone: 'America/New_York' });
    expect(zoned).toMatchObject({ at: at('2026-10-29T00:00:00Z'), sure: true });
  });

  it('keeps the date of a time it cannot place', () => {
    for (const text of ['28 Oct 2026 20:00', 'Oct 28, 2026 8:00 PM', '28/10/2026 20:00']) {
      expect(readKickOff({ releaseInfo: text, name: 'x', replay: false }, { now: NOW })).toEqual({
        date: '2026-10-28',
        sure: true,
        source: 'date-only',
      });
    }
    expect(readDateOnly('Oct 32, 2026 8:00 PM')).toBeUndefined();
  });

  it('reads no zone from a word after the time', () => {
    const moscow = { now: NOW, zone: 'Europe/Moscow' };
    for (const text of ['28 Oct 2026 20:00\nZenit vs Spartak', '28 Oct 2026 20:00 Zagreb']) {
      expect(readDatedText(text, moscow)).toEqual({
        at: at('2026-10-28T17:00:00Z'),
        sure: true,
        source: 'dated-text',
      });
    }
    // French "et", not Eastern Time.
    expect(
      readDatedText('28 oct. 2026 20:00 et 22:00', { now: NOW, zone: 'Europe/Paris' }),
    ).toMatchObject({ at: at('2026-10-28T19:00:00Z'), sure: true });
    expect(readDatedText('2026-10-28T20:00:00Z', moscow)?.at).toBe(at('2026-10-28T20:00:00Z'));
    expect(readDatedText('28 Oct 2026 20:00 UTC+1', moscow)?.at).toBe(at('2026-10-28T19:00:00Z'));
  });

  it('reads nothing from text without a date and time', () => {
    expect(readDatedText('LIVE', { now: NOW })).toBeUndefined();
    expect(readDatedText('Live IPTV Recording', { now: NOW })).toBeUndefined();
    expect(readDatedText('32 Oct 2026 · 25:00 UTC', { now: NOW })).toBeUndefined();
  });
});

describe('clock times', () => {
  it('needs a zone: from the text or the addon, never assumed', () => {
    expect(readClock('19:45', { now: NOW })).toBeUndefined();
    expect(readClock('11:00 PM (America/New_York)', { now: NOW })?.at).toBe(
      at('2026-10-28T03:00:00Z'),
    );
    expect(readClock('19:45', { now: NOW, zone: 'Europe/London' })?.at).toBe(
      at('2026-10-28T19:45:00Z'),
    );
  });

  it("keeps the addon's day, where finished matches stay listed", () => {
    // This morning's match seen late in the evening is this morning's, not tomorrow's.
    const lateEvening = at('2026-10-28T22:30:00Z');
    expect(readClock('10:00', { now: lateEvening, zone: 'Europe/London' })?.at).toBe(
      at('2026-10-28T10:00:00Z'),
    );
    expect(readClock('00:30', { now: lateEvening, zone: 'UTC' })?.at).toBe(
      at('2026-10-28T00:30:00Z'),
    );
    // Nearly a day away: last night's, still listed.
    const afterMidnight = at('2026-10-29T00:30:00Z');
    expect(readClock('23:00', { now: afterMidnight, zone: 'UTC' })?.at).toBe(
      at('2026-10-28T23:00:00Z'),
    );
  });

  it('goes back a day by the calendar across the clock change', () => {
    // UK clocks go forward on 28 March 2027. Monday 00:30 BST is 23:30 UTC on Sunday.
    const mondayAfter = at('2027-03-28T23:30:00Z');
    expect(readClock('23:00', { now: mondayAfter, zone: 'Europe/London' })?.at).toBe(
      at('2027-03-28T22:00:00Z'),
    );
  });

  it('moves a time on by calendar days in the zone', () => {
    // 02:30 GMT on Saturday is 02:30 BST on Sunday, 23 hours later.
    expect(nextDayAt(at('2027-03-27T02:30:00Z'), 'Europe/London')).toBe(at('2027-03-28T01:30:00Z'));
    // 03:00 BST on Saturday is 03:00 GMT on Sunday, 25 hours later.
    expect(nextDayAt(at('2026-10-24T02:00:00Z'), 'Europe/London')).toBe(at('2026-10-25T03:00:00Z'));
    expect(nextDayAt(at('2026-10-28T23:00:00Z'), undefined, 2)).toBe(at('2026-10-30T23:00:00Z'));
  });
});

describe('a list of clock times that wraps past midnight', () => {
  let counter = 0;
  function matches(times: string[]): MetaPreview[] {
    return times.map((releaseInfo) => {
      const item = parseMetaPreview({
        id: `c${counter++}`,
        type: 'tv',
        name: `Home ${counter} vs Away ${counter}`,
        releaseInfo,
      });
      if (!item) throw new Error('not an item');
      return item;
    });
  }
  function read(items: MetaPreview[], now: number, zone: string | undefined): Listing[] {
    const context = {
      addonIndex: 0,
      addonId: 'test.clocks',
      transportUrl: 'https://clocks.example/manifest.json',
      catalogId: 'today',
      replays: false,
      channels: false,
      ...(zone ? { zone } : {}),
    };
    return items.map((item) => readListing(item, context, now));
  }
  const clocks = (times: string[], now: number, zone: string | undefined) =>
    read(matches(times), now, zone);
  const kickOffs = (listings: Listing[]) => listings.map((listing) => listing.kickOff?.at);
  /** What a roll placed, by item id, for reading the same items again later. */
  const memoryOf = (listings: Listing[]) => {
    const known = new Map(listings.map((listing) => [listing.source.id, listing.kickOff?.at]));
    return (listing: Listing) => known.get(listing.source.id);
  };

  it('puts the times after the wrap on the next day', () => {
    const evening = at('2026-10-28T21:00:00Z');
    const listed = clocks(['22:00', '23:45', '00:30', '02:00'], evening, 'Europe/London');
    expect(kickOffs(listed)[2]).toBe(at('2026-10-28T00:30:00Z'));
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-10-28T22:00:00Z'),
      at('2026-10-28T23:45:00Z'),
      at('2026-10-29T00:30:00Z'),
      at('2026-10-29T02:00:00Z'),
    ]);
  });

  it('counts the next day by the calendar across the clock change', () => {
    const saturday = at('2027-03-27T22:00:00Z');
    const listed = clocks(['23:30', '02:30'], saturday, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2027-03-27T23:30:00Z'),
      at('2027-03-28T01:30:00Z'),
    ]);
  });

  it("puts a list seen after midnight on the addon's new day when nothing is remembered", () => {
    const night = at('2026-10-29T01:00:00Z');
    const listed = clocks(['20:00', '22:00', '23:45', '00:30', '02:00'], night, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-10-29T20:00:00Z'),
      at('2026-10-29T22:00:00Z'),
      at('2026-10-29T23:45:00Z'),
      at('2026-10-30T00:30:00Z'),
      at('2026-10-30T02:00:00Z'),
    ]);
  });

  it("keeps last night's list on last night after midnight, by the days remembered", () => {
    const items = matches(['20:00', '22:00', '23:45', '00:30', '02:00']);
    const evening = rollClockWraps(
      read(items, at('2026-10-28T21:00:00Z'), 'Europe/London'),
      'Europe/London',
    );
    const lastNight = [
      at('2026-10-28T20:00:00Z'),
      at('2026-10-28T22:00:00Z'),
      at('2026-10-28T23:45:00Z'),
      at('2026-10-29T00:30:00Z'),
      at('2026-10-29T02:00:00Z'),
    ];
    expect(kickOffs(evening)).toEqual(lastNight);
    // Read again at 01:00, as the addon still lists it: 00:30 is under way, 02:00 to come.
    const night = read(items, at('2026-10-29T01:00:00Z'), 'Europe/London');
    expect(kickOffs(rollClockWraps(night, 'Europe/London', memoryOf(evening)))).toEqual(lastNight);
  });

  it('keeps the matches left after midnight on the day remembered for them', () => {
    // Seen at 22:30 with the evening's matches still listed: 00:30 and 02:45 are tomorrow's.
    const items = matches(['23:30', '00:30', '02:45']);
    const before = rollClockWraps(
      read(items, at('2026-11-04T22:30:00Z'), 'Europe/London'),
      'Europe/London',
    );
    expect(kickOffs(before).slice(1)).toEqual([
      at('2026-11-05T00:30:00Z'),
      at('2026-11-05T02:45:00Z'),
    ]);
    // At 23:40 the 23:30 shows LIVE with no time: nothing left wraps, but memory knows the day.
    const later = read(items.slice(1), at('2026-11-04T23:40:00Z'), 'Europe/London');
    expect(kickOffs(later)).toEqual([at('2026-11-04T00:30:00Z'), at('2026-11-04T02:45:00Z')]);
    expect(kickOffs(rollClockWraps(later, 'Europe/London', memoryOf(before)))).toEqual([
      at('2026-11-05T00:30:00Z'),
      at('2026-11-05T02:45:00Z'),
    ]);
  });

  it('goes by most of what is remembered, and by nothing remembered days away', () => {
    const items = matches(['19:00', '20:00', '21:00']);
    const listed = read(items, at('2026-10-28T12:00:00Z'), 'Europe/London');
    const placed = kickOffs(listed);
    const days = (listing: Listing, offset: number) => listing.kickOff!.at! + offset * 24 * HOUR;
    // Two of three a day earlier: the run goes a day earlier, but the one remembered on
    // the day it reads as stays there.
    const mostly = (listing: Listing) => days(listing, listing === listed[2] ? 0 : -1);
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', mostly))).toEqual([
      placed[0]! - 24 * HOUR,
      placed[1]! - 24 * HOUR,
      placed[2],
    ]);
    // A week ago, or hours off the clock: no evidence either way.
    const weekAgo = (listing: Listing) => days(listing, -7);
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', weekAgo))).toEqual(placed);
    const offClock = (listing: Listing) => days(listing, -1) + 5 * HOUR;
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', offClock))).toEqual(placed);
  });

  /** What a memory that noted these listings at `seen` gives as evidence at `now`. */
  const evidenceOf = (noted: Array<[Listing[], number]>, now: number) => {
    let time = 0;
    const memory = createKickoffMemory({
      timers: { after: () => () => undefined, every: () => () => undefined },
      now: () => time,
    });
    for (const [listings, seen] of noted) {
      time = seen;
      for (const listing of listings) {
        memory.note(listing.source.addonId, listing.source.id, listing.kickOff);
      }
    }
    return dayEvidence(memory, now, 'Europe/London');
  };
  /** A list seen at `seen` and read again at each of `later`, by what was seen. */
  const seenThenRead = (times: string[], seen: number, later: number[]) => {
    const items = matches(times);
    const first = rollClockWraps(read(items, seen, 'Europe/London'), 'Europe/London');
    return {
      first: kickOffs(first),
      later: later.map((now) =>
        kickOffs(
          rollClockWraps(
            read(items, now, 'Europe/London'),
            'Europe/London',
            evidenceOf([[first, seen]], now),
          ),
        ),
      ),
    };
  };

  it("holds last night's whole card after midnight until the morning, however early it began", () => {
    const { first, later } = seenThenRead(
      ['12:30', '15:00', '15:00', '15:00', '17:30', '20:00'],
      at('2026-10-31T21:00:00Z'),
      [at('2026-11-01T01:00:00Z'), at('2026-11-01T03:00:00Z'), at('2026-11-01T06:30:00Z')],
    );
    expect(first[0]).toBe(at('2026-10-31T12:30:00Z'));
    expect(later[0]).toEqual(first);
    expect(later[1]).toEqual(first);
    // From 06:00, the plan's rule: the addon's current day.
    expect(later[2]).toEqual(first.map((time) => time! + 24 * HOUR));
  });

  it('holds a list first seen in the morning through the night after', () => {
    const { first, later } = seenThenRead(
      ['12:30', '15:00', '17:30', '20:00', '22:00'],
      at('2026-10-31T07:00:00Z'),
      [at('2026-11-01T03:30:00Z'), at('2026-11-01T06:30:00Z')],
    );
    expect(later[0]).toEqual(first);
    expect(later[1]).toEqual(first.map((time) => time! + 24 * HOUR));
  });

  it("keeps a long list's second day on its days after midnight", () => {
    const { first, later } = seenThenRead(
      ['19:45', '00:30', '03:00', '12:30', '15:00', '15:00', '17:30', '20:00'],
      at('2026-11-06T10:00:00Z'),
      [at('2026-11-07T01:00:00Z')],
    );
    expect(first.slice(0, 2)).toEqual([at('2026-11-06T19:45:00Z'), at('2026-11-07T00:30:00Z')]);
    expect(first[7]).toBe(at('2026-11-07T20:00:00Z'));
    expect(later[0]).toEqual(first);
  });

  it('holds a list seen late on its evening only until the next morning', () => {
    // At 23:40 the addon may already list tomorrow's matches, or still tonight's, over:
    // the plan reads tonight's, and BannerTV keeps to that until the morning.
    const { first, later } = seenThenRead(['15:00', '17:30', '20:00'], at('2026-11-04T23:40:00Z'), [
      at('2026-11-05T00:10:00Z'),
      at('2026-11-05T06:30:00Z'),
    ]);
    expect(first[0]).toBe(at('2026-11-04T15:00:00Z'));
    expect(later[0]).toEqual(first);
    expect(later[1]).toEqual(first.map((time) => time! + 24 * HOUR));
  });

  it('moves a fresh list by no single match remembered, nor by a match listed again days on', () => {
    const night = at('2026-10-29T01:00:00Z');
    const items = matches(['20:00', '21:00', '22:00', '23:00']);
    const listed = read(items, night, 'Europe/London');
    const placed = kickOffs(rollClockWraps(listed, 'Europe/London'));
    expect(placed[0]).toBe(at('2026-10-29T20:00:00Z'));
    // One of the four was seen last night at 21:00, a day earlier: three new ones outvote it.
    const lastNight = at('2026-10-28T21:00:00Z');
    const oneOfFour = read(items.slice(1, 2), lastNight, 'Europe/London');
    expect(
      kickOffs(
        rollClockWraps(listed, 'Europe/London', evidenceOf([[oneOfFour, lastNight]], night)),
      ),
    ).toEqual(placed);
    // The second day of a Test, first seen two days ago: says nothing about today.
    const daysAgo = at('2026-10-27T19:30:00Z');
    const test = read(items, daysAgo, 'Europe/London').map((listing) => ({
      ...listing,
      kickOff: { ...listing.kickOff!, at: listing.kickOff!.at! + 24 * HOUR },
    }));
    expect(
      kickOffs(rollClockWraps(listed, 'Europe/London', evidenceOf([[test, daysAgo]], night))),
    ).toEqual(placed);
    // Seen last night, all four: the run stays on last night.
    const all = read(items, lastNight, 'Europe/London');
    expect(
      kickOffs(rollClockWraps(listed, 'Europe/London', evidenceOf([[all, lastNight]], night))),
    ).toEqual(placed.map((time) => time! - 24 * HOUR));
  });

  it('counts only matches, never the channel programmes between them', () => {
    const programme = (n: number, releaseInfo: string) =>
      parseMetaPreview({
        id: `prog${n}`,
        type: 'tv',
        name: `Sports Tonight S1, E${n}`,
        releaseInfo,
      })!;
    const games = matches(['20:00', '21:00', '22:00']);
    const items = [
      games[0]!,
      programme(1, '20:45'),
      games[1]!,
      programme(2, '21:45'),
      games[2]!,
      programme(3, '22:45'),
      programme(4, '23:30'),
    ];
    const seen = at('2026-10-28T21:00:00Z');
    const first = read(items, seen, 'Europe/London');
    expect(first.map((listing) => listing.kind)).toEqual([
      'event',
      'channel',
      'event',
      'channel',
      'event',
      'channel',
      'channel',
    ]);
    const night = at('2026-10-29T01:00:00Z');
    const games1st = first.filter((listing) => listing.kind === 'event');
    const placed = rollClockWraps(
      read(items, night, 'Europe/London'),
      'Europe/London',
      evidenceOf([[games1st, seen]], night),
    );
    expect(kickOffs(placed.filter((listing) => listing.kind === 'event'))).toEqual([
      at('2026-10-28T20:00:00Z'),
      at('2026-10-28T21:00:00Z'),
      at('2026-10-28T22:00:00Z'),
    ]);
  });

  it('keeps the top of a live-first list on the day remembered for it', () => {
    const { first, later } = seenThenRead(['20:30', '20:15', '22:00'], at('2026-10-28T21:00:00Z'), [
      at('2026-10-29T00:20:00Z'),
    ]);
    expect(first).toEqual([
      at('2026-10-28T20:30:00Z'),
      at('2026-10-28T20:15:00Z'),
      at('2026-10-28T22:00:00Z'),
    ]);
    expect(later[0]).toEqual(first);
  });

  it('puts a list seen in the small hours on today when it starts later today', () => {
    const night = at('2026-10-29T02:00:00Z');
    const listed = clocks(['03:00', '12:30', '20:00', '22:30'], night, 'Europe/London');
    // Alone, 22:30 would be last night's: more than 20 hours ahead.
    expect(kickOffs(listed)[3]).toBe(at('2026-10-28T22:30:00Z'));
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-10-29T03:00:00Z'),
      at('2026-10-29T12:30:00Z'),
      at('2026-10-29T20:00:00Z'),
      at('2026-10-29T22:30:00Z'),
    ]);
  });

  it('puts a list seen after midnight on today when it starts later today', () => {
    const night = at('2026-10-29T01:00:00Z');
    const later = clocks(['13:00', '15:00', '20:00'], night, 'Europe/London');
    expect(kickOffs(rollClockWraps(later, 'Europe/London'))).toEqual([
      at('2026-10-29T13:00:00Z'),
      at('2026-10-29T15:00:00Z'),
      at('2026-10-29T20:00:00Z'),
    ]);
  });

  it('keeps a list over a day long on today, however busy its second day', () => {
    const friday = at('2026-11-06T10:00:00Z');
    const listed = clocks(
      ['19:45', '00:30', '03:00', '12:30', '15:00', '15:00', '15:00', '17:30', '20:00'],
      friday,
      'Europe/London',
    );
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-11-06T19:45:00Z'),
      at('2026-11-07T00:30:00Z'),
      at('2026-11-07T03:00:00Z'),
      at('2026-11-07T12:30:00Z'),
      at('2026-11-07T15:00:00Z'),
      at('2026-11-07T15:00:00Z'),
      at('2026-11-07T15:00:00Z'),
      at('2026-11-07T17:30:00Z'),
      at('2026-11-07T20:00:00Z'),
    ]);
  });

  it('reads a step back of exactly half a day as a wrap', () => {
    const evening = at('2026-11-04T18:00:00Z');
    const listed = clocks(['19:00', '20:00', '08:00'], evening, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))[2]).toBe(at('2026-11-05T08:00:00Z'));
  });

  it('keeps a step forward of most of a day on the same day', () => {
    const morning = at('2026-11-04T10:00:00Z');
    const listed = clocks(['00:15', '23:30'], morning, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-11-04T00:15:00Z'),
      at('2026-11-04T23:30:00Z'),
    ]);
  });

  it("reads steps forward of over half a day in zones that are not the address's", () => {
    // 03:30 in New York; the clocks name their zone, and the address none.
    const early = at('2026-10-31T07:30:00Z');
    const et = clocks(
      ['1:00 AM ET', '2:30 AM ET', '8:00 PM ET', '10:30 PM ET', '12:30 AM ET'],
      early,
      undefined,
    );
    expect(kickOffs(rollClockWraps(et, undefined))[4]).toBe(at('2026-11-01T04:30:00Z'));
    const kolkata = clocks(
      ['19:30 (Asia/Kolkata)', '00:30 (Asia/Kolkata)', '15:30 (Asia/Kolkata)'],
      at('2026-11-03T12:30:00Z'),
      undefined,
    );
    expect(kickOffs(rollClockWraps(kolkata, undefined))).toEqual([
      at('2026-11-03T14:00:00Z'),
      at('2026-11-03T19:00:00Z'),
      at('2026-11-04T10:00:00Z'),
    ]);
  });

  it('keeps a list over a day long on today when it is seen before its first kick-off', () => {
    const morning = at('2026-10-28T10:00:00Z');
    const listed = clocks(
      ['12:30', '15:00', '20:00', '01:00', '03:00', '12:30', '15:00'],
      morning,
      'Europe/London',
    );
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-10-28T12:30:00Z'),
      at('2026-10-28T15:00:00Z'),
      at('2026-10-28T20:00:00Z'),
      at('2026-10-29T01:00:00Z'),
      at('2026-10-29T03:00:00Z'),
      at('2026-10-29T12:30:00Z'),
      at('2026-10-29T15:00:00Z'),
    ]);
  });

  it('reads a live-first step back across midnight as a step back, not a wrap', () => {
    const night = at('2026-10-29T00:20:00Z');
    // 00:10 and last night's 23:50 are under way; 00:30 and 01:00 are still to come.
    const listed = clocks(['00:10', '23:50', '00:30', '01:00'], night, 'Europe/London');
    const placed = [
      at('2026-10-29T00:10:00Z'),
      at('2026-10-28T23:50:00Z'),
      at('2026-10-29T00:30:00Z'),
      at('2026-10-29T01:00:00Z'),
    ];
    expect(kickOffs(listed)).toEqual(placed);
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual(placed);
    const two = clocks(['00:20', '23:40'], at('2026-10-29T00:30:00Z'), 'Europe/London');
    expect(kickOffs(rollClockWraps(two, 'Europe/London'))).toEqual(kickOffs(two));
  });

  it('keeps clocks that name their own zone on their own day when the address names none', () => {
    // 10:00 on 29 October in Auckland, still the 28th in UTC.
    const auckland = at('2026-10-28T21:00:00Z');
    const nz = clocks(
      ['15:00 (Pacific/Auckland)', '19:30 (Pacific/Auckland)'],
      auckland,
      undefined,
    );
    expect(kickOffs(nz)).toEqual([at('2026-10-29T02:00:00Z'), at('2026-10-29T06:30:00Z')]);
    expect(kickOffs(rollClockWraps(nz, undefined))).toEqual(kickOffs(nz));
    // 23:30 in New York, already the 29th in UTC: tonight's games stay tonight.
    const late = at('2026-10-29T03:30:00Z');
    const et = clocks(['1:00 PM ET', '4:00 PM ET', '8:00 PM ET'], late, undefined);
    expect(kickOffs(et)).toEqual([
      at('2026-10-28T17:00:00Z'),
      at('2026-10-28T20:00:00Z'),
      at('2026-10-29T00:00:00Z'),
    ]);
    expect(kickOffs(rollClockWraps(et, undefined))).toEqual(kickOffs(et));
    // A wrap still moves on a day: 00:30 in Auckland after 23:30 there.
    const nzNight = clocks(
      ['22:00 (Pacific/Auckland)', '23:30 (Pacific/Auckland)', '00:30 (Pacific/Auckland)'],
      auckland,
      undefined,
    );
    expect(kickOffs(rollClockWraps(nzNight, undefined))).toEqual([
      at('2026-10-29T09:00:00Z'),
      at('2026-10-29T10:30:00Z'),
      at('2026-10-29T11:30:00Z'),
    ]);
  });

  it('leaves a list that is not in kick-off order as it is', () => {
    const evening = at('2026-10-28T21:00:00Z');
    const listed = clocks(['20:00', '15:00', '00:30'], evening, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual(kickOffs(listed));
  });

  it('reads the repeats where pages overlap as the same matches, not as a step back', () => {
    const evening = at('2026-10-28T21:00:00Z');
    // The first page was asked again after matches left the top: it now reaches as far
    // as the older second page, which repeats the last four.
    const first = clocks(['20:00', '21:00', '22:00', '23:00', '00:30'], evening, 'Europe/London');
    const listed = [...first, ...first.slice(1)];
    const days = [
      at('2026-10-28T21:00:00Z'),
      at('2026-10-28T22:00:00Z'),
      at('2026-10-28T23:00:00Z'),
      at('2026-10-29T00:30:00Z'),
    ];
    expect(kickOffs(rollClockWraps(listed, 'Europe/London'))).toEqual([
      at('2026-10-28T20:00:00Z'),
      ...days,
      ...days,
    ]);
  });
});

describe('released', () => {
  it('trusts a kick-off and drops a fetch time', () => {
    expect(readReleased('2026-10-28T17:00:00.000Z', false)).toMatchObject({
      at: at('2026-10-28T17:00:00Z'),
      source: 'released',
    });
    // Seconds and milliseconds: when the addon answered, not when the match starts.
    expect(readReleased('2026-10-28T04:03:17.512Z', false)?.at).toBeUndefined();
    expect(readReleased('garbage', false)).toBeUndefined();
  });

  it('reads midnight on a replay as a date only', () => {
    expect(readReleased('2026-10-27T00:00:00.000Z', true)).toMatchObject({ date: '2026-10-27' });
  });
});

describe('start keys', () => {
  it('reads epoch seconds and milliseconds', () => {
    expect(readStartKey('1793206800', '', { now: NOW })?.at).toBe(1793206800000);
    expect(readStartKey('1793206800000', '', { now: NOW })?.at).toBe(1793206800000);
  });

  it('drops an ISO key that disagrees with the clock in the name', () => {
    expect(
      readStartKey('2026-10-28T19:00:00Z', 'Celtic vs Rangers 20:00', { now: NOW }),
    ).toBeUndefined();
    expect(
      readStartKey('2026-10-28T20:00:00Z', 'Celtic vs Rangers 20:00', { now: NOW })?.sure,
    ).toBe(true);
  });
});

describe('readKickOff', () => {
  it('prefers released, then dated text', () => {
    expect(
      readKickOff(
        {
          released: '2026-10-28T17:00:00.000Z',
          releaseInfo: '28 Oct 2026 · 18:00 UTC',
          name: 'x',
          replay: false,
        },
        { now: NOW },
      )?.at,
    ).toBe(at('2026-10-28T17:00:00Z'));
    expect(
      readKickOff(
        {
          released: '2026-10-28T04:03:17.512Z',
          releaseInfo: '28 Oct 2026 · 18:00 UTC',
          name: 'x',
          replay: false,
        },
        { now: NOW },
      )?.at,
    ).toBe(at('2026-10-28T18:00:00Z'));
  });

  it('falls back to a date in the name', () => {
    expect(
      readKickOff({ name: 'Highlights 26.10.2026', replay: true }, { now: NOW }),
    ).toMatchObject({
      date: '2026-10-26',
    });
  });

  it('gives nothing for nothing', () => {
    expect(readKickOff({ name: 'Horse Racing', replay: false }, { now: NOW })).toBeUndefined();
  });
});

describe('local days', () => {
  it('counts days by the calendar across the clock change', () => {
    // UK clocks went back on 25 October 2026: that day had 25 hours.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(localDayStart('2026-10-26') - localDayStart('2026-10-25')).toBe(25 * 60 * 60 * 1000);
    expect(localDate(at('2026-10-25T23:30:00Z'))).toBe('2026-10-25');
    expect(localDate(at('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
    expect(localClock(at('2026-07-01T18:00:00Z'))).toBe('19:00');
  });
});

describe('zone from an install address', () => {
  it('reads a plain timezone setting', () => {
    expect(zoneFromAddress('https://addon.test/timezone=Europe%2FLondon/manifest.json')).toBe(
      'Europe/London',
    );
  });

  it('reads one from base64 settings, and only that', () => {
    // {"key":"SECRET-KEY-123","timezone":"America/New_York"}, base64url.
    const encoded = 'eyJrZXkiOiJTRUNSRVQtS0VZLTEyMyIsInRpbWV6b25lIjoiQW1lcmljYS9OZXdfWW9yayJ9';
    expect(zoneFromAddress(`https://addon.test/${encoded}/manifest.json`)).toBe('America/New_York');
  });

  it('reads one from percent-encoded base64 settings', () => {
    // {"timezone":"Europe/London","key":"???"}: its base64 holds "/" and "=" padding.
    const encoded = 'eyJ0aW1lem9uZSI6IkV1cm9wZS9Mb25kb24iLCJrZXkiOiI%2FPz8ifQ%3D%3D';
    expect(zoneFromAddress(`https://addon.test/${encoded}/manifest.json`)).toBe('Europe/London');
  });

  it('reads a UTC offset as that offset, never as plain UTC', () => {
    expect(zoneFromAddress('https://addon.test/tz=UTC-3/manifest.json')).toBe('UTC-03:00');
    expect(zoneFromAddress('https://addon.test/timezone=GMT%2B5%3A30/manifest.json')).toBe(
      'UTC+05:30',
    );
    // {"timezone":"UTC-03:00","key":"abc"}, base64.
    const encoded = 'eyJ0aW1lem9uZSI6IlVUQy0wMzowMCIsImtleSI6ImFiYyJ9';
    expect(zoneFromAddress(`https://addon.test/${encoded}/manifest.json`)).toBe('UTC-03:00');
    expect(zoneFromAddress('https://addon.test/timezone=Etc%2FGMT%2B3/manifest.json')).toBe(
      'Etc/GMT+3',
    );
    expect(zoneFromAddress('https://addon.test/tz=UTC/manifest.json')).toBe('UTC');
    expect(zoneFromAddress('https://addon.test/tz=UTC%2B0/manifest.json')).toBe('UTC');
    expect(zoneFromAddress('https://addon.test/tz=UTC%2B25/manifest.json')).toBeUndefined();
    expect(zoneFromAddress('https://addon.test/tz=UTCX/manifest.json')).toBeUndefined();
    // MeteGol-style 23:00 in UTC-3 is 02:00 UTC the next day.
    const evening = { now: at('2026-10-28T20:00:00Z'), zone: 'UTC-03:00' };
    expect(readClock('23:00', evening)?.at).toBe(at('2026-10-29T02:00:00Z'));
    expect(readClock('23:00', { ...evening, zone: 'Etc/GMT+3' })?.at).toBe(
      at('2026-10-29T02:00:00Z'),
    );
  });

  it('gives nothing for an unknown or missing zone', () => {
    expect(zoneFromAddress('https://addon.test/manifest.json')).toBeUndefined();
    expect(zoneFromAddress('https://addon.test/tz=Mars%2FOlympus/manifest.json')).toBeUndefined();
    expect(zoneFromAddress('%E0%A4%A')).toBeUndefined();
  });
});
