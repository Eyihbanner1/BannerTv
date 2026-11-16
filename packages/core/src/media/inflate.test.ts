import { describe, expect, it } from 'vitest';
import { nodeZlib, utf8 } from '../subtitles/fixtures/zip-writer';
import { crc32, InflateError, inflateRaw } from './inflate';

/** Bytes from a seeded generator, so a failure repeats. */
function seededBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

function seededText(lines: number): Uint8Array {
  const out: string[] = [];
  for (let n = 1; n <= lines; n++)
    out.push(`${n}\n00:00:${n % 60},000 --> 00:00:${n % 60},500\nLine ${n}\n`);
  return utf8(out.join('\n'));
}

function failure(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof InflateError ? error.reason : 'other';
  }
  return undefined;
}

describe('inflateRaw', () => {
  const inputs: Array<[string, () => Uint8Array]> = [
    ['seeded text', () => seededText(2000)],
    ['200 KB of seeded random bytes', () => seededBytes(200 * 1024, 7)],
    [
      'a 40 KB run that needs 32 KB distances',
      () => {
        const block = seededBytes(32 * 1024 + 100, 3);
        const out = new Uint8Array(block.length + 40 * 1024);
        out.set(block);
        // The same bytes again 32 KB on: matches as far back as the window goes.
        for (let i = block.length; i < out.length; i++) out[i] = out[i - 32768]!;
        return out;
      },
    ],
    ['an empty input', () => new Uint8Array(0)],
  ];

  for (const level of [0, 1, 6, 9]) {
    for (const [name, make] of inputs) {
      it(`unpacks ${name} as zlib packed it at level ${level}`, async () => {
        const zlib = await nodeZlib();
        const input = make();
        const packed = new Uint8Array(zlib.deflateRawSync(input, { level }));
        expect(inflateRaw(packed, input.length + 1)).toEqual(input);
      });
    }
  }

  it('unpacks one input with stored, fixed and dynamic blocks', async () => {
    const zlib = await nodeZlib();
    const stored = seededBytes(1000, 11);
    const fixed = utf8('Line 1 Line 1 Line 1');
    const dynamic = seededText(400);
    const packedStored = new Uint8Array(zlib.deflateRawSync(stored, { level: 0 }));
    // Each of zlib's streams ends with a last block; taken apart, their bits are joined here
    // by hand: a stored block (byte aligned), a fixed one, then a dynamic one.
    const bits: number[] = [];
    const push = (value: number, count: number) => {
      for (let i = 0; i < count; i++) bits.push((value >>> i) & 1);
    };
    // Stored, not last.
    push(0, 1);
    push(0, 2);
    while (bits.length % 8) bits.push(0);
    push(stored.length, 16);
    push(stored.length ^ 0xffff, 16);
    for (const byte of stored) push(byte, 8);
    // Fixed, not last: literals only, codes for 0..143 are 8 bits from 0x30, written high bit first.
    push(0, 1);
    push(1, 2);
    const fixedCode = (code: number, length: number) => {
      for (let i = length - 1; i >= 0; i--) bits.push((code >>> i) & 1);
    };
    for (const byte of fixed) {
      if (byte < 144) fixedCode(0x30 + byte, 8);
      else fixedCode(0x190 + byte - 144, 9);
    }
    fixedCode(0, 7); // end of block
    // Dynamic, last: zlib's own block, whose first bit (its last flag) is already set.
    const packedDynamic = new Uint8Array(zlib.deflateRawSync(dynamic, { level: 9 }));
    expect(packedDynamic[0]! & 6).toBe(4); // zlib chose a dynamic block
    for (const byte of packedDynamic) push(byte, 8);
    const joined = new Uint8Array(Math.ceil(bits.length / 8));
    bits.forEach((bit, i) => {
      joined[i >> 3]! |= bit << (i & 7);
    });
    expect(packedStored.length).toBeGreaterThan(0);
    const expected = new Uint8Array(stored.length + fixed.length + dynamic.length);
    expected.set(stored);
    expected.set(fixed, stored.length);
    expected.set(dynamic, stored.length + fixed.length);
    expect(inflateRaw(joined, expected.length)).toEqual(expected);
  });

  it('says an input cut short is truncated', async () => {
    const zlib = await nodeZlib();
    const input = seededText(500);
    for (const level of [0, 6]) {
      const packed = new Uint8Array(zlib.deflateRawSync(input, { level }));
      expect(failure(() => inflateRaw(packed.subarray(0, packed.length >> 1), 1 << 20))).toBe(
        'truncated',
      );
    }
    expect(failure(() => inflateRaw(new Uint8Array(0), 10))).toBe('truncated');
  });

  it('says flipped bits are corrupt, and never throws anything else', async () => {
    const zlib = await nodeZlib();
    const input = seededText(300);
    const packed = new Uint8Array(zlib.deflateRawSync(input, { level: 6 }));
    // A block type of 3 is no block.
    expect(failure(() => inflateRaw(new Uint8Array([0x07, 0, 0]), 100))).toBe('corrupt');
    // A stored block whose length check is wrong.
    expect(failure(() => inflateRaw(new Uint8Array([0x01, 4, 0, 0, 0, 1, 2, 3, 4]), 100))).toBe(
      'corrupt',
    );
    // A distance back past the start.
    let corrupt = 0;
    for (let i = 0; i < 200; i++) {
      const bad = packed.slice();
      const at = 2 + ((i * 37) % (bad.length - 4));
      bad[at]! ^= 1 << (i % 8);
      const reason = failure(() => inflateRaw(bad, input.length * 2));
      expect(['corrupt', 'truncated', 'too-big', undefined]).toContain(reason);
      if (reason === 'corrupt') corrupt++;
    }
    expect(corrupt).toBeGreaterThan(0);
  });

  it('stops as soon as the output would pass maxLength', async () => {
    const zlib = await nodeZlib();
    const input = new Uint8Array(4 * 1024 * 1024);
    const packed = new Uint8Array(zlib.deflateRawSync(input, { level: 9 }));
    expect(packed.length).toBeLessThan(10 * 1024);
    expect(failure(() => inflateRaw(packed, 1024 * 1024))).toBe('too-big');
    expect(inflateRaw(packed, input.length).length).toBe(input.length);
  });
});

describe('crc32', () => {
  it('gives the known value for the fox', () => {
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("agrees with zlib's on random data", async () => {
    const zlib = await nodeZlib();
    expect(zlib.crc32).toBeTypeOf('function');
    for (const length of [1, 255, 4096, 100_000]) {
      const bytes = seededBytes(length, length);
      expect(crc32(bytes)).toBe(zlib.crc32!(bytes) >>> 0);
    }
  });
});
