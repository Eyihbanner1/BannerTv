import { parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
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
  function clocks(times: string[], now: number, zone: string | undefined): Listing[] {
    return times.map((releaseInfo) => {
      const item = parseMetaPreview({
        id: `c${counter++}`,
        type: 'tv',
        name: `Home ${counter} vs Away ${counter}`,
        releaseInfo,
      });
      if (!item) throw new Error('not an item');
      const context = {
        addonIndex: 0,
        addonId: 'test.clocks',
        transportUrl: 'https://clocks.example/manifest.json',
        catalogId: 'today',
        replays: false,
        channels: false,
        ...(zone ? { zone } : {}),
      };
      return readListing(item, context, now);
    });
  }
  const kickOffs = (listings: Listing[]) => listings.map((listing) => listing.kickOff?.at);

  it('puts the times after the wrap on the next day', () => {
    const evening = at('2026-10-28T21:00:00Z');
    const listed = clocks(['22:00', '23:45', '00:30', '02:00'], evening, 'Europe/London');
    expect(kickOffs(listed)[2]).toBe(at('2026-10-28T00:30:00Z'));
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', evening))).toEqual([
      at('2026-10-28T22:00:00Z'),
      at('2026-10-28T23:45:00Z'),
      at('2026-10-29T00:30:00Z'),
      at('2026-10-29T02:00:00Z'),
    ]);
  });

  it('counts the next day by the calendar across the clock change', () => {
    const saturday = at('2027-03-27T22:00:00Z');
    const listed = clocks(['23:30', '02:30'], saturday, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', saturday))).toEqual([
      at('2027-03-27T23:30:00Z'),
      at('2027-03-28T01:30:00Z'),
    ]);
  });

  it('keeps a list seen after midnight on last night, its times past midnight on today', () => {
    const night = at('2026-10-29T01:00:00Z');
    const listed = clocks(['20:00', '22:00', '23:45', '00:30', '02:00'], night, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', night))).toEqual([
      at('2026-10-28T20:00:00Z'),
      at('2026-10-28T22:00:00Z'),
      at('2026-10-28T23:45:00Z'),
      at('2026-10-29T00:30:00Z'),
      at('2026-10-29T02:00:00Z'),
    ]);
  });

  it('puts a list seen in the small hours on today when it starts later today', () => {
    const night = at('2026-10-29T02:00:00Z');
    const listed = clocks(['03:00', '12:30', '20:00', '22:30'], night, 'Europe/London');
    // Alone, 22:30 would be last night's: more than 20 hours ahead.
    expect(kickOffs(listed)[3]).toBe(at('2026-10-28T22:30:00Z'));
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', night))).toEqual([
      at('2026-10-29T03:00:00Z'),
      at('2026-10-29T12:30:00Z'),
      at('2026-10-29T20:00:00Z'),
      at('2026-10-29T22:30:00Z'),
    ]);
  });

  it('places a list as readClock places one time: last night only when nearer', () => {
    const night = at('2026-10-29T01:00:00Z');
    // Later today, not last night's: the latest is 19 hours ahead.
    const later = clocks(['13:00', '15:00', '20:00'], night, 'Europe/London');
    expect(kickOffs(rollClockWraps(later, 'Europe/London', night))).toEqual([
      at('2026-10-29T13:00:00Z'),
      at('2026-10-29T15:00:00Z'),
      at('2026-10-29T20:00:00Z'),
    ]);
    // Last night's: two of the three kicked off in the last four hours, and today they
    // would be more than 20 hours away.
    const lastNight = clocks(['20:00', '21:30', '23:00'], night, 'Europe/London');
    expect(kickOffs(rollClockWraps(lastNight, 'Europe/London', night))).toEqual([
      at('2026-10-28T20:00:00Z'),
      at('2026-10-28T21:30:00Z'),
      at('2026-10-28T23:00:00Z'),
    ]);
  });

  it('keeps a list over a day long on today when it is seen before its first kick-off', () => {
    const morning = at('2026-10-28T10:00:00Z');
    const listed = clocks(
      ['12:30', '15:00', '20:00', '01:00', '03:00', '12:30', '15:00'],
      morning,
      'Europe/London',
    );
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', morning))).toEqual([
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
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', night))).toEqual(placed);
    const two = clocks(['00:20', '23:40'], at('2026-10-29T00:30:00Z'), 'Europe/London');
    expect(kickOffs(rollClockWraps(two, 'Europe/London', at('2026-10-29T00:30:00Z')))).toEqual(
      kickOffs(two),
    );
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
    expect(kickOffs(rollClockWraps(nz, undefined, auckland))).toEqual(kickOffs(nz));
    // 23:30 in New York, already the 29th in UTC: tonight's games stay tonight.
    const late = at('2026-10-29T03:30:00Z');
    const et = clocks(['1:00 PM ET', '4:00 PM ET', '8:00 PM ET'], late, undefined);
    expect(kickOffs(et)).toEqual([
      at('2026-10-28T17:00:00Z'),
      at('2026-10-28T20:00:00Z'),
      at('2026-10-29T00:00:00Z'),
    ]);
    expect(kickOffs(rollClockWraps(et, undefined, late))).toEqual(kickOffs(et));
    // A wrap still moves on a day: 00:30 in Auckland after 23:30 there.
    const nzNight = clocks(
      ['22:00 (Pacific/Auckland)', '23:30 (Pacific/Auckland)', '00:30 (Pacific/Auckland)'],
      auckland,
      undefined,
    );
    expect(kickOffs(rollClockWraps(nzNight, undefined, auckland))).toEqual([
      at('2026-10-29T09:00:00Z'),
      at('2026-10-29T10:30:00Z'),
      at('2026-10-29T11:30:00Z'),
    ]);
  });

  it('leaves a list that is not in kick-off order as it is', () => {
    const evening = at('2026-10-28T21:00:00Z');
    const listed = clocks(['20:00', '15:00', '00:30'], evening, 'Europe/London');
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', evening))).toEqual(kickOffs(listed));
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
    expect(kickOffs(rollClockWraps(listed, 'Europe/London', evening))).toEqual([
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
