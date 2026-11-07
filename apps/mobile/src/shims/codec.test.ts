import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decodeClone,
  decodeCloneFully,
  encodeClone,
  plainJson,
} from './codec';

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

describe('reading plain JSON without the full decode', () => {
  // A catalog page as Cinemeta sends it, the commonest thing the phone reads back.
  const page = {
    storedAt: 1_700_000_000_000,
    value: Array.from({ length: 40 }, (_, index) => ({
      id: `tt${1000000 + index}`,
      type: 'movie',
      name: `Title ${index}: "quoted", back\\slash, ünïcödé 🎬`,
      poster: `https://images.metahub.space/poster/small/tt${1000000 + index}/img`,
      genres: ['Drama', 'Comedy'],
      imdbRating: '7.5',
      releaseInfo: '2008',
      trailers: [],
      behaviorHints: { defaultVideoId: null, hasScheduledVideos: false },
    })),
  };

  it('takes the fast way for plain JSON, and the full one for anything else', () => {
    expect(plainJson(encodeClone(page))).toBe(true);
    expect(plainJson(encodeClone({ a: [1, 2, { b: 'c' }], d: null, e: true }))).toBe(true);
    // Tags, a stored object that looks like a tag, a "__proto__" key and \u escapes.
    expect(plainJson(encodeClone([1, undefined]))).toBe(false);
    expect(plainJson(encodeClone({ when: new Date(0) }))).toBe(false);
    expect(plainJson(encodeClone({ $bt: 'u8', v: 'AAAA' }))).toBe(false);
    expect(plainJson('{"__proto__":{"polluted":true}}')).toBe(false);
    expect(plainJson('{"\\u0024bt":"undef"}')).toBe(false);
    expect(plainJson(encodeClone('a control character: \u0001'))).toBe(false);
    // A string that merely contains the tag's name is escaped, so it stays plain...
    expect(plainJson(encodeClone({ note: 'say "$bt" twice' }))).toBe(true);
    // ...and one that is exactly the tag's name only costs the full decode.
    expect(plainJson(encodeClone({ note: '$bt' }))).toBe(false);
  });

  it('reads back what the full decode reads back', () => {
    const texts = [
      encodeClone(page),
      encodeClone({ note: 'say "$bt" twice', list: [[], {}, [[0]], -0, 1e21, 5e-7] }),
      encodeClone({ note: '$bt', nested: { $bt: 'obj' } }),
      encodeClone([1, undefined, NaN, new Set(['a']), new Map([[1, 2]])]),
      encodeClone({ '2': 'two', '1': 'one', b: 'b', a: 'a' }),
      '{"__proto__":{"polluted":true},"x":1}',
      '{"\\u0024bt":"undef","\\u005f_proto__":{"y":2}}',
      '"just text"',
      '42',
      'null',
      '[]',
    ];
    for (const text of texts) {
      const fast = decodeClone(text);
      const full = decodeCloneFully(text);
      expect(fast).toStrictEqual(full);
      expect(JSON.stringify(fast)).toBe(JSON.stringify(full));
    }
  });

  it('keeps the key order and the plain prototypes of the full decode', () => {
    const text = encodeClone({ z: 1, '10': 'ten', a: { '2': 0, c: [{ y: 1, x: 2 }] }, '1': 'one' });
    expect(plainJson(text)).toBe(true);
    const fast = decodeClone(text) as Record<string, Record<string, unknown>>;
    const full = decodeCloneFully(text) as Record<string, Record<string, unknown>>;
    expect(Object.keys(fast)).toEqual(Object.keys(full));
    expect(Object.keys(fast.a!)).toEqual(Object.keys(full.a!));
    expect(Object.getPrototypeOf(fast)).toBe(Object.prototype);
    expect(Array.isArray(fast.a!.c)).toBe(true);
  });

  it('agrees with the full decode on values made at random', () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pieces = ['a', '"', '\\', '$bt', '"$bt"', '__proto__', 'é', '🎬', '\n', '\u0007', ' '];
    const text = () =>
      Array.from(
        { length: Math.floor(next() * 5) },
        () => pieces[Math.floor(next() * pieces.length)],
      ).join('');
    const value = (depth: number): unknown => {
      const pick = Math.floor(next() * (depth > 3 ? 5 : 7));
      if (pick === 0) return null;
      if (pick === 1) return next() < 0.5;
      if (pick === 2) return Math.round((next() - 0.5) * 1e6) / 100;
      if (pick === 3 || pick === 4) return text();
      if (pick === 5) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1));
      const out: Record<string, unknown> = {};
      for (let i = Math.floor(next() * 4); i > 0; i--) out[text() || 'k'] = value(depth + 1);
      return out;
    };
    let fastOnes = 0;
    for (let round = 0; round < 500; round++) {
      const stored = encodeClone(value(0));
      if (plainJson(stored)) fastOnes += 1;
      expect(decodeClone(stored)).toStrictEqual(decodeCloneFully(stored));
    }
    // Both ways were tried.
    expect(fastOnes).toBeGreaterThan(50);
    expect(fastOnes).toBeLessThan(500);
  });
});
