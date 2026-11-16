import { describe, expect, it } from 'vitest';
import { FAKE_SUBDL_KEY } from './fixtures';
import { cleanSubdlKey, readSubdlKey } from './key';

describe('cleanSubdlKey', () => {
  it('trims a key', () => {
    expect(cleanSubdlKey(`  ${FAKE_SUBDL_KEY}\n`)).toBe(FAKE_SUBDL_KEY);
    expect(cleanSubdlKey('abc_DEF-12')).toBe('abc_DEF-12');
  });

  it('refuses spaces inside, under 8, over 128 and other characters', () => {
    expect(cleanSubdlKey('FAKE SUBDL KEY')).toBeNull();
    expect(cleanSubdlKey('short12')).toBeNull();
    expect(cleanSubdlKey('a'.repeat(128))).toBe('a'.repeat(128));
    expect(cleanSubdlKey('a'.repeat(129))).toBeNull();
    expect(cleanSubdlKey('FAKE.SUBDL.KEY')).toBeNull();
    expect(cleanSubdlKey('FAKE-KEY-é000')).toBeNull();
    expect(cleanSubdlKey('')).toBeNull();
  });
});

describe('readSubdlKey', () => {
  it('reads a saved record', () => {
    expect(readSubdlKey({ key: FAKE_SUBDL_KEY, state: 'works' })).toEqual({
      key: FAKE_SUBDL_KEY,
      state: 'works',
    });
    expect(readSubdlKey({ key: FAKE_SUBDL_KEY, state: 'odd' })).toEqual({
      key: FAKE_SUBDL_KEY,
      state: 'unchecked',
    });
  });

  it('gives null for a bad shape', () => {
    for (const saved of [null, 'text', 3, [], {}, { key: 5 }, { key: 'bad key' }]) {
      expect(readSubdlKey(saved)).toBeNull();
    }
  });
});
