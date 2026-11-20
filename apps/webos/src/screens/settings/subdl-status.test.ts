import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import { type SubdlStatus, subdlStatus, subdlStatusKey, subdlSettingsValue } from './subdl-status';

describe('the SubDL screen status line', () => {
  it("shows the check's result first", () => {
    expect(subdlStatus('works', 'refused', 'busy')).toBe('works');
    expect(subdlStatus('checking', 'unchecked', null)).toBe('checking');
    expect(subdlStatus('removed', null, null)).toBe('removed');
    expect(subdlStatus('phoneChecking', 'unchecked', null)).toBe('phoneChecking');
    expect(subdlStatus('phoneFailed', 'works', 'busy')).toBe('phoneFailed');
  });

  it('then a refused key, then a rest', () => {
    expect(subdlStatus(null, 'refused', 'busy')).toBe('refused');
    expect(subdlStatus(null, 'works', 'busy')).toBe('resting');
    expect(subdlStatus(null, 'works', 'failing')).toBe('resting');
    expect(subdlStatus(null, 'unchecked', 'limit')).toBe('usedUp');
  });

  it('shows nothing otherwise, nor a rest with no key', () => {
    expect(subdlStatus(null, 'works', null)).toBeNull();
    expect(subdlStatus(null, null, 'busy')).toBeNull();
  });
});

/** Every status line: a new one fails the typecheck here until it is added. */
const STATUSES: Record<SubdlStatus, true> = {
  badFormat: true,
  checking: true,
  works: true,
  refused: true,
  unreachable: true,
  removed: true,
  phoneChecking: true,
  phoneFailed: true,
  resting: true,
  usedUp: true,
};

describe("the status line's strings", () => {
  it('has a string for every status', () => {
    for (const status of Object.keys(STATUSES) as SubdlStatus[]) {
      const value = subdlStatusKey(status)
        .split('.')
        .reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], en);
      expect(typeof value, status).toBe('string');
    }
    expect(subdlStatusKey('phoneChecking')).toBe('subdl.phone.checking');
    expect(subdlStatusKey('works')).toBe('subdl.works');
  });
});

describe("the SubDL row's value in Settings", () => {
  it('is On, Off or Key not accepted', () => {
    expect(subdlSettingsValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'works' })).toBe('on');
    expect(subdlSettingsValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'unchecked' })).toBe('on');
    expect(subdlSettingsValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'refused' })).toBe('refused');
    expect(subdlSettingsValue(null)).toBe('off');
  });
});
