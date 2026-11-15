/**
 * EBML, the binary layout Matroska is written in: every element is an ID, a
 * size and then its data, both ID and size written as variable-length
 * integers (vints) of 1 to 8 bytes whose first byte says how long they are.
 *
 * Read with plain Numbers, as the TV's Chromium 68 has no BigInt: a value of
 * up to 8 bytes is exact up to 2^53 - 1, and one past that is refused
 * (`EbmlError` with 'too-large'), never rounded. File positions and sizes of
 * any real file fit; only IDs such as a TrackUID use all 64 bits, and the
 * reader never needs those.
 */

export type EbmlProblem = 'corrupt' | 'too-large';

export class EbmlError extends Error {
  constructor(
    readonly problem: EbmlProblem,
    message: string,
  ) {
    super(message);
    this.name = 'EbmlError';
  }
}

/** 2^45 - 1: the largest value that can take one more byte and stay under 2^53. */
const SHIFT_LIMIT = 35184372088831;

/** A size whose value bits are all set: the element runs to the end of its parent. */
export const UNKNOWN_SIZE = -1;

export interface ElementHeader {
  /** The ID with its length marker kept, as the specification writes it (0x1A45DFA3). */
  id: number;
  /** The data's length in bytes, or UNKNOWN_SIZE. */
  size: number;
  /** Bytes of ID and size together. */
  headerLength: number;
}

/** A vint's length from its first byte; 0 for a zero byte, which no vint starts with. */
export function vintLength(first: number): number {
  if (first >= 0x80) return 1;
  if (first >= 0x40) return 2;
  if (first >= 0x20) return 3;
  if (first >= 0x10) return 4;
  if (first >= 0x08) return 5;
  if (first >= 0x04) return 6;
  if (first >= 0x02) return 7;
  if (first >= 0x01) return 8;
  return 0;
}

/** Appends one byte to a big-endian value, refusing to go past 2^53 - 1. */
function shiftIn(value: number, byte: number): number {
  if (value > SHIFT_LIMIT) throw new EbmlError('too-large', 'a value past 2^53');
  return value * 256 + byte;
}

/**
 * An element's ID and size at `at`, or undefined when `bytes` ends before
 * they do. Throws 'corrupt' for a byte no vint can start with, or an ID over
 * the 4 bytes Matroska allows.
 */
export function readHeader(bytes: Uint8Array, at: number): ElementHeader | undefined {
  if (at >= bytes.length) return undefined;
  const idLength = vintLength(bytes[at]!);
  if (idLength === 0 || idLength > 4) throw new EbmlError('corrupt', 'not an element ID');
  if (at + idLength >= bytes.length) return undefined;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[at + i]!;

  const sizeAt = at + idLength;
  const first = bytes[sizeAt]!;
  const sizeLength = vintLength(first);
  if (sizeLength === 0) throw new EbmlError('corrupt', 'not an element size');
  if (sizeAt + sizeLength > bytes.length) return undefined;
  const marker = 0x100 >> sizeLength;
  let allOnes = (first & (marker - 1)) === marker - 1;
  let size = first & (marker - 1);
  for (let i = 1; i < sizeLength; i++) {
    const byte = bytes[sizeAt + i]!;
    if (byte !== 0xff) allOnes = false;
  }
  if (allOnes) return { id, size: UNKNOWN_SIZE, headerLength: idLength + sizeLength };
  for (let i = 1; i < sizeLength; i++) size = shiftIn(size, bytes[sizeAt + i]!);
  return { id, size, headerLength: idLength + sizeLength };
}

/**
 * A vint's value and length, as a Block writes its track number; undefined
 * when `bytes` ends first.
 */
export function readVint(
  bytes: Uint8Array,
  at: number,
): { value: number; length: number } | undefined {
  if (at >= bytes.length) return undefined;
  const first = bytes[at]!;
  const length = vintLength(first);
  if (length === 0) throw new EbmlError('corrupt', 'not a vint');
  if (at + length > bytes.length) return undefined;
  let value = first & ((0x100 >> length) - 1);
  for (let i = 1; i < length; i++) value = shiftIn(value, bytes[at + i]!);
  return { value, length };
}

/** An unsigned integer of 0 to 8 bytes. */
export function readUint(bytes: Uint8Array, start: number, end: number): number {
  if (end - start > 8) throw new EbmlError('corrupt', 'an integer over 8 bytes');
  let value = 0;
  for (let i = start; i < end; i++) value = shiftIn(value, bytes[i]!);
  return value;
}

/** A signed integer of 0 to 8 bytes, as DiscardPadding or ReferenceBlock are written. */
export function readInt(bytes: Uint8Array, start: number, end: number): number {
  const length = end - start;
  if (length === 0) return 0;
  if (length > 7) throw new EbmlError('too-large', 'a signed integer over 7 bytes');
  const unsigned = readUint(bytes, start, end);
  const negative = (bytes[start]! & 0x80) !== 0;
  return negative ? unsigned - Math.pow(2, 8 * length) : unsigned;
}

/** A float of 0, 4 or 8 bytes. */
export function readFloat(bytes: Uint8Array, start: number, end: number): number {
  const length = end - start;
  if (length === 0) return 0;
  if (length !== 4 && length !== 8) throw new EbmlError('corrupt', 'a float of another size');
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, length);
  return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

/** The bytes up to the first NUL: EBML strings may be padded with zeros. */
function untilNul(bytes: Uint8Array, start: number, end: number): Uint8Array {
  let stop = start;
  while (stop < end && bytes[stop] !== 0) stop++;
  return bytes.subarray(start, stop);
}

/** An ASCII string (DocType, CodecID, Language). */
export function readAscii(bytes: Uint8Array, start: number, end: number): string {
  const text = untilNul(bytes, start, end);
  let out = '';
  for (let i = 0; i < text.length; i++) out += String.fromCharCode(text[i]! & 0x7f);
  return out;
}

/** A UTF-8 string (a track's Name), cut at the first NUL. */
export function readUtf8String(bytes: Uint8Array, start: number, end: number): string {
  return decodeUtf8(untilNul(bytes, start, end));
}

/**
 * UTF-8 to a string. Done by hand: the core has no TextDecoder of its own to
 * rely on in every engine the apps run in. A byte that does not start a
 * well-formed sequence (overlong, a surrogate, past U+10FFFF, cut short)
 * becomes U+FFFD, as TextDecoder does.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  let units: number[] = [];
  const flush = () => {
    parts.push(String.fromCharCode.apply(null, units));
    units = [];
  };
  let i = 0;
  const length = bytes.length;
  while (i < length) {
    const lead = bytes[i]!;
    let code = -1;
    let used = 1;
    if (lead < 0x80) {
      code = lead;
    } else {
      let count = 0;
      let low = 0x80;
      let high = 0xbf;
      if (lead >= 0xc2 && lead <= 0xdf) count = 1;
      else if (lead >= 0xe0 && lead <= 0xef) {
        count = 2;
        if (lead === 0xe0) low = 0xa0;
        if (lead === 0xed) high = 0x9f;
      } else if (lead >= 0xf0 && lead <= 0xf4) {
        count = 3;
        if (lead === 0xf0) low = 0x90;
        if (lead === 0xf4) high = 0x8f;
      }
      if (count > 0) {
        let value = lead & (0x3f >> count);
        let k = 1;
        for (; k <= count; k++) {
          const next = bytes[i + k];
          const min = k === 1 ? low : 0x80;
          const max = k === 1 ? high : 0xbf;
          if (next === undefined || next < min || next > max) break;
          value = value * 64 + (next & 0x3f);
        }
        if (k > count) {
          code = value;
          used = count + 1;
        } else {
          used = k;
        }
      }
    }
    if (code === -1) units.push(0xfffd);
    else if (code > 0xffff) {
      const offset = code - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else units.push(code);
    i += used;
    if (units.length >= 8192) flush();
  }
  flush();
  return parts.join('');
}

export interface Child extends ElementHeader {
  /** Where the element starts in the buffer. */
  start: number;
  /** Where its data starts. */
  dataStart: number;
  /** Where its data ends: the parent's end for an unknown size. */
  end: number;
}

/**
 * The elements one after another from `start` to `end` of a buffer that
 * holds them whole. An element running past `end` is corrupt. CRC-32 and
 * Void elements are passed over.
 */
export function* children(bytes: Uint8Array, start: number, end: number): Generator<Child> {
  let at = start;
  while (at < end) {
    const header = readHeader(bytes, at);
    if (!header) throw new EbmlError('corrupt', 'an element cut short');
    const dataStart = at + header.headerLength;
    const elementEnd = header.size === UNKNOWN_SIZE ? end : dataStart + header.size;
    if (elementEnd > end) throw new EbmlError('corrupt', 'an element past its parent');
    if (header.id !== ID.CRC32 && header.id !== ID.VOID) {
      // Fields by hand: an ES2017 build turns object spread into a helper call, slow here.
      yield {
        id: header.id,
        size: header.size,
        headerLength: header.headerLength,
        start: at,
        dataStart,
        end: elementEnd,
      };
    }
    at = elementEnd;
  }
}

/** Joins two buffers. */
export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  return joined;
}

/** The Matroska element IDs the reader uses (RFC 9559). */
export const ID = {
  EBML: 0x1a45dfa3,
  DOC_TYPE: 0x4282,
  DOC_TYPE_READ_VERSION: 0x4285,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  SEEK: 0x4dbb,
  SEEK_ID: 0x53ab,
  SEEK_POSITION: 0x53ac,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  MUXING_APP: 0x4d80,
  WRITING_APP: 0x5741,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  FLAG_ENABLED: 0xb9,
  FLAG_DEFAULT: 0x88,
  FLAG_FORCED: 0x55aa,
  FLAG_HEARING_IMPAIRED: 0x55ab,
  DEFAULT_DURATION: 0x23e383,
  NAME: 0x536e,
  LANGUAGE: 0x22b59c,
  LANGUAGE_IETF: 0x22b59d,
  CODEC_ID: 0x86,
  CODEC_PRIVATE: 0x63a2,
  CONTENT_ENCODINGS: 0x6d80,
  CONTENT_ENCODING: 0x6240,
  CONTENT_ENCODING_ORDER: 0x5031,
  CONTENT_ENCODING_SCOPE: 0x5032,
  CONTENT_ENCODING_TYPE: 0x5033,
  CONTENT_COMPRESSION: 0x5034,
  CONTENT_COMP_ALGO: 0x4254,
  CONTENT_COMP_SETTINGS: 0x4255,
  CONTENT_ENCRYPTION: 0x5035,
  CLUSTER: 0x1f43b675,
  TIMESTAMP: 0xe7,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_DURATION: 0x9b,
  BLOCK_ADDITIONS: 0x75a1,
  BLOCK_MORE: 0xa6,
  BLOCK_ADD_ID: 0xee,
  BLOCK_ADDITIONAL: 0xa5,
  REFERENCE_BLOCK: 0xfb,
  REFERENCE_PRIORITY: 0xfa,
  CODEC_STATE: 0xa4,
  DISCARD_PADDING: 0x75a2,
  CUES: 0x1c53bb6b,
  CUE_POINT: 0xbb,
  CUE_TIME: 0xb3,
  CUE_TRACK_POSITIONS: 0xb7,
  CUE_TRACK: 0xf7,
  CUE_CLUSTER_POSITION: 0xf1,
  CUE_RELATIVE_POSITION: 0xf0,
  CUE_DURATION: 0xb2,
  VOID: 0xec,
  CRC32: 0xbf,
} as const;
