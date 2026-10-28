import { describe, expect, it } from 'vitest';
import {
  addDays,
  localClock,
  localDate,
  localDayStart,
  readClock,
  readDatedText,
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

  it('marks abbreviations unsure, and a missing zone too unless the addon names one', () => {
    expect(readDatedText('Oct 28, 2026 8:00 PM ET', { now: NOW })?.sure).toBe(false);
    const bare = readDatedText('28 Oct 2026 20:00', { now: NOW });
    expect(bare).toMatchObject({ at: at('2026-10-28T20:00:00Z'), sure: false });
    const zoned = readDatedText('28 Oct 2026 20:00', { now: NOW, zone: 'America/New_York' });
    expect(zoned).toMatchObject({ at: at('2026-10-29T00:00:00Z'), sure: true });
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

  it('takes the day nearest to now', () => {
    const lateEvening = at('2026-10-28T23:30:00Z');
    expect(readClock('00:30', { now: lateEvening, zone: 'UTC' })?.at).toBe(
      at('2026-10-29T00:30:00Z'),
    );
    const afterMidnight = at('2026-10-29T00:30:00Z');
    expect(readClock('23:00', { now: afterMidnight, zone: 'UTC' })?.at).toBe(
      at('2026-10-28T23:00:00Z'),
    );
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

  it('gives nothing for an unknown or missing zone', () => {
    expect(zoneFromAddress('https://addon.test/manifest.json')).toBeUndefined();
    expect(zoneFromAddress('https://addon.test/tz=Mars%2FOlympus/manifest.json')).toBeUndefined();
    expect(zoneFromAddress('%E0%A4%A')).toBeUndefined();
  });
});
