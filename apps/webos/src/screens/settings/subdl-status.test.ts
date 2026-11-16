import { describe, expect, it } from 'vitest';
import { subdlStatus, subdlSettingsValue } from './subdl-status';

describe('the SubDL screen status line', () => {
  it("shows the check's result first", () => {
    expect(subdlStatus('works', 'refused', 'busy')).toBe('works');
    expect(subdlStatus('checking', 'unchecked', null)).toBe('checking');
    expect(subdlStatus('removed', null, null)).toBe('removed');
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

describe("the SubDL row's value in Settings", () => {
  it('is On, Off or Key not accepted', () => {
    expect(subdlSettingsValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'works' })).toBe('on');
    expect(subdlSettingsValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'unchecked' })).toBe('on');
    expect(subdlSettingsValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'refused' })).toBe('refused');
    expect(subdlSettingsValue(null)).toBe('off');
  });
});
