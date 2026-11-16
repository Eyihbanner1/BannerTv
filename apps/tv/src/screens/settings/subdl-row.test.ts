import { describe, expect, it } from 'vitest';
import { subdlRowValue } from './subdl-row';

describe('subdlRowValue', () => {
  it('is on with a key SubDL has not refused', () => {
    expect(subdlRowValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'works' })).toBe('on');
    expect(subdlRowValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'unchecked' })).toBe('on');
  });

  it('says a refused key was not accepted', () => {
    expect(subdlRowValue({ key: 'FAKE-SUBDL-KEY-0000', state: 'refused' })).toBe('refused');
  });

  it('is off with no key', () => {
    expect(subdlRowValue(null)).toBe('off');
  });
});
