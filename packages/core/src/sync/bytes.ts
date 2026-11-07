/**
 * Text and bytes for the account's crypto. The core is typed without the DOM
 * and runs where TextEncoder and btoa may be missing, so it does its own
 * UTF-8 and base64url. Both must give the same bytes on every screen: a
 * document sealed on the LG is opened on Android.
 */

/** Long strings are built in slices, so String.fromCharCode never gets more arguments than an engine allows. */
const SLICE = 8192;

/** The UTF-8 of `text`. A lone surrogate becomes U+FFFD, as TextEncoder does. */
export function utf8Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 3);
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        code = 0xfffd;
      }
    }
    if (code < 0x80) {
      out[at++] = code;
    } else if (code < 0x800) {
      out[at++] = 0xc0 | (code >> 6);
      out[at++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[at++] = 0xe0 | (code >> 12);
      out[at++] = 0x80 | ((code >> 6) & 0x3f);
      out[at++] = 0x80 | (code & 0x3f);
    } else {
      out[at++] = 0xf0 | (code >> 18);
      out[at++] = 0x80 | ((code >> 12) & 0x3f);
      out[at++] = 0x80 | ((code >> 6) & 0x3f);
      out[at++] = 0x80 | (code & 0x3f);
    }
  }
  return out.slice(0, at);
}

/**
 * The text that `bytes` are the UTF-8 of. Throws on anything that is not
 * well-formed UTF-8: an opened document that is not is damaged, not text.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = [];
  let text = '';
  const flush = () => {
    text += String.fromCharCode.apply(null, units);
    units.length = 0;
  };
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i]!;
    let code: number;
    let more: number;
    let least: number;
    if (first < 0x80) {
      code = first;
      more = 0;
      least = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      code = first & 0x1f;
      more = 1;
      least = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      code = first & 0x0f;
      more = 2;
      least = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code = first & 0x07;
      more = 3;
      least = 0x10000;
    } else {
      throw new Error('Not UTF-8');
    }
    for (let k = 1; k <= more; k++) {
      const byte = bytes[i + k];
      if (byte === undefined || (byte & 0xc0) !== 0x80) throw new Error('Not UTF-8');
      code = (code << 6) | (byte & 0x3f);
    }
    // Overlong forms, surrogates and anything past U+10FFFF are not text.
    if (code < least || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) {
      throw new Error('Not UTF-8');
    }
    if (code >= 0x10000) {
      code -= 0x10000;
      units.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      units.push(code);
    }
    i += more + 1;
    if (units.length >= SLICE) flush();
  }
  flush();
  return text;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUES: { [char: string]: number } = Object.create(null);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charAt(i)] = i;

/** Base64url without padding, as the account's ids, keys and bodies are written. */
export function toBase64Url(bytes: Uint8Array): string {
  const chars: string[] = [];
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    chars.push(ALPHABET.charAt(triple >> 18), ALPHABET.charAt((triple >> 12) & 63));
    if (i + 1 < bytes.length) chars.push(ALPHABET.charAt((triple >> 6) & 63));
    if (i + 2 < bytes.length) chars.push(ALPHABET.charAt(triple & 63));
    if (chars.length >= SLICE) {
      text += chars.join('');
      chars.length = 0;
    }
  }
  return text + chars.join('');
}

/** The bytes of base64url text without padding, or undefined when it is not that. */
export function fromBase64Url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    let triple = 0;
    const count = Math.min(4, text.length - i);
    for (let k = 0; k < 4; k++) {
      let value = 0;
      if (k < count) {
        const found = VALUES[text.charAt(i + k)];
        if (found === undefined) return undefined;
        value = found;
      }
      triple = (triple << 6) | value;
    }
    out[at++] = (triple >> 16) & 255;
    if (count > 2) out[at++] = (triple >> 8) & 255;
    if (count > 3) out[at++] = triple & 255;
  }
  return out;
}
