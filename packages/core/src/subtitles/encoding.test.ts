import { describe, expect, it } from 'vitest';
import { detectEncoding } from './encoding';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
/** An SRT cue around some encoded text, as a file would hold it. */
const cueWith = (...text: number[]) =>
  bytes(...ascii('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), ...text, ...ascii('\r\n'));

describe('detectEncoding', () => {
  it('trusts a byte-order mark first', () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('utf-8');
    expect(detectEncoding(bytes(0xff, 0xfe, 0x41, 0x00))).toBe('utf-16le');
    expect(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x41))).toBe('utf-16be');
    // A UTF-8 mark wins over a language that would pick a code page.
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0xc3, 0xa9), 'rus')).toBe('utf-8');
  });

  it('takes valid UTF-8 as UTF-8, whatever the language', () => {
    expect(detectEncoding(bytes())).toBe('utf-8');
    expect(detectEncoding(cueWith(...ascii('Plain ASCII')), 'pol')).toBe('utf-8');
    expect(detectEncoding(cueWith(0x63, 0x61, 0x66, 0xc3, 0xa9), 'fre')).toBe('utf-8'); // café
    expect(detectEncoding(cueWith(0xe2, 0x82, 0xac))).toBe('utf-8'); // €
    expect(detectEncoding(cueWith(0xd0, 0x9f, 0xd1, 0x80), 'rus')).toBe('utf-8'); // Пр
    expect(detectEncoding(cueWith(0xf0, 0x9f, 0x98, 0x80))).toBe('utf-8'); // 😀
    expect(detectEncoding(cueWith(0xf4, 0x8f, 0xbf, 0xbf))).toBe('utf-8'); // U+10FFFF
  });

  it('rejects overlong forms, surrogates, code points past U+10FFFF and cut sequences', () => {
    const notUtf8 = [
      [0xc0, 0xaf], // overlong '/'
      [0xc1, 0xbf],
      [0xe0, 0x80, 0xaf],
      [0xf0, 0x80, 0x80, 0xaf],
      [0xed, 0xa0, 0x80], // U+D800
      [0xed, 0xbf, 0xbf], // U+DFFF
      [0xf4, 0x90, 0x80, 0x80], // U+110000
      [0xf5, 0x80, 0x80, 0x80],
      [0xff],
      [0x80], // a continuation byte on its own
      [0xc3, 0x41], // a lead byte followed by ASCII
      [0xe2, 0x82, 0x41],
    ];
    for (const sequence of notUtf8) {
      expect(detectEncoding(cueWith(...sequence)), sequence.join(' ')).toBe('windows-1252');
    }
    expect(detectEncoding(bytes(...ascii('caf'), 0xc3))).toBe('windows-1252');
    expect(detectEncoding(bytes(0xe2, 0x82))).toBe('windows-1252');
  });

  it('falls back to windows-1252 when there is no language or it is not known', () => {
    const cafe = cueWith(0x63, 0x61, 0x66, 0xe9); // café in windows-1252
    expect(detectEncoding(cafe)).toBe('windows-1252');
    expect(detectEncoding(cafe, 'eng')).toBe('windows-1252');
    expect(detectEncoding(cafe, 'fre')).toBe('windows-1252');
    expect(detectEncoding(cafe, 'xyz')).toBe('windows-1252');
    expect(detectEncoding(cafe, '')).toBe('windows-1252');
  });

  it("picks the code page usual for the subtitle's language", () => {
    const legacy = cueWith(0xcf, 0xf0, 0xe8); // not UTF-8 in any language
    const expected: Array<[string, string]> = [
      ['pol', 'windows-1250'],
      ['cze', 'windows-1250'],
      ['hu', 'windows-1250'],
      ['rum', 'windows-1250'],
      ['hrv', 'windows-1250'],
      ['scc', 'windows-1250'],
      ['sr-Latn', 'windows-1250'],
      ['sr-Cyrl', 'windows-1251'],
      ['rus', 'windows-1251'],
      ['ukr', 'windows-1251'],
      ['bul', 'windows-1251'],
      ['mac', 'windows-1251'],
      ['gre', 'windows-1253'],
      ['tur', 'windows-1254'],
      ['heb', 'windows-1255'],
      ['ara', 'windows-1256'],
      ['per', 'windows-1256'],
      ['urd', 'windows-1256'],
      ['lit', 'windows-1257'],
      ['est', 'windows-1257'],
      ['vie', 'windows-1258'],
      ['tha', 'windows-874'],
      ['chi', 'gb18030'],
      ['zhs', 'gb18030'],
      ['zh-CN', 'gb18030'],
      ['zht', 'big5'],
      ['zh-TW', 'big5'],
      ['jpn', 'shift_jis'],
      ['kor', 'euc-kr'],
      ['pob', 'windows-1252'],
      ['spa', 'windows-1252'],
    ];
    for (const [language, encoding] of expected) {
      expect(detectEncoding(legacy, language), language).toBe(encoding);
    }
  });

  it('spots UTF-16 saved without a byte-order mark', () => {
    const text = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n';
    const little: number[] = [];
    const big: number[] = [];
    for (const code of ascii(text)) {
      little.push(code, 0);
      big.push(0, code);
    }
    expect(detectEncoding(bytes(...little))).toBe('utf-16le');
    expect(detectEncoding(bytes(...big))).toBe('utf-16be');
  });
});
