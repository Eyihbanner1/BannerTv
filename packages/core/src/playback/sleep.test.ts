import { describe, expect, it } from 'vitest';
import {
  addSleepTime,
  nextSleepCheck,
  SLEEP_ADD_MS,
  SLEEP_CHOICES,
  SLEEP_SKIPS_NEXT_MS,
  SLEEP_WARN_MS,
  type SleepMedia,
  sleepPhase,
  type SleepTimer,
  startSleep,
  stopsBeforeNext,
} from './sleep';

const NOW = Date.parse('2026-06-01T22:00:00Z');
const MIN = 60_000;
const OFF: SleepTimer = { choice: 'off', endsAt: null };
const playing: SleepMedia = { remainingS: 1200, ended: false, live: false };

describe('startSleep', () => {
  it('sets a deadline for a minutes choice', () => {
    expect(startSleep(30, NOW)).toEqual({ choice: 30, endsAt: NOW + 30 * MIN });
    expect(startSleep(15, NOW).endsAt).toBe(NOW + 15 * MIN);
    expect(startSleep(45, NOW).endsAt).toBe(NOW + 45 * MIN);
    expect(startSleep(90, NOW).endsAt).toBe(NOW + 90 * MIN);
  });

  it('has no deadline for off and for the end of the video', () => {
    expect(startSleep('off', NOW)).toEqual(OFF);
    expect(startSleep('end', NOW)).toEqual({ choice: 'end', endsAt: null });
  });

  it('starts again from now when the same choice is picked again', () => {
    expect(startSleep(30, NOW + 10 * MIN).endsAt).toBe(NOW + 40 * MIN);
  });

  it('offers 15 to 90 minutes, then the end of the video', () => {
    expect(SLEEP_CHOICES).toEqual(['off', 15, 30, 45, 60, 90, 'end']);
  });
});

describe('sleepPhase, minutes', () => {
  const timer = startSleep(30, NOW);

  it('counts, warns in the last minute, and is due at the deadline', () => {
    expect(sleepPhase(timer, NOW, playing)).toBe('counting');
    expect(sleepPhase(timer, NOW + 29 * MIN - 1, playing)).toBe('counting');
    expect(sleepPhase(timer, NOW + 29 * MIN, playing)).toBe('warning');
    expect(sleepPhase(timer, NOW + 30 * MIN - 1, playing)).toBe('warning');
    expect(sleepPhase(timer, NOW + 30 * MIN, playing)).toBe('due');
    expect(sleepPhase(timer, NOW + 2 * 60 * MIN, playing)).toBe('due');
  });

  it('runs on the wall clock, whatever the video is doing', () => {
    const paused: SleepMedia = { remainingS: 10, ended: false, live: false };
    const ended: SleepMedia = { remainingS: 0, ended: true, live: false };
    const live: SleepMedia = { remainingS: NaN, ended: false, live: true };
    expect(sleepPhase(timer, NOW, paused)).toBe('counting');
    expect(sleepPhase(timer, NOW, ended)).toBe('counting');
    expect(sleepPhase(timer, NOW + 30 * MIN, live)).toBe('due');
  });

  it('keeps counting to the warning and the deadline while paused or ended', () => {
    const paused: SleepMedia = { remainingS: 600, ended: false, live: false };
    const ended: SleepMedia = { remainingS: 0, ended: true, live: false };
    expect(sleepPhase(timer, NOW + 29.5 * MIN, paused)).toBe('warning');
    expect(sleepPhase(timer, NOW + 30 * MIN, paused)).toBe('due');
    expect(sleepPhase(timer, NOW + 29.5 * MIN, ended)).toBe('warning');
    expect(sleepPhase(timer, NOW + 30 * MIN, ended)).toBe('due');
  });

  it('is off when off, or with no deadline', () => {
    expect(sleepPhase(OFF, NOW, playing)).toBe('off');
    expect(sleepPhase({ choice: 30, endsAt: null }, NOW, playing)).toBe('off');
  });
});

describe('sleepPhase, end of the video', () => {
  const timer = startSleep('end', NOW);
  const media = (change: Partial<SleepMedia>): SleepMedia => ({ ...playing, ...change });

  it('counts until the last minute of the video, then warns', () => {
    expect(sleepPhase(timer, NOW, media({ remainingS: 61 }))).toBe('counting');
    expect(sleepPhase(timer, NOW, media({ remainingS: 60 }))).toBe('warning');
    expect(sleepPhase(timer, NOW, media({ remainingS: 0 }))).toBe('warning');
    // Past a length that was reported too short.
    expect(sleepPhase(timer, NOW, media({ remainingS: -3 }))).toBe('warning');
  });

  it('is due only once the video has ended', () => {
    expect(sleepPhase(timer, NOW, media({ remainingS: 0, ended: true }))).toBe('due');
    expect(sleepPhase(timer, NOW + 5 * 60 * MIN, playing)).toBe('counting');
  });

  it('warns in the last minute of watching time at other speeds', () => {
    expect(sleepPhase(timer, NOW, media({ remainingS: 90, rate: 1.5 }))).toBe('warning');
    expect(sleepPhase(timer, NOW, media({ remainingS: 91, rate: 1.5 }))).toBe('counting');
    expect(sleepPhase(timer, NOW, media({ remainingS: 40, rate: 0.5 }))).toBe('counting');
    expect(sleepPhase(timer, NOW, media({ remainingS: 30, rate: 0.5 }))).toBe('warning');
  });

  it('reads a speed that is not positive as normal speed', () => {
    expect(sleepPhase(timer, NOW, media({ remainingS: 61, rate: 0 }))).toBe('counting');
    expect(sleepPhase(timer, NOW, media({ remainingS: 60, rate: NaN }))).toBe('warning');
  });

  it('only counts while the length is unknown, and is still due at the end', () => {
    expect(sleepPhase(timer, NOW, media({ remainingS: Infinity }))).toBe('counting');
    expect(sleepPhase(timer, NOW, media({ remainingS: NaN }))).toBe('counting');
    expect(sleepPhase(timer, NOW, media({ remainingS: NaN, ended: true }))).toBe('due');
  });

  it('is off on live, where the end is not known', () => {
    const live = media({ remainingS: NaN, live: true });
    expect(sleepPhase(timer, NOW, live)).toBe('off');
    expect(sleepPhase(timer, NOW, { ...live, remainingS: 10 })).toBe('off');
    expect(sleepPhase(timer, NOW, { ...live, ended: true })).toBe('off');
  });
});

describe('addSleepTime', () => {
  it('adds 15 minutes to the deadline while it is ahead', () => {
    const timer = startSleep(30, NOW);
    const warning = NOW + 29.5 * MIN;
    expect(addSleepTime(timer, warning)).toEqual({ choice: 30, endsAt: NOW + 45 * MIN });
    expect(SLEEP_ADD_MS).toBe(15 * MIN);
  });

  it('adds 15 minutes from now once the deadline has passed', () => {
    const timer = startSleep(15, NOW);
    const late = NOW + 20 * MIN;
    expect(addSleepTime(timer, late).endsAt).toBe(late + 15 * MIN);
  });

  it('adds up when pressed again', () => {
    const once = addSleepTime(startSleep(15, NOW), NOW + 14.5 * MIN);
    expect(addSleepTime(once, NOW + 14.6 * MIN).endsAt).toBe(NOW + 45 * MIN);
  });

  it('leaves an end-of-video or off timer as it is', () => {
    const end = startSleep('end', NOW);
    expect(addSleepTime(end, NOW)).toBe(end);
    expect(addSleepTime(OFF, NOW)).toBe(OFF);
  });

  it('takes the timer out of its warning', () => {
    const timer = startSleep(30, NOW);
    const warning = NOW + 29.5 * MIN;
    expect(sleepPhase(timer, warning, playing)).toBe('warning');
    expect(sleepPhase(addSleepTime(timer, warning), warning, playing)).toBe('counting');
  });
});

describe('nextSleepCheck', () => {
  const timer = startSleep(30, NOW);

  it('gives the time to the warning, then to the deadline', () => {
    expect(nextSleepCheck(timer, NOW)).toBe(29 * MIN);
    expect(nextSleepCheck(timer, NOW + 10 * MIN)).toBe(19 * MIN);
    expect(nextSleepCheck(timer, NOW + 29 * MIN - 1)).toBe(1);
    expect(nextSleepCheck(timer, NOW + 29 * MIN)).toBe(SLEEP_WARN_MS);
    expect(nextSleepCheck(timer, NOW + 29.5 * MIN)).toBe(0.5 * MIN);
  });

  it('lands exactly on each change of phase', () => {
    let now = NOW;
    const phases = [sleepPhase(timer, now, playing)];
    // A few checks at most, so a check that never ends fails rather than hangs.
    for (let check = 0; check < 5; check++) {
      const wait = nextSleepCheck(timer, now);
      if (wait === null) break;
      expect(wait).toBeGreaterThan(0);
      now += wait;
      phases.push(sleepPhase(timer, now, playing));
    }
    expect(phases).toEqual(['counting', 'warning', 'due']);
    expect(now).toBe(NOW + 30 * MIN);
  });

  it('is null once due, and for off and end-of-video timers', () => {
    expect(nextSleepCheck(timer, NOW + 30 * MIN)).toBeNull();
    expect(nextSleepCheck(timer, NOW + 31 * MIN)).toBeNull();
    expect(nextSleepCheck(OFF, NOW)).toBeNull();
    expect(nextSleepCheck(startSleep('end', NOW), NOW)).toBeNull();
    expect(nextSleepCheck({ choice: 30, endsAt: null }, NOW)).toBeNull();
  });
});

describe('stopsBeforeNext', () => {
  it('stops at the end of this video for an end-of-video timer', () => {
    expect(stopsBeforeNext(startSleep('end', NOW), NOW)).toBe(true);
  });

  it('stops when under 5 minutes are left on a minutes timer', () => {
    const timer = startSleep(30, NOW);
    expect(SLEEP_SKIPS_NEXT_MS).toBe(5 * MIN);
    expect(stopsBeforeNext(timer, NOW + 25 * MIN - 1)).toBe(false);
    expect(stopsBeforeNext(timer, NOW + 25 * MIN)).toBe(false);
    expect(stopsBeforeNext(timer, NOW + 25 * MIN + 1)).toBe(true);
    expect(stopsBeforeNext(timer, NOW + 30 * MIN)).toBe(true);
    expect(stopsBeforeNext(timer, NOW + 31 * MIN)).toBe(true);
  });

  it('counts the 5 minutes from the deadline after Add 15 min', () => {
    const added = addSleepTime(startSleep(15, NOW), NOW + 14.5 * MIN);
    expect(stopsBeforeNext(added, NOW + 14.5 * MIN)).toBe(false);
    expect(stopsBeforeNext(added, NOW + 26 * MIN)).toBe(true);
  });

  it('never stops for an off timer', () => {
    expect(stopsBeforeNext(OFF, NOW)).toBe(false);
    expect(stopsBeforeNext({ choice: 30, endsAt: null }, NOW)).toBe(false);
  });
});
