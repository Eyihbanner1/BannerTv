import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from './bytes';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('utf8', () => {
  it('encodes and decodes every width of character', () => {
    const text = 'a£€𝄞 Amélie 東京';
    const encoded = utf8Encode(text);
    expect(Array.from(encoded.slice(0, 10))).toEqual([
      0x61, 0xc2, 0xa3, 0xe2, 0x82, 0xac, 0xf0, 0x9d, 0x84, 0x9e,
    ]);
    expect(utf8Decode(encoded)).toBe(text);
    expect(utf8Encode('')).toEqual(new Uint8Array(0));
  });

  it('turns a lone surrogate into U+FFFD, as TextEncoder does', () => {
    expect(Array.from(utf8Encode('\ud800x'))).toEqual([0xef, 0xbf, 0xbd, 0x78]);
  });

  it('refuses bytes that are not UTF-8', () => {
    for (const bad of [
      bytes(0xc3),
      bytes(0xe2, 0x82),
      bytes(0x80),
      bytes(0xc0, 0x80),
      bytes(0xed, 0xa0, 0x80),
      bytes(0xf4, 0x90, 0x80, 0x80),
      bytes(0xff),
    ]) {
      expect(() => utf8Decode(bad)).toThrow();
    }
  });

  it('decodes text longer than one slice', () => {
    const text = 'x€'.repeat(20000);
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });
});

describe('base64url', () => {
  it('writes without padding, with - and _', () => {
    expect(toBase64Url(bytes())).toBe('');
    expect(toBase64Url(bytes(0xfb))).toBe('-w');
    expect(toBase64Url(bytes(0xfb, 0xff))).toBe('-_8');
    expect(toBase64Url(bytes(0xfb, 0xff, 0xbf))).toBe('-_-_');
    expect(toBase64Url(utf8Encode('hello'))).toBe('aGVsbG8');
  });

  it('reads back what it writes, and nothing else', () => {
    for (let length = 0; length < 40; length++) {
      const data = new Uint8Array(length).map((_, i) => (i * 37 + length) & 255);
      expect(fromBase64Url(toBase64Url(data))).toEqual(data);
    }
    expect(fromBase64Url('aGVsbG8=')).toBeUndefined();
    expect(fromBase64Url('a+b/')).toBeUndefined();
    expect(fromBase64Url('abcde')).toBeUndefined();
  });
});
