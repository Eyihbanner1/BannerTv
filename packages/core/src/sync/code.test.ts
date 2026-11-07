import { describe, expect, it } from 'vitest';
import { ACCOUNT_CODE_ALPHABET, formatAccountCode, newAccountCode, readAccountCode } from './code';
import { seededRandom } from './testing';

function randomBytes(seed: number) {
  const next = seededRandom(seed);
  return {
    random: (length: number) => Uint8Array.from({ length }, () => Math.floor(next() * 256)),
  };
}

describe('newAccountCode', () => {
  it('draws 20 symbols from the alphabet', () => {
    const code = newAccountCode(randomBytes(7));
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/);
    expect(newAccountCode(randomBytes(8))).not.toBe(code);
  });

  it('skips bytes from 248 up, so every symbol is as likely', () => {
    let calls = 0;
    const code = newAccountCode({
      random: (length) => {
        calls += 1;
        // 248 and up would favour the first eight symbols; they are thrown away.
        return Uint8Array.from({ length }, (_, i) => (i % 2 === 0 ? 248 + (i % 8) : 31));
      },
    });
    expect(code).toBe('A'.repeat(20));
    expect(calls).toBe(2);
  });

  it('uses every symbol about as often', () => {
    const counts = new Map<string, number>();
    const source = randomBytes(42);
    for (let i = 0; i < 2000; i++) {
      for (const symbol of newAccountCode(source)) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(ACCOUNT_CODE_ALPHABET.length);
    const expected = (2000 * 20) / ACCOUNT_CODE_ALPHABET.length;
    let chiSquare = 0;
    counts.forEach((count) => (chiSquare += (count - expected) ** 2 / expected));
    // 30 degrees of freedom: 59.7 is the 0.1% point.
    expect(chiSquare).toBeLessThan(59.7);
  });
});

describe('readAccountCode', () => {
  it('ignores case, spaces and dashes', () => {
    expect(readAccountCode('k7qm 3xtp-w9rd  he4a 6bnc')).toBe('K7QM3XTPW9RDHE4A6BNC');
    expect(readAccountCode(' K7QM3XTPW9RDHE4A6BNC ')).toBe('K7QM3XTPW9RDHE4A6BNC');
  });

  it('gives null for anything that cannot be a code', () => {
    expect(readAccountCode('')).toBeNull();
    expect(readAccountCode('K7QM 3XTP W9RD HE4A 6BN')).toBeNull();
    expect(readAccountCode('K7QM 3XTP W9RD HE4A 6BNCD')).toBeNull();
    // I, L, O, 0 and 1 are not in the alphabet.
    expect(readAccountCode('K7QM 3XTP W9RD HE4A 6BN0')).toBeNull();
    expect(readAccountCode('K7QM 3XTP W9RD HE4A 6BNI')).toBeNull();
    expect(readAccountCode('K7QM.3XTP.W9RD.HE4A.6BNC')).toBeNull();
  });
});

describe('formatAccountCode', () => {
  it('shows five groups of four', () => {
    expect(formatAccountCode('K7QM3XTPW9RDHE4A6BNC')).toBe('K7QM 3XTP W9RD HE4A 6BNC');
    expect(readAccountCode(formatAccountCode('K7QM3XTPW9RDHE4A6BNC'))).toBe('K7QM3XTPW9RDHE4A6BNC');
  });
});
