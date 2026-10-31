import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeClone, encodeClone } from './codec';

const roundTrip = (value: unknown) => decodeClone(encodeClone(value));

describe('the structured clone codec', () => {
  it('keeps plain JSON as it is', () => {
    const value = { a: 1, b: 'two', c: [true, null, { d: 4.5 }], e: {} };
    expect(roundTrip(value)).toEqual(value);
    expect(roundTrip('text')).toBe('text');
    expect(roundTrip(0)).toBe(0);
    expect(roundTrip(null)).toBeNull();
  });

  it('keeps byte arrays, buffers, dates, maps and sets', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 7]);
    const value = roundTrip({
      bytes,
      buffer: bytes.buffer.slice(0),
      when: new Date(1_700_000_000_000),
      map: new Map<unknown, unknown>([['k', new Uint8Array([9])]]),
      set: new Set([1, 'two']),
    }) as Record<string, unknown>;
    expect(value.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(value.bytes as Uint8Array)).toEqual(Array.from(bytes));
    expect(value.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(value.buffer as ArrayBuffer))).toEqual(Array.from(bytes));
    expect((value.when as Date).getTime()).toBe(1_700_000_000_000);
    const map = value.map as Map<string, Uint8Array>;
    expect(Array.from(map.get('k')!)).toEqual([9]);
    expect(value.set).toEqual(new Set([1, 'two']));
  });

  it('keeps undefined in arrays, the top-level undefined and non-finite numbers', () => {
    expect(roundTrip([1, undefined, 3])).toEqual([1, undefined, 3]);
    expect(roundTrip(undefined)).toBeUndefined();
    expect(roundTrip([NaN, Infinity, -Infinity])).toEqual([NaN, Infinity, -Infinity]);
  });

  it('never turns a stored object that looks like a tag into something else', () => {
    const sneaky = { $bt: 'u8', v: 'AAAA' };
    expect(roundTrip(sneaky)).toEqual(sneaky);
    expect(roundTrip({ nested: sneaky })).toEqual({ nested: sneaky });
  });

  it('reads byte views at their own offset', () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5]);
    const view = backing.subarray(1, 4);
    expect(Array.from(roundTrip(view) as Uint8Array)).toEqual([2, 3, 4]);
  });

  it('encodes base64 as the standard alphabet does', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const bytes = new TextEncoder().encode(text);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(Buffer.from(text).toString('base64'));
      expect(new TextDecoder().decode(base64ToBytes(encoded))).toBe(text);
    }
  });
});
