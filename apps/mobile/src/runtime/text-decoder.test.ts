import { describe, expect, it } from 'vitest';
import { ownDecoder, TextDecoder as PhoneDecoder } from './text-decoder';

const bytes = (text: string, encoding: 'utf-8' | 'utf-16le') =>
  new Uint8Array(Buffer.from(text, encoding === 'utf-8' ? 'utf8' : 'utf16le'));

describe('the phone TextDecoder', () => {
  const sample = 'Café — “quoted” ½ 日本語 🎬 ok';

  it('reads UTF-8 and UTF-16 as the browser does', () => {
    expect(new PhoneDecoder('utf-8').decode(bytes(sample, 'utf-8'))).toBe(sample);
    expect(ownDecoder('utf-8')(bytes(sample, 'utf-8'))).toBe(sample);
    expect(new PhoneDecoder('utf-16le').decode(bytes(sample, 'utf-16le'))).toBe(sample);
    const big = bytes(sample, 'utf-16le');
    for (let at = 0; at + 1 < big.length; at += 2)
      [big[at], big[at + 1]] = [big[at + 1]!, big[at]!];
    expect(new PhoneDecoder('utf-16be').decode(big)).toBe(sample);
  });

  it('matches the browser on broken UTF-8', () => {
    const broken = new Uint8Array([
      0x61, 0xc3, 0x28, 0xe2, 0x82, 0x62, 0xf0, 0x9f, 0x8e, 0xc0, 0xaf,
    ]);
    expect(ownDecoder('utf-8')(broken)).toBe(new globalThis.TextDecoder('utf-8').decode(broken));
  });

  it('reads every Windows-1252 byte as the browser does', () => {
    const all = new Uint8Array(256).map((_, index) => index);
    expect(new PhoneDecoder('windows-1252').decode(all)).toBe(
      new globalThis.TextDecoder('windows-1252').decode(all),
    );
  });

  it('drops a byte-order mark', () => {
    expect(ownDecoder('utf-8')(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });
});
