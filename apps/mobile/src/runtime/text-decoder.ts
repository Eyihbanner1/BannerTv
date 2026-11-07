/**
 * TextDecoder for the shared subtitle reader (apps/webos/src/player/subtitles.ts), which names the
 * file's encoding as a WHATWG label. Hermes's own decoder, where there is one, knows UTF-8 and
 * little else, while subtitle files are often in a Windows code page. This one uses the engine's
 * decoder for labels it accepts and decodes UTF-8, UTF-16 and Windows-1252 (Latin-1's superset)
 * itself otherwise. Other code pages read as Windows-1252, so Cyrillic or Arabic files in an old
 * code page show the wrong letters on the phone for now.
 */

/** Windows-1252's 0x80 to 0x9F, the only bytes where it differs from Latin-1. */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

type Decode = (bytes: Uint8Array) => string;

const CHUNK = 8192;

function fromCodes(codes: number[]): string {
  let text = '';
  for (let at = 0; at < codes.length; at += CHUNK) {
    text += String.fromCharCode.apply(null, codes.slice(at, at + CHUNK));
  }
  return text;
}

function pushCodePoint(codes: number[], point: number): void {
  if (point < 0x10000) {
    codes.push(point);
  } else {
    const offset = point - 0x10000;
    codes.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
  }
}

/** The WHATWG Encoding standard's UTF-8 decoder: each broken sequence reads as one U+FFFD. */
const decodeUtf8: Decode = (bytes) => {
  const codes: number[] = [];
  let needed = 0;
  let seen = 0;
  let point = 0;
  let lower = 0x80;
  let upper = 0xbf;
  let at = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (at < bytes.length) {
    const byte = bytes[at]!;
    at += 1;
    if (needed === 0) {
      if (byte <= 0x7f) {
        codes.push(byte);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        point = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        point = byte & 0x0f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        point = byte & 0x07;
      } else {
        codes.push(0xfffd);
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      // The sequence so far is one error, and this byte starts afresh.
      needed = seen = point = 0;
      lower = 0x80;
      upper = 0xbf;
      codes.push(0xfffd);
      at -= 1;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    point = (point << 6) | (byte & 0x3f);
    seen += 1;
    if (seen === needed) {
      pushCodePoint(codes, point);
      needed = seen = point = 0;
    }
  }
  if (needed !== 0) codes.push(0xfffd);
  return fromCodes(codes);
};

function decodeUtf16(littleEndian: boolean): Decode {
  return (bytes) => {
    const codes: number[] = [];
    let at = 0;
    if (littleEndian && bytes[0] === 0xff && bytes[1] === 0xfe) at = 2;
    if (!littleEndian && bytes[0] === 0xfe && bytes[1] === 0xff) at = 2;
    for (; at + 1 < bytes.length; at += 2) {
      const low = bytes[at]!;
      const high = bytes[at + 1]!;
      codes.push(littleEndian ? low | (high << 8) : (low << 8) | high);
    }
    return fromCodes(codes);
  };
}

const decodeWindows1252: Decode = (bytes) => {
  const codes: number[] = new Array(bytes.length);
  for (let at = 0; at < bytes.length; at++) {
    const byte = bytes[at]!;
    codes[at] = byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80]! : byte;
  }
  return fromCodes(codes);
};

/** The decoder this file brings, for an encoding label (exported for its tests). */
export function ownDecoder(label: string): Decode {
  switch (label) {
    case 'utf-8':
    case 'utf8':
    case 'unicode-1-1-utf-8':
      return decodeUtf8;
    case 'utf-16le':
    case 'utf-16':
      return decodeUtf16(true);
    case 'utf-16be':
      return decodeUtf16(false);
    default:
      return decodeWindows1252;
  }
}

type NativeDecoder = { decode(input?: Uint8Array): string };
const Native = (globalThis as { TextDecoder?: new (label?: string) => NativeDecoder }).TextDecoder;

export class TextDecoder {
  readonly encoding: string;
  private readonly run: Decode;

  constructor(label = 'utf-8') {
    this.encoding = label.trim().toLowerCase();
    const own = ownDecoder(this.encoding);
    let native: NativeDecoder | undefined;
    // The engine's own is faster, but only for an encoding it really knows.
    if (Native && own === decodeUtf8) {
      try {
        native = new Native(this.encoding);
      } catch {
        native = undefined;
      }
    }
    this.run = native ? (bytes) => native.decode(bytes) : own;
  }

  decode(input?: ArrayBufferView | ArrayBuffer): string {
    if (input === undefined) return '';
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return this.run(bytes);
  }
}
