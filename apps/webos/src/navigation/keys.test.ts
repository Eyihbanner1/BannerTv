import { describe, expect, it } from 'vitest';
import { isBackKey, KeyCode } from './keys';

describe('isBackKey', () => {
  it('accepts the LG Back key and its browser stand-ins', () => {
    expect(isBackKey({ keyCode: KeyCode.Back, key: 'Unidentified' })).toBe(true);
    expect(isBackKey({ keyCode: 0, key: 'GoBack' })).toBe(true);
    expect(isBackKey({ keyCode: 27, key: 'Escape' })).toBe(true);
  });

  it('ignores other keys, including Backspace used in text fields', () => {
    expect(isBackKey({ keyCode: 8, key: 'Backspace' })).toBe(false);
    expect(isBackKey({ keyCode: KeyCode.Ok, key: 'Enter' })).toBe(false);
  });
});
