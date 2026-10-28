import type { KickOff } from './types';

/**
 * Kick-off times as sports addons write them, and the TV's own calendar.
 * Days are local calendar days worked out with local dates, never by adding
 * 24 hours, so the Sundays the clocks change group correctly.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function monthOf(name: string): number | undefined {
  const lower = name.toLowerCase();
  return MONTHS[lower.slice(0, 4)] ?? MONTHS[lower.slice(0, 3)];
}

/**
 * Abbreviations that name an offset, as minutes east of UTC. All of them
 * count as unsure (docs/PLAN.md, Time): IST alone is India or Ireland, CST
 * is China or the US. The US forms that move with summer time name a zone.
 */
const ABBREVIATIONS: Record<string, number | string> = {
  BST: 60,
  IST: 330,
  CET: 60,
  CEST: 120,
  WET: 0,
  WEST: 60,
  EET: 120,
  EEST: 180,
  MSK: 180,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  ET: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  PT: 'America/Los_Angeles',
  AEST: 600,
  AEDT: 660,
  ACST: 570,
  AWST: 480,
  NZST: 720,
  NZDT: 780,
  JST: 540,
  KST: 540,
  SGT: 480,
  HKT: 480,
  BRT: -180,
  ART: -180,
  SAST: 120,
  WAT: 60,
  EAT: 180,
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour12: false,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      // Older engines accept the option and ignore it; formatToParts is needed below.
      if (typeof formatter.formatToParts !== 'function') formatter = null;
    } catch {
      formatter = null;
    }
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** Whether this engine can convert times in the named zone. */
export function knowsZone(zone: string): boolean {
  return formatterFor(zone) !== null;
}

/** Minutes east of UTC in `zone` at `at`, or undefined when the engine does not know the zone. */
export function zoneOffset(zone: string, at: number): number | undefined {
  if (zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT') return 0;
  const formatter = formatterFor(zone);
  if (!formatter) return undefined;
  const parts: Record<string, number> = {};
  try {
    for (const part of formatter.formatToParts(new Date(at))) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
  } catch {
    return undefined;
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    hour!,
    parts.minute!,
    parts.second!,
  );
  if (isNaN(asUtc)) return undefined;
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / MINUTE);
}

/** A wall-clock time in a zone as a UTC instant, or undefined when the zone is unknown. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  zone: string,
): number | undefined {
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const first = zoneOffset(zone, guess);
  if (first === undefined) return undefined;
  let at = guess - first * MINUTE;
  const second = zoneOffset(zone, at);
  if (second !== undefined && second !== first) at = guess - second * MINUTE;
  return at;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** The TV's local calendar date of an instant, YYYY-MM-DD. */
export function localDate(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return [year, month, day];
}

/** When a local calendar date starts on the TV, in ms. */
export function localDayStart(date: string): number {
  const [year, month, day] = dateParts(date);
  return new Date(year, month - 1, day).getTime();
}

/** The local calendar date `days` after `date`. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = dateParts(date);
  return localDate(new Date(year, month - 1, day + days, 12).getTime());
}

/** 24-hour local time, "20:00". */
export function localClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The calendar date of an instant in a zone, such as the addon's "today". */
function dateIn(at: number, zone: Zone): [number, number, number] {
  const offset = (zone.name ? zoneOffset(zone.name, at) : zone.offset) ?? 0;
  const shifted = new Date(at + offset * MINUTE);
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}

/** Hours and minutes from "19:45", "7.45pm", "10:00 PM". */
function clockOf(hours: string, minutes: string, meridiem: string | undefined): [number, number] {
  let h = Number(hours);
  const m = Number(minutes);
  if (meridiem) {
    const pm = meridiem.toLowerCase() === 'pm';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return [h, m];
}

const ZONE_PART =
  '(?:(UTC|GMT|Z)(?:\\s*([+-])\\s*(\\d{1,2})(?::?(\\d{2}))?)?|([+-])(\\d{2}):?(\\d{2})|\\(?([A-Za-z]+\\/[A-Za-z_]+(?:\\/[A-Za-z_]+)?)\\)?|\\b([A-Z]{2,5})\\b)?';

// "28 Oct 2026 · 20:00 UTC", "28 October 2026, 8:00 pm BST".
const DAY_MONTH_YEAR = new RegExp(
  `\\b(\\d{1,2})\\s+([A-Za-z]{3,9})\\.?,?\\s+(\\d{4})\\s*[·•,@|\\-–]?\\s*(\\d{1,2})[:.](\\d{2})\\s*([ap]m)?\\s*${ZONE_PART}`,
  'i',
);
// "Oct 28, 2026 8:00 PM ET".
const MONTH_DAY_YEAR = new RegExp(
  `\\b([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\s*[·•,@|\\-–]?\\s*(\\d{1,2})[:.](\\d{2})\\s*([ap]m)?\\s*${ZONE_PART}`,
  'i',
);
// "2026-10-28 20:00 UTC", "2026-10-28T20:00:00Z".
const ISO_LIKE = new RegExp(
  `\\b(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::\\d{2}(?:\\.\\d+)?)?\\s*${ZONE_PART}`,
);
// "28/10/2026 20:00", "28.10.2026 20:00 CET".
const DAY_FIRST = new RegExp(
  `\\b(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4})[ ,]+(\\d{1,2})[:.](\\d{2})\\s*([ap]m)?\\s*${ZONE_PART}`,
  'i',
);
// The whole label is a time: "19:45", "10:00 PM", "11:00 PM (America/New_York)", "7.45pm".
const CLOCK_ONLY = new RegExp(`^\\s*(\\d{1,2})[:.](\\d{2})\\s*([ap]m)?\\s*${ZONE_PART}\\s*$`, 'i');
// Dates without a time.
const DATE_ONLY = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
] as const;
const DAY_MONTH_YEAR_DATE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/;

interface Zone {
  /** Minutes east of UTC, fixed. */
  offset?: number;
  /** A named zone. */
  name?: string;
  sure: boolean;
}

/** The zone written after a time, from the capture groups of ZONE_PART starting at `i`. */
function zoneFrom(match: RegExpExecArray, i: number): Zone | undefined {
  const [utc, utcSign, utcHours, utcMinutes, sign, hours, minutes, named, abbreviation] =
    match.slice(i, i + 9);
  if (utc) {
    if (!utcSign) return { offset: 0, sure: true };
    const offset = Number(utcHours) * 60 + Number(utcMinutes ?? 0);
    return { offset: utcSign === '-' ? -offset : offset, sure: true };
  }
  if (sign) {
    const offset = Number(hours) * 60 + Number(minutes);
    return { offset: sign === '-' ? -offset : offset, sure: true };
  }
  if (named) return knowsZone(named) ? { name: named, sure: true } : undefined;
  if (abbreviation) {
    const known = ABBREVIATIONS[abbreviation.toUpperCase()];
    if (typeof known === 'number') return { offset: known, sure: false };
    if (typeof known === 'string' && knowsZone(known)) return { name: known, sure: false };
  }
  return undefined;
}

function instant(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  zone: Zone,
): number | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) {
    return undefined;
  }
  if (zone.name) return zonedTime(year, month, day, hours, minutes, zone.name);
  return Date.UTC(year, month - 1, day, hours, minutes) - (zone.offset ?? 0) * MINUTE;
}

export interface TimeContext {
  now: number;
  /** The zone the addon's install address names, if any. */
  zone?: string;
}

/** The addon's zone as a Zone, sure because the user's own settings named it. */
function addonZone(context: TimeContext): Zone | undefined {
  return context.zone ? { name: context.zone, sure: true } : undefined;
}

/** A date and time written out in text, with or without a zone. */
export function readDatedText(text: string, context: TimeContext): KickOff | undefined {
  const forms: Array<[RegExp, (m: RegExpExecArray) => [number, number, number] | undefined]> = [
    [DAY_MONTH_YEAR, (m) => [Number(m[3]), monthOf(m[2]!) ?? 0, Number(m[1])]],
    [MONTH_DAY_YEAR, (m) => [Number(m[3]), monthOf(m[1]!) ?? 0, Number(m[2])]],
    [ISO_LIKE, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [DAY_FIRST, (m) => [Number(m[3]), Number(m[2]), Number(m[1])]],
  ];
  for (const [pattern, date] of forms) {
    const match = pattern.exec(text);
    if (!match) continue;
    const ymd = date(match);
    if (!ymd || ymd[1] === 0) continue;
    const meridiem = pattern === ISO_LIKE ? undefined : match[6];
    const zoneIndex = pattern === ISO_LIKE ? 6 : 7;
    const [hours, minutes] = clockOf(match[4]!, match[5]!, meridiem);
    // No zone written: the addon's own, else assume UTC and say it is unsure.
    const zone = zoneFrom(match, zoneIndex) ?? addonZone(context) ?? { offset: 0, sure: false };
    const at = instant(ymd[0], ymd[1], ymd[2], hours, minutes, zone);
    if (at === undefined) continue;
    return { at, sure: zone.sure, source: 'dated-text' };
  }
  return undefined;
}

/** A label that is only a time, read in the zone it names or the addon's zone. */
export function readClock(text: string, context: TimeContext): KickOff | undefined {
  const match = CLOCK_ONLY.exec(text);
  if (!match) return undefined;
  const [hours, minutes] = clockOf(match[1]!, match[2]!, match[3]);
  // No zone is assumed: an unknown one leaves the time unknown (docs/PLAN.md, Time).
  const zone = zoneFrom(match, 4) ?? addonZone(context);
  if (!zone) return undefined;
  // A clock has no date: today in the addon's zone, unless that is long gone
  // ("00:30" seen at 23:30 is tomorrow's) or nearly a day away ("23:00" seen
  // at 00:30 is last night's, still listed).
  let shift = 0;
  const on = (days: number) => {
    const [year, month, day] = dateIn(context.now + days * DAY, zone);
    return instant(year, month, day, hours, minutes, zone);
  };
  const today = on(0);
  if (today !== undefined && today < context.now - 12 * HOUR) shift = 1;
  else if (today !== undefined && today > context.now + 20 * HOUR) shift = -1;
  const best = shift === 0 ? today : on(shift);
  return best === undefined ? undefined : { at: best, sure: zone.sure, source: 'clock' };
}

/** A clock with a day and month in an item's name ("⏰ 19:45 - 27/10"), in the addon's zone. */
export function readNameClock(
  clock: { hours: number; minutes: number; day?: number; month?: number; year?: number },
  context: TimeContext,
): KickOff | undefined {
  const zone = addonZone(context);
  if (!zone || clock.day === undefined || clock.month === undefined) return undefined;
  const [nowYear] = dateIn(context.now, zone);
  // No year: the one that puts the date nearest to now.
  const years = clock.year !== undefined ? [clock.year] : [nowYear - 1, nowYear, nowYear + 1];
  let best: number | undefined;
  for (const year of years) {
    const at = instant(year, clock.month, clock.day, clock.hours, clock.minutes, zone);
    if (
      at !== undefined &&
      (best === undefined || Math.abs(at - context.now) < Math.abs(best - context.now))
    ) {
      best = at;
    }
  }
  return best === undefined ? undefined : { at: best, sure: true, source: 'name-clock' };
}

/** A date with no time, as YYYY-MM-DD, from the forms addons use. */
export function readDateOnly(text: string): KickOff | undefined {
  for (const [index, pattern] of DATE_ONLY.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [year, month, day] =
      index === 0
        ? [Number(match[1]), Number(match[2]), Number(match[3])]
        : [Number(match[3]), Number(match[2]), Number(match[1])];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { date: `${year}-${pad(month)}-${pad(day)}`, sure: true, source: 'date-only' };
    }
  }
  const named = DAY_MONTH_YEAR_DATE.exec(text);
  const month = named ? monthOf(named[2]!) : undefined;
  if (named && month !== undefined) {
    return {
      date: `${named[3]}-${pad(month)}-${pad(Number(named[1]))}`,
      sure: true,
      source: 'date-only',
    };
  }
  return undefined;
}

/**
 * `released`: a kick-off, unless it is a fetch time (seconds or milliseconds
 * set) or, on a replay or with no time written, midnight for a date only.
 */
export function readReleased(released: string, replay: boolean): KickOff | undefined {
  const at = Date.parse(released);
  if (isNaN(at)) return undefined;
  if (at % MINUTE !== 0) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(released.trim());
  if (dateOnly || (replay && at % (24 * HOUR) === 0)) {
    return { date: new Date(at).toISOString().slice(0, 10), sure: true, source: 'date-only' };
  }
  return { at, sure: true, source: 'released' };
}

// Any "HH:MM" in a text, to check another key's time against.
const ANY_CLOCK = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;

function clocksIn(text: string): number[] {
  const found: number[] = [];
  ANY_CLOCK.lastIndex = 0;
  for (let match = ANY_CLOCK.exec(text); match; match = ANY_CLOCK.exec(text)) {
    found.push(Number(match[1]) * 60 + Number(match[2]));
  }
  return found;
}

function minutesOfDay(at: number, offset: number): number {
  const shifted = new Date(at + offset * MINUTE);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * A start time under a non-standard key: epoch digits, or ISO text checked
 * against any clock in the item's name or description, and dropped when it
 * disagrees (one addon's `eventStart` is an hour early).
 */
export function readStartKey(
  start: string,
  checkText: string,
  context: TimeContext,
): KickOff | undefined {
  if (/^\d{10}$/.test(start)) return { at: Number(start) * 1000, sure: true, source: 'epoch' };
  if (/^\d{13}$/.test(start)) return { at: Number(start), sure: true, source: 'epoch' };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start)) return undefined;
  const at = Date.parse(start);
  if (isNaN(at)) return undefined;
  const clocks = clocksIn(checkText);
  if (clocks.length === 0) return { at, sure: false, source: 'iso-key' };
  const offsets = [0, -new Date(at).getTimezoneOffset()];
  const zoned = context.zone ? zoneOffset(context.zone, at) : undefined;
  if (zoned !== undefined) offsets.push(zoned);
  const agrees = offsets.some((offset) => {
    const minutes = minutesOfDay(at, offset);
    return clocks.some((clock) => Math.abs(clock - minutes) <= 2);
  });
  return agrees ? { at, sure: true, source: 'iso-key' } : undefined;
}

export interface TimeInput {
  released?: string;
  releaseInfo?: string;
  description?: string;
  /** The clock cleanTitle found in the name. */
  nameClock?: { hours: number; minutes: number; day?: number; month?: number; year?: number };
  /** The item's name, for date-only forms such as "… 26.10.2026". */
  name: string;
  start?: string;
  replay: boolean;
}

/**
 * The kick-off, best source first (docs/PLAN.md, Time, live and finished).
 * Numbers inside ids are never read: some are first-seen stamps, and some
 * dates in them are a day off.
 */
export function readKickOff(input: TimeInput, context: TimeContext): KickOff | undefined {
  const texts = [input.releaseInfo, input.description].filter(
    (text): text is string => text !== undefined,
  );
  if (input.released) {
    const released = readReleased(input.released, input.replay);
    if (released?.at !== undefined) return released;
  }
  for (const text of texts) {
    const dated = readDatedText(text, context);
    if (dated) return dated;
  }
  if (input.nameClock) {
    const named = readNameClock(input.nameClock, context);
    if (named) return named;
  }
  if (input.start) {
    const keyed = readStartKey(input.start, `${input.name}\n${input.description ?? ''}`, context);
    if (keyed) return keyed;
  }
  if (input.releaseInfo) {
    const clock = readClock(input.releaseInfo, context);
    if (clock) return clock;
  }
  if (input.released) {
    const released = readReleased(input.released, input.replay);
    if (released) return released;
  }
  for (const text of texts.concat(input.name)) {
    const date = readDateOnly(text);
    if (date) return date;
  }
  return undefined;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to text, one byte per character: enough to find an ASCII setting. Throws on bad input. */
function decodeBase64(text: string): string {
  const clean = text.replace(/=+$/, '');
  let out = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const digit = BASE64.indexOf(clean.charAt(i));
    if (digit === -1) throw new Error('Not base64');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * The zone an addon's install address names, from a `timezone` or `tz`
 * setting, plain or in an encoded settings segment. Only that one value is
 * read; the rest of the settings is never kept.
 */
export function zoneFromAddress(transportUrl: string): string | undefined {
  const candidates: string[] = [];
  for (const segment of transportUrl.split(/[/?&#]/)) {
    let text = segment;
    try {
      text = decodeURIComponent(segment);
    } catch {
      // Leave it as it was.
    }
    candidates.push(text);
    // Settings are often base64 JSON in one path segment.
    if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(segment)) {
      try {
        candidates.push(decodeBase64(segment.replace(/-/g, '+').replace(/_/g, '/')));
      } catch {
        // Not base64.
      }
    }
  }
  for (const text of candidates) {
    const match =
      /(?:^|[^a-z])(?:timezone|time_zone|tz)"?\s*[:=]\s*"?([A-Za-z]+(?:\/[A-Za-z_+-]+){1,2}|UTC)/i.exec(
        text,
      );
    if (match && knowsZone(match[1]!)) return match[1];
  }
  return undefined;
}
