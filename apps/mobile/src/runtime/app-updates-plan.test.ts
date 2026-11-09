import { describe, expect, it } from 'vitest';
import {
  CHECK_EVERY_MS,
  checkDue,
  nextStep,
  readyToStart,
  restartRuleFor,
  runningFrom,
  takesUpdates,
  worthFetching,
} from './app-updates-plan';

const NOW = Date.UTC(2026, 10, 9, 14, 5);

describe('which builds take app updates', () => {
  it('a release APK with updates on', () => {
    expect(takesUpdates({ platform: 'android', development: false, enabled: true })).toBe(true);
  });

  it('not an APK built without the certificate, where expo-updates is off', () => {
    expect(takesUpdates({ platform: 'android', development: false, enabled: false })).toBe(false);
  });

  it('not a development build', () => {
    expect(takesUpdates({ platform: 'android', development: true, enabled: true })).toBe(false);
  });

  it("not the web build, whatever expo-updates' web stand-in says", () => {
    expect(takesUpdates({ platform: 'web', development: false, enabled: true })).toBe(false);
  });
});

describe('how often the app checks by itself', () => {
  it('checks the first time', () => {
    expect(checkDue(null, NOW)).toBe(true);
  });

  it('waits fifteen minutes from the last check, Expo’s own at launch included', () => {
    expect(checkDue(NOW, NOW + CHECK_EVERY_MS - 1)).toBe(false);
    expect(checkDue(NOW, NOW + CHECK_EVERY_MS)).toBe(true);
    expect(CHECK_EVERY_MS).toBe(15 * 60_000);
  });

  it('checks when the clock was set back', () => {
    expect(checkDue(NOW, NOW - 1)).toBe(true);
  });
});

describe('what a wish to check leads to', () => {
  it('the app checks only when one is due', () => {
    expect(nextStep('app', 'idle', NOW, NOW + 60_000)).toBe('skip');
    expect(nextStep('app', 'none', NOW, NOW + CHECK_EVERY_MS)).toBe('check');
    expect(nextStep('app', 'failed', null, NOW)).toBe('check');
  });

  it('the person checks whenever they ask', () => {
    expect(nextStep('person', 'none', NOW, NOW + 1)).toBe('check');
    expect(nextStep('person', 'failed', NOW, NOW + 1)).toBe('check');
  });

  it('one check at a time: the person joins the one running, the app leaves it', () => {
    expect(nextStep('person', 'checking', NOW, NOW + 1)).toBe('join');
    expect(nextStep('person', 'downloading', NOW, NOW + 1)).toBe('join');
    expect(nextStep('app', 'checking', NOW, NOW + CHECK_EVERY_MS)).toBe('skip');
    expect(nextStep('app', 'downloading', null, NOW)).toBe('skip');
  });

  it('none once an update waits: the person is offered the restart instead', () => {
    expect(nextStep('app', 'ready', NOW, NOW + CHECK_EVERY_MS)).toBe('skip');
    expect(nextStep('person', 'ready', NOW, NOW + 1)).toBe('offer');
  });
});

describe('when a downloaded update starts', () => {
  it('one the app found starts at the next safe moment', () => {
    expect(restartRuleFor('app')).toBe('update');
  });

  it('one the person asked for waits for them, or for the app to be off screen', () => {
    expect(restartRuleFor('person')).toBe('offScreen');
  });

  it('a new update or a way back to the built-in code is fetched and started', () => {
    expect(worthFetching({ isAvailable: true, isRollBackToEmbedded: false })).toBe(true);
    expect(worthFetching({ isAvailable: false, isRollBackToEmbedded: true })).toBe(true);
    expect(worthFetching({ isAvailable: false, isRollBackToEmbedded: false })).toBe(false);
    expect(readyToStart({ isNew: true, isRollBackToEmbedded: false })).toBe(true);
    expect(readyToStart({ isNew: false, isRollBackToEmbedded: true })).toBe(true);
    expect(readyToStart({ isNew: false, isRollBackToEmbedded: false })).toBe(false);
  });
});

describe('what Settings says the app runs', () => {
  const update = {
    isEmbeddedLaunch: false,
    updateId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    createdAt: new Date(NOW),
  };

  it('an update, by the start of its id and when it was published', () => {
    const running = runningFrom(true, update);
    expect(running).toEqual({
      kind: 'update',
      id: '1a2b3c4d',
      published: expect.stringMatching(/^9 Nov 2026, \d\d:\d\d$/),
    });
  });

  it('an update that does not say when it was published', () => {
    expect(runningFrom(true, { ...update, createdAt: null })).toEqual({
      kind: 'update',
      id: '1a2b3c4d',
      published: null,
    });
    expect(runningFrom(true, { ...update, createdAt: new Date(NaN) })).toMatchObject({
      published: null,
    });
  });

  it('the built-in code, and always in a build that takes no updates', () => {
    expect(runningFrom(true, { ...update, isEmbeddedLaunch: true })).toEqual({ kind: 'builtIn' });
    expect(runningFrom(true, { ...update, updateId: null })).toEqual({ kind: 'builtIn' });
    expect(runningFrom(false, update)).toEqual({ kind: 'builtIn' });
  });
});
