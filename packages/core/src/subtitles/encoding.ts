import { languageKey } from './languages';

/** The legacy code page most subtitle files in a language were saved in. */
const CODE_PAGES = new Map<string, string>();
for (const [encoding, keys] of [
  ['windows-1250', ['pl', 'cs', 'sk', 'hu', 'ro', 'hr', 'sl', 'bs', 'sq', 'sr']],
  ['windows-1251', ['ru', 'uk', 'bg', 'be', 'mk', 'kk', 'mn']],
  ['windows-1253', ['el']],
  ['windows-1254', ['tr', 'az']],
  ['windows-1255', ['he', 'yi']],
  ['windows-1256', ['ar', 'fa', 'ur']],
  ['windows-1257', ['lt', 'lv', 'et']],
  ['windows-1258', ['vi']],
  ['windows-874', ['th']],
  ['gb18030', ['zh', 'zh-hans']],
  ['big5', ['zh-hant']],
  ['shift_jis', ['ja']],
  ['euc-kr', ['ko']],
] as const) {
  for (const key of keys) CODE_PAGES.set(key, encoding);
}

const FALLBACK = 'windows-1252';
const UTF16_SAMPLE_BYTES = 2048;

/**
 * Strict UTF-8: no overlong forms, no surrogates, nothing past U+10FFFF, no
 * sequence cut short. Text in a legacy code page almost never passes, so
 * passing is strong evidence.
 */
function isUtf8(bytes: Uint8Array): boolean {
  const length = bytes.length;
  let i = 0;
  while (i < length) {
    const lead = bytes[i]!;
    if (lead < 0x80) {
      i++;
      continue;
    }
    let continuation: number;
    // The second byte's range is narrower after some leads: that is what
    // rules out overlong forms, surrogates and code points past U+10FFFF.
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) continuation = 1;
    else if (lead >= 0xe0 && lead <= 0xef) {
      continuation = 2;
      if (lead === 0xe0) low = 0xa0;
      if (lead === 0xed) high = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      continuation = 3;
      if (lead === 0xf0) low = 0x90;
      if (lead === 0xf4) high = 0x8f;
    } else return false;

    if (i + continuation >= length) return false;
    const second = bytes[i + 1]!;
    if (second < low || second > high) return false;
    for (let k = 2; k <= continuation; k++) {
      const next = bytes[i + k]!;
      if (next < 0x80 || next > 0xbf) return false;
    }
    i += continuation + 1;
  }
  return true;
}

/**
 * UTF-16 saved without a byte-order mark. Subtitle text never holds NUL, but
 * in UTF-16 every ASCII character (digits, colons, arrows, newlines, of which
 * timing lines are made) has a zero byte on one side. Must run before the
 * UTF-8 check, which NUL bytes pass.
 */
function utf16WithoutBom(bytes: Uint8Array): string | undefined {
  const sampled = Math.min(bytes.length, UTF16_SAMPLE_BYTES) & ~1;
  const pairs = sampled / 2;
  if (pairs < 2) return undefined;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sampled; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return 'utf-16le';
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return 'utf-16be';
  return undefined;
}

/**
 * Picks the text encoding of a subtitle file, as a WHATWG encoding label that
 * TextDecoder accepts: a byte-order mark first, then strict UTF-8, then the
 * Windows code page usual for the subtitle's language (many SRT files are
 * Windows-1252, 1250, 1251, 1256 …), and windows-1252 when nothing else fits.
 */
export function detectEncoding(bytes: Uint8Array, language?: string): string {
  const [first, second, third] = [bytes[0], bytes[1], bytes[2]];
  if (first === 0xef && second === 0xbb && third === 0xbf) return 'utf-8';
  if (first === 0xff && second === 0xfe) return 'utf-16le';
  if (first === 0xfe && second === 0xff) return 'utf-16be';
  const utf16 = utf16WithoutBom(bytes);
  if (utf16 !== undefined) return utf16;
  if (isUtf8(bytes)) return 'utf-8';
  if (language === undefined) return FALLBACK;
  const key = languageKey(language);
  // Serbian subtitles are mostly Latin script; Cyrillic ones say so in the tag.
  if (key === 'sr' && /cyrl/i.test(language)) return 'windows-1251';
  return CODE_PAGES.get(key) ?? FALLBACK;
}
