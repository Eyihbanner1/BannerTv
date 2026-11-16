import { decodeUtf8 } from '../media/ebml';
import { crc32, InflateError, inflateRaw } from '../media/inflate';
import { releaseFeatures } from './versions';

/**
 * The one subtitle file wanted out of a ZIP archive, as SubDL sends a
 * release's files (ADR 0003, step D): a film's largest subtitle file, or a
 * season pack's file for one episode, never another episode's. Read from the
 * central directory, within caps on size, entries and how far a file unpacks.
 */

export type ZipFailure =
  | 'not-zip'
  | 'rar'
  | 'encrypted'
  | 'zip64'
  | 'too-many'
  | 'too-big'
  | 'crc'
  | 'corrupt'
  | 'no-subtitle';

export class ZipError extends Error {
  readonly reason: ZipFailure;

  constructor(reason: ZipFailure) {
    super(`The archive could not be read: ${reason}`);
    this.name = 'ZipError';
    this.reason = reason;
  }
}

/** The episode wanted from a season pack; a film's archive has none. */
export interface ZipPick {
  season?: number;
  episode?: number;
  /**
   * The archive is said to be that episode's alone: with no file named for
   * it, the largest named for no episode and no other season is taken.
   */
  loose?: boolean;
}

export interface ZipLimits {
  /** The most the chosen file may unpack to. */
  maxBytes: number;
  /** The most entries an archive may list. */
  maxEntries: number;
  /** The most a file may unpack to, as a multiple of its packed size. */
  maxRatio: number;
}

export const ZIP_LIMITS: ZipLimits = { maxBytes: 5 * 1024 * 1024, maxEntries: 64, maxRatio: 100 };

const SUBTITLE_NAME = /\.(srt|ass|ssa|vtt)$/i;
const END_RECORD = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
/** The end record's 22 bytes and the longest comment it can carry. */
const END_SEARCH = 22 + 0xffff;

/** Starts "PK\x03\x04", as a ZIP archive with a file does. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isRar(bytes: Uint8Array): boolean {
  const sign = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];
  return sign.every((byte, i) => bytes[i] === byte);
}

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  packed: number;
  size: number;
  local: number;
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}

function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function readEntries(bytes: Uint8Array, limits: ZipLimits): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - END_SEARCH; at--) {
    if (u32(at) === END_RECORD) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError('corrupt');
  const count = u16(end + 10);
  const offset = u32(end + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new ZipError('zip64');
  if (count > limits.maxEntries) throw new ZipError('too-many');
  const entries: Entry[] = [];
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL_ENTRY) throw new ZipError('corrupt');
    const flags = u16(at + 8);
    const nameLength = u16(at + 28);
    const next = at + 46 + nameLength + u16(at + 30) + u16(at + 32);
    if (next > bytes.length) throw new ZipError('corrupt');
    // Sizes and the check come from here, so a file written with a data descriptor needs no more.
    const packed = u32(at + 20);
    const size = u32(at + 24);
    const local = u32(at + 42);
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
      throw new ZipError('zip64');
    }
    if (flags & 1) throw new ZipError('encrypted');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = flags & 0x800 ? decodeUtf8(nameBytes) : latin1(nameBytes);
    entries.push({
      // Some Windows tools write folders with backslashes, which no file name holds.
      name: name.replace(/\\/g, '/'),
      flags,
      method: u16(at + 10),
      crc: u32(at + 16),
      packed,
      size,
      local,
    });
    at = next;
  }
  return entries;
}

function counts(entry: Entry): boolean {
  if (entry.name.endsWith('/')) return false;
  if (entry.name.startsWith('__MACOSX/') || entry.name.indexOf('/__MACOSX/') !== -1) return false;
  const base = baseName(entry.name);
  return !base.startsWith('._') && SUBTITLE_NAME.test(base);
}

function largest(entries: readonly Entry[]): Entry {
  let best = entries[0]!;
  for (const entry of entries) if (entry.size > best.size) best = entry;
  return best;
}

function unpack(bytes: Uint8Array, entry: Entry, limits: ZipLimits): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.local + 30 > bytes.length || view.getUint32(entry.local, true) !== LOCAL_HEADER) {
    throw new ZipError('corrupt');
  }
  const start =
    entry.local +
    30 +
    view.getUint16(entry.local + 26, true) +
    view.getUint16(entry.local + 28, true);
  if (start + entry.packed > bytes.length) throw new ZipError('corrupt');
  const data = bytes.subarray(start, start + entry.packed);
  if (entry.size > limits.maxBytes || entry.size > entry.packed * limits.maxRatio) {
    throw new ZipError('too-big');
  }
  let out: Uint8Array;
  if (entry.method === 0) {
    out = data.slice();
  } else if (entry.method === 8) {
    try {
      out = inflateRaw(data, Math.min(entry.size, limits.maxBytes));
    } catch (error) {
      throw new ZipError(
        error instanceof InflateError && error.reason === 'too-big' ? 'too-big' : 'corrupt',
      );
    }
  } else {
    throw new ZipError('corrupt');
  }
  if (out.length !== entry.size) throw new ZipError('corrupt');
  if (crc32(out) !== entry.crc) throw new ZipError('crc');
  return out;
}

/**
 * The bytes of the subtitle file wanted out of a ZIP archive. With an
 * episode, the largest of the files whose names give that episode (and that
 * season, or none), or with `loose` and none such, the largest whose names
 * give no episode; otherwise the largest subtitle file. Throws ZipError.
 */
export function subtitleFromZip(
  bytes: Uint8Array,
  pick: ZipPick,
  limits: ZipLimits = ZIP_LIMITS,
): Uint8Array {
  if (isRar(bytes)) throw new ZipError('rar');
  if (!isZip(bytes)) throw new ZipError('not-zip');
  const subtitles = readEntries(bytes, limits).filter(counts);
  if (subtitles.length === 0) throw new ZipError('no-subtitle');
  let chosen = subtitles;
  if (pick.episode !== undefined) {
    const episode = pick.episode;
    const named = subtitles.map((entry) => ({
      entry,
      found: releaseFeatures(baseName(entry.name)),
    }));
    const sameSeason = (season: number | undefined) =>
      season === undefined || pick.season === undefined || season === pick.season;
    chosen = named
      .filter(({ found }) => !!found.episodes && found.episodes.indexOf(episode) !== -1)
      .filter(({ found }) => sameSeason(found.season))
      .map(({ entry }) => entry);
    if (chosen.length === 0 && pick.loose) {
      chosen = named
        .filter(({ found }) => !found.episodes && sameSeason(found.season))
        .map(({ entry }) => entry);
    }
    // Never another episode's file in its place.
    if (chosen.length === 0) throw new ZipError('no-subtitle');
  }
  return unpack(bytes, largest(chosen), limits);
}
