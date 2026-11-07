import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayName } from '../screens/sports/fixture';
import { dateFormatter } from './date-format';
import { formatDate } from './describe';

// Node follows a change to TZ at once, as a TV or phone does when its time zone is changed.
const setZone = (zone: string) => vi.stubEnv('TZ', zone);
afterEach(() => {
  vi.unstubAllEnvs();
});

const ZONES = [
  'UTC',
  'Europe/London',
  'America/Los_Angeles',
  'America/St_Johns',
  'Asia/Kolkata',
  'Pacific/Auckland',
  'Pacific/Kiritimati',
];

// Day and year ends, a leap day, both edges of British Summer Time, odd offsets, far years.
const DATES = [
  '2024-05-03T00:00:00.000Z',
  '2024-05-03',
  '2023-12-31T23:59:59Z',
  '2024-01-01T00:00:00Z',
  '2024-02-29T12:00:00Z',
  '2024-03-31T00:59:59Z',
  '2024-03-31T01:00:00Z',
  '2024-10-27T00:59:59Z',
  '2024-10-27T01:00:00Z',
  '2025-06-15T18:45:00+05:30',
  '1999-01-01T09:00:00-08:00',
  '1970-01-01T00:00:00Z',
  '2038-01-19T03:14:08Z',
  '2100-07-04T12:00:00Z',
];

// What the app formats with, and other locales, to show the formatter is not tied to one.
const LOCALES = ['en-GB', 'en-US', 'de-DE', 'fr-FR', 'ja-JP', 'ar-EG'];

const DATE_OPTIONS = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const WEEKDAY_OPTIONS = { weekday: 'short' } as const;
const CLOCK_OPTIONS = { hour: '2-digit', minute: '2-digit' } as const;

describe('a formatter made once', () => {
  it('writes what toLocaleDateString and toLocaleTimeString write, in every zone and locale', () => {
    for (const zone of ZONES) {
      setZone(zone);
      for (const locale of LOCALES) {
        const date = dateFormatter(locale, DATE_OPTIONS);
        const weekday = dateFormatter(locale, WEEKDAY_OPTIONS);
        const clock = dateFormatter(locale, CLOCK_OPTIONS);
        for (const iso of DATES) {
          const at = new Date(iso);
          const where = `${iso} in ${zone}, ${locale}`;
          expect(date(at), where).toBe(at.toLocaleDateString(locale, DATE_OPTIONS));
          expect(weekday(at), where).toBe(at.toLocaleDateString(locale, WEEKDAY_OPTIONS));
          expect(clock(at), where).toBe(at.toLocaleTimeString(locale, CLOCK_OPTIONS));
        }
      }
    }
  });

  it('says Invalid Date for a date that is not one, as toLocaleDateString does', () => {
    const date = dateFormatter('en-GB', DATE_OPTIONS);
    for (const text of ['', 'soon', '2024-13-45']) {
      const at = new Date(text);
      expect(date(at)).toBe(at.toLocaleDateString('en-GB', DATE_OPTIONS));
      expect(date(at)).toBe('Invalid Date');
    }
  });

  it('follows the device to a new time zone', () => {
    const clock = dateFormatter('en-GB', CLOCK_OPTIONS);
    const at = new Date('2024-05-03T23:30:00Z');
    setZone('Europe/London');
    expect(clock(at)).toBe('00:30');
    setZone('America/New_York');
    expect(clock(at)).toBe('19:30');
    expect(clock(at)).toBe(at.toLocaleTimeString('en-GB', CLOCK_OPTIONS));
    setZone('Asia/Tokyo');
    expect(clock(at)).toBe('08:30');
  });

  it('follows the device to a zone with the same offset in one season but not the other', () => {
    const date = dateFormatter('en-GB', DATE_OPTIONS);
    const summerMidnight = new Date('2024-07-01T23:30:00Z');
    const winterMidnight = new Date('2024-01-01T23:30:00Z');
    // Both on UTC in winter; only London moves its clocks.
    setZone('UTC');
    expect(date(summerMidnight)).toBe('1 Jul 2024');
    setZone('Europe/London');
    expect(date(summerMidnight)).toBe('2 Jul 2024');
    // Both an hour ahead in winter; only Paris moves its clocks.
    setZone('Africa/Lagos');
    expect(date(winterMidnight)).toBe('2 Jan 2024');
    expect(date(new Date('2024-07-01T22:30:00Z'))).toBe('1 Jul 2024');
    setZone('Europe/Paris');
    expect(date(new Date('2024-07-01T22:30:00Z'))).toBe('2 Jul 2024');
  });
});

describe('the app’s dates', () => {
  it('formats release dates as before', () => {
    for (const zone of ZONES) {
      setZone(zone);
      for (const iso of [...DATES, 'not a date']) {
        expect(formatDate(iso), `${iso} in ${zone}`).toBe(
          new Date(iso).toLocaleDateString('en-GB', DATE_OPTIONS),
        );
      }
    }
    setZone('UTC');
    expect(formatDate('2024-05-03T00:00:00.000Z')).toBe('3 May 2024');
  });

  it('names sports days as before', () => {
    const t = ((key: string, values?: { weekday: string; day: number }) =>
      values ? `${key}:${values.weekday} ${values.day}` : key) as unknown as TFunction;
    for (const zone of ZONES) {
      setZone(zone);
      const now = new Date(2024, 4, 3, 21, 0).getTime();
      for (const day of ['2024-05-05', '2024-05-10', '2024-12-31', '2025-01-01', '2024-02-29']) {
        const [year, month, date] = day.split('-').map(Number) as [number, number, number];
        const start = new Date(year, month - 1, date);
        const weekday = start.toLocaleDateString('en-GB', WEEKDAY_OPTIONS);
        expect(dayName(t, day, now), `${day} in ${zone}`).toBe(
          `sports.dayLabel:${weekday} ${start.getDate()}`,
        );
      }
      expect(dayName(t, '2024-05-03', now)).toBe('sports.today');
      expect(dayName(t, '2024-05-04', now)).toBe('sports.tomorrow');
    }
    setZone('UTC');
    expect(dayName(t, '2024-05-10', new Date(2024, 4, 3).getTime())).toBe('sports.dayLabel:Fri 10');
  });
});
