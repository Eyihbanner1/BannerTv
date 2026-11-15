import type { AssScript } from '../subtitles/ass';
import {
  children,
  concatBytes,
  EbmlError,
  ID,
  readAscii,
  readFloat,
  readHeader,
  readUint,
  readUtf8String,
  UNKNOWN_SIZE,
} from './ebml';
import { assScriptOf, type MatroskaTextFormat, PICTURE_CODECS, TEXT_CODECS } from './matroska-text';
import { type ByteSource, countedSource, type ReadSignal, type ReadStats } from './source';

/**
 * Reads what a Matroska (MKV, WebM) file says about itself and its subtitle
 * tracks with a few small byte-range reads, never the video: the head (the
 * EBML header, the SeekHeads, Info and Tracks) from the first 64 KB, then
 * the Cues, the file's index, which gives every subtitle line's start and
 * length and where its block is. The lines' text is read block by block
 * (matroska-blocks.ts), a window at a time (matroska-window.ts).
 *
 * Pure ES2017 for the TV's Chromium 68: no BigInt, every 8-byte value read
 * as a Number and refused past 2^53 - 1. Nothing here fetches or logs: the
 * platform hands over a ByteSource, and a file is known by its tracks only.
 */

/** Why a file cannot give its subtitles this way, found as early and as cheaply as possible. */
export type MatroskaRejection =
  /** No EBML header, or a DocType other than matroska or webm (an MP4, an AVI, a playlist). */
  | 'not-matroska'
  /** An element that cannot be read: a broken size, an element past its parent, a file cut short. */
  | 'corrupt'
  /** A value past 2^53 - 1, or an element larger than the reader will hold. */
  | 'too-large'
  | 'no-tracks'
  /** A seekable file with no Cues to say where its blocks are. */
  | 'no-cues'
  /** A live or streamed file: a Segment of unknown size and no Cues, written as it went. */
  | 'unseekable'
  /** Cues that index no subtitle track: files muxed before 2013 index only video. */
  | 'cues-video-only';

export type MatroskaTrackKind = 'video' | 'audio' | 'subtitle' | 'other';

export type MatroskaCompression = 'zlib' | 'bzlib' | 'lzo' | 'header-stripping' | 'unknown';

/** Why the reader cannot give a track's lines in this engine. */
export type MatroskaUnreadable =
  /** Pictures (PGS, VobSub, DVB) or a format the reader does not know. */
  | 'not-text'
  | 'encrypted'
  /** bzlib or LZO, or zlib where the engine has no DecompressionStream (Chromium before 80). */
  | 'compression';

export interface MatroskaTrack {
  number: number;
  kind: MatroskaTrackKind;
  codecId: string;
  /** A subtitle track's lines are text the reader turns into cues, or pictures it does not decode. */
  subtitle?: 'text' | 'picture' | 'other';
  /** How a text track writes each line. */
  textFormat?: MatroskaTextFormat;
  /** The Language element, an ISO 639-2 code; "eng" when the file leaves it out. */
  language: string;
  /** The LanguageIETF element (BCP 47), which takes the place of Language when present. */
  languageIetf?: string;
  name?: string;
  forced: boolean;
  default: boolean;
  enabled: boolean;
  hearingImpaired: boolean;
  /** FlagCommentary: commentary on the film (a director's, the cast's), not its own words. */
  commentary: boolean;
  /** How the track's frames are compressed, if they are. */
  compression?: MatroskaCompression;
  encrypted: boolean;
  /** Absent when the reader can give this track's lines. */
  unreadable?: MatroskaUnreadable;
  /** Video: nanoseconds each frame lasts (DefaultDuration). */
  frameDuration?: number;
  /** Video: frames a second, from frameDuration. */
  frameRate?: number;
}

/**
 * zlib (RFC 1950) to its bytes. Rejects on data that is not zlib, and as
 * soon as the bytes would pass `maxLength`, so a small block cannot make
 * gigabytes.
 */
export type Inflate = (data: Uint8Array, maxLength: number) => Promise<Uint8Array>;

export interface MatroskaOptions {
  /**
   * Inflates zlib-compressed tracks. Left out, the engine's
   * DecompressionStream is used where there is one; null treats zlib as
   * unreadable (as on webOS 5).
   */
  inflate?: Inflate | null;
  /** Bytes read first from the start of the file. */
  headRead?: number;
  /** Aborts the head's reads, which the reader sets no time limit on (see ByteSource). */
  signal?: ReadSignal;
}

interface ContentEncoding {
  order: number;
  /** 1: the frames, 2: the CodecPrivate. */
  scope: number;
  encrypted: boolean;
  compression?: MatroskaCompression;
  /** The bytes header stripping took off the front of each frame. */
  stripped?: Uint8Array;
}

/** What the reader keeps of a track to read its blocks. */
export interface TrackData {
  track: MatroskaTrack;
  /** Decoded, in the order a reader undoes them (highest ContentEncodingOrder first). */
  encodings: ContentEncoding[];
  /** An ASS or SSA track's script header. */
  script?: AssScript;
}

export interface MatroskaFile {
  tracks: MatroskaTrack[];
  /** Nanoseconds a timestamp tick lasts. */
  timestampScale: number;
  /** Seconds, from Info. */
  duration?: number;
  muxingApp?: string;
  writingApp?: string;
  /** Every read made for this file so far, head and lines together. */
  stats: ReadStats;
  /** Reads through `stats`, kept inside the file's size when that is known. */
  source: ByteSource;
  /** Where the Segment's data starts: positions in the SeekHead and Cues count from here. */
  segmentStart: number;
  /** Where the Cues element starts in the file. */
  cuesPosition: number;
  /** How many SeekHeads were followed. */
  seekHeads: number;
  inflate?: Inflate;
  trackData: Map<number, TrackData>;
}

export type MatroskaOpened =
  { ok: true; file: MatroskaFile } | { ok: false; reason: MatroskaRejection; stats: ReadStats };

const HEAD_READ = 64 * 1024;
/** Read at an element's position when it is not in the head: a SeekHead, Info or Tracks. */
const ELEMENT_GUESS = 4096;
const MAX_SEEK_HEAD = 4 * 1024 * 1024;
const MAX_INFO = 1024 * 1024;
const MAX_TRACKS = 4 * 1024 * 1024;
const MAX_CUES = 16 * 1024 * 1024;
const MAX_SEEK_HEADS = 8;
/** The most a track's CodecPrivate (an ASS script's header, about 200 KB at most in real files) inflates to. */
const MAX_INFLATED_PRIVATE = 1024 * 1024;
/** zlib is fed in pieces this long, so an engine that inflates a piece at a time holds little more than the limit. */
const INFLATE_PIECE = 1024;
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DEFAULT_TIMESTAMP_SCALE = 1000000;

/** Seconds from timestamp ticks. */
export function ticksToSeconds(ticks: number, scale: number): number {
  return (ticks * scale) / 1e9;
}

interface StreamPair {
  readable: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  };
  writable: {
    getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> };
  };
}
// The engine's own, where it has one (Chromium 80 and later); the core is typed without the DOM.
declare const DecompressionStream: (new (format: 'deflate') => StreamPair) | undefined;

/** zlib through the engine's DecompressionStream, or undefined where there is none. */
export function engineInflate(): Inflate | undefined {
  if (typeof DecompressionStream === 'undefined') return undefined;
  const Stream = DecompressionStream;
  return async (data, maxLength) => {
    const stream = new Stream('deflate');
    const writer = stream.writable.getWriter();
    // Bad data rejects the reads below; these would otherwise reject unseen.
    for (let at = 0; at < data.length; at += INFLATE_PIECE) {
      writer.write(data.subarray(at, at + INFLATE_PIECE)).catch(() => undefined);
    }
    writer.close().catch(() => undefined);
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      length += value.length;
      if (length > maxLength) {
        reader.cancel().catch(() => undefined);
        throw new Error('too-large');
      }
      chunks.push(value);
    }
    // Joined once: joining as the chunks come copies the bytes again for each.
    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  };
}

function rejected(reason: MatroskaRejection, stats: ReadStats): MatroskaOpened {
  return { ok: false, reason, stats };
}

function problemOf(error: EbmlError): 'too-large' | 'corrupt' {
  return error.problem === 'too-large' ? 'too-large' : 'corrupt';
}

/**
 * Reads an element whose ID is known to be at `at`: from the head when it
 * is all there, otherwise with one read at its position and, when it is
 * longer than that read, one more for the rest.
 */
async function loadElement(
  source: ByteSource,
  head: Uint8Array,
  at: number,
  id: number,
  limit: number,
  signal: ReadSignal | undefined,
): Promise<{ bytes: Uint8Array; dataStart: number }> {
  let bytes =
    at + 16 <= head.length ? head.subarray(at) : await source.read(at, ELEMENT_GUESS, signal);
  const header = readHeader(bytes, 0);
  if (!header) throw new EbmlError('corrupt', 'an element cut short');
  if (header.id !== id) throw new EbmlError('corrupt', 'another element where one was expected');
  if (header.size === UNKNOWN_SIZE)
    throw new EbmlError('corrupt', 'a head element of unknown size');
  if (header.size > limit) throw new EbmlError('too-large', 'an element over its limit');
  const total = header.headerLength + header.size;
  if (total > bytes.length) {
    const rest = await source.read(at + bytes.length, total - bytes.length, signal);
    if (rest.length < total - bytes.length) throw new EbmlError('corrupt', 'a file cut short');
    bytes = concatBytes(bytes, rest);
  }
  return { bytes: bytes.subarray(0, total), dataStart: header.headerLength };
}

function readDocType(head: Uint8Array): { docType: string; readVersion: number; end: number } {
  const header = readHeader(head, 0);
  if (!header || header.size === UNKNOWN_SIZE) throw new EbmlError('corrupt', 'no EBML header');
  const end = header.headerLength + header.size;
  if (end > head.length) throw new EbmlError('corrupt', 'an EBML header cut short');
  let docType = 'matroska';
  let readVersion = 1;
  for (const child of children(head, header.headerLength, end)) {
    if (child.id === ID.DOC_TYPE) docType = readAscii(head, child.dataStart, child.end);
    else if (child.id === ID.DOC_TYPE_READ_VERSION) {
      readVersion = readUint(head, child.dataStart, child.end);
    }
  }
  return { docType, readVersion, end };
}

/** A SeekHead's entries: the element IDs it points to, at file positions. */
function readSeekHead(bytes: Uint8Array, dataStart: number, segmentStart: number) {
  const entries: Array<{ id: number; position: number }> = [];
  for (const seek of children(bytes, dataStart, bytes.length)) {
    if (seek.id !== ID.SEEK) continue;
    let id: number | undefined;
    let position: number | undefined;
    for (const field of children(bytes, seek.dataStart, seek.end)) {
      if (field.id === ID.SEEK_ID && field.end - field.dataStart <= 4) {
        id = readUint(bytes, field.dataStart, field.end);
      } else if (field.id === ID.SEEK_POSITION) {
        position = readUint(bytes, field.dataStart, field.end);
      }
    }
    if (id !== undefined && position !== undefined) {
      entries.push({ id, position: segmentStart + position });
    }
  }
  return entries;
}

function readInfo(bytes: Uint8Array, dataStart: number) {
  let timestampScale = DEFAULT_TIMESTAMP_SCALE;
  let duration: number | undefined;
  let muxingApp: string | undefined;
  let writingApp: string | undefined;
  for (const child of children(bytes, dataStart, bytes.length)) {
    if (child.id === ID.TIMESTAMP_SCALE) {
      timestampScale = readUint(bytes, child.dataStart, child.end) || DEFAULT_TIMESTAMP_SCALE;
    } else if (child.id === ID.DURATION) duration = readFloat(bytes, child.dataStart, child.end);
    else if (child.id === ID.MUXING_APP)
      muxingApp = readUtf8String(bytes, child.dataStart, child.end);
    else if (child.id === ID.WRITING_APP) {
      writingApp = readUtf8String(bytes, child.dataStart, child.end);
    }
  }
  return { timestampScale, duration, muxingApp, writingApp };
}

const COMPRESSIONS: Record<number, MatroskaCompression> = {
  0: 'zlib',
  1: 'bzlib',
  2: 'lzo',
  3: 'header-stripping',
};

function readEncodings(bytes: Uint8Array, start: number, end: number): ContentEncoding[] {
  const encodings: ContentEncoding[] = [];
  for (const entry of children(bytes, start, end)) {
    if (entry.id !== ID.CONTENT_ENCODING) continue;
    const encoding: ContentEncoding = { order: 0, scope: 1, encrypted: false };
    let type = 0;
    for (const field of children(bytes, entry.dataStart, entry.end)) {
      if (field.id === ID.CONTENT_ENCODING_ORDER) {
        encoding.order = readUint(bytes, field.dataStart, field.end);
      } else if (field.id === ID.CONTENT_ENCODING_SCOPE) {
        encoding.scope = readUint(bytes, field.dataStart, field.end);
      } else if (field.id === ID.CONTENT_ENCODING_TYPE) {
        type = readUint(bytes, field.dataStart, field.end);
      } else if (field.id === ID.CONTENT_ENCRYPTION) {
        encoding.encrypted = true;
      } else if (field.id === ID.CONTENT_COMPRESSION) {
        let algorithm = 0;
        for (const part of children(bytes, field.dataStart, field.end)) {
          if (part.id === ID.CONTENT_COMP_ALGO) {
            algorithm = readUint(bytes, part.dataStart, part.end);
          } else if (part.id === ID.CONTENT_COMP_SETTINGS) {
            encoding.stripped = bytes.slice(part.dataStart, part.end);
          }
        }
        encoding.compression = COMPRESSIONS[algorithm] ?? 'unknown';
      }
    }
    if (type === 1) encoding.encrypted = true;
    if (type !== 0) delete encoding.compression;
    encodings.push(encoding);
  }
  // A reader undoes the encoding with the highest order first.
  return encodings.sort((a, b) => b.order - a.order);
}

const TRACK_KINDS: Record<number, MatroskaTrackKind> = { 1: 'video', 2: 'audio', 0x11: 'subtitle' };

function readTrack(
  bytes: Uint8Array,
  start: number,
  end: number,
): { track: MatroskaTrack; encodings: ContentEncoding[]; codecPrivate?: Uint8Array } | undefined {
  const track: MatroskaTrack = {
    number: 0,
    kind: 'other',
    codecId: '',
    language: 'eng',
    forced: false,
    default: true,
    enabled: true,
    hearingImpaired: false,
    commentary: false,
    encrypted: false,
  };
  let encodings: ContentEncoding[] = [];
  let codecPrivate: Uint8Array | undefined;
  for (const field of children(bytes, start, end)) {
    const { dataStart, end: fieldEnd } = field;
    switch (field.id) {
      case ID.TRACK_NUMBER:
        track.number = readUint(bytes, dataStart, fieldEnd);
        break;
      case ID.TRACK_TYPE:
        track.kind = TRACK_KINDS[readUint(bytes, dataStart, fieldEnd)] ?? 'other';
        break;
      case ID.CODEC_ID:
        track.codecId = readAscii(bytes, dataStart, fieldEnd);
        break;
      case ID.CODEC_PRIVATE:
        codecPrivate = bytes.slice(dataStart, fieldEnd);
        break;
      case ID.LANGUAGE:
        track.language = readAscii(bytes, dataStart, fieldEnd) || 'eng';
        break;
      case ID.LANGUAGE_IETF:
        track.languageIetf = readAscii(bytes, dataStart, fieldEnd);
        break;
      case ID.NAME:
        track.name = readUtf8String(bytes, dataStart, fieldEnd);
        break;
      case ID.FLAG_FORCED:
        track.forced = readUint(bytes, dataStart, fieldEnd) !== 0;
        break;
      case ID.FLAG_DEFAULT:
        track.default = readUint(bytes, dataStart, fieldEnd) !== 0;
        break;
      case ID.FLAG_ENABLED:
        track.enabled = readUint(bytes, dataStart, fieldEnd) !== 0;
        break;
      case ID.FLAG_HEARING_IMPAIRED:
        track.hearingImpaired = readUint(bytes, dataStart, fieldEnd) !== 0;
        break;
      case ID.FLAG_COMMENTARY:
        track.commentary = readUint(bytes, dataStart, fieldEnd) !== 0;
        break;
      case ID.DEFAULT_DURATION:
        track.frameDuration = readUint(bytes, dataStart, fieldEnd) || undefined;
        break;
      case ID.CONTENT_ENCODINGS:
        encodings = readEncodings(bytes, dataStart, fieldEnd);
        break;
      default:
    }
  }
  if (track.number === 0) return undefined;
  if (track.kind !== 'video') delete track.frameDuration;
  if (track.frameDuration !== undefined) {
    track.frameRate = Math.round(1e12 / track.frameDuration) / 1000;
  }
  return { track, encodings, codecPrivate };
}

/**
 * Undoes a track's encodings on one frame or its CodecPrivate (`scope` 1 or
 * 2); rejects past `maxLength` bytes inflated.
 */
export async function decodeContent(
  data: Uint8Array,
  encodings: readonly ContentEncoding[],
  scope: number,
  inflate: Inflate | undefined,
  maxLength: number,
): Promise<Uint8Array> {
  let bytes = data;
  for (const encoding of encodings) {
    if ((encoding.scope & scope) === 0) continue;
    if (encoding.encrypted) throw new Error('encrypted');
    if (encoding.compression === 'header-stripping') {
      if (encoding.stripped) bytes = concatBytes(encoding.stripped, bytes);
    } else if (encoding.compression === 'zlib' && inflate) {
      bytes = await inflate(bytes, maxLength);
      // An inflate handed in may not stop itself.
      if (bytes.length > maxLength) throw new Error('too-large');
    } else if (encoding.compression !== undefined) {
      throw new Error('compression');
    }
  }
  return bytes;
}

function describeEncodings(
  track: MatroskaTrack,
  encodings: readonly ContentEncoding[],
  inflate: Inflate | undefined,
): void {
  let unreadable: MatroskaUnreadable | undefined;
  for (const encoding of encodings) {
    if (encoding.encrypted) {
      track.encrypted = true;
      unreadable = 'encrypted';
      continue;
    }
    if (encoding.compression === undefined) continue;
    if (encoding.scope & 1) track.compression = encoding.compression;
    const supported =
      encoding.compression === 'header-stripping' ||
      (encoding.compression === 'zlib' && inflate !== undefined);
    if (!supported && unreadable === undefined) unreadable = 'compression';
  }
  if (track.subtitle !== 'text') unreadable = 'not-text';
  if (unreadable) track.unreadable = unreadable;
}

async function readTracks(
  bytes: Uint8Array,
  dataStart: number,
  inflate: Inflate | undefined,
): Promise<Map<number, TrackData>> {
  const data = new Map<number, TrackData>();
  for (const entry of children(bytes, dataStart, bytes.length)) {
    if (entry.id !== ID.TRACK_ENTRY) continue;
    const read = readTrack(bytes, entry.dataStart, entry.end);
    if (!read || data.has(read.track.number)) continue;
    const { track, encodings, codecPrivate } = read;
    if (track.kind === 'subtitle') {
      const format = TEXT_CODECS[track.codecId];
      if (format) {
        track.subtitle = 'text';
        track.textFormat = format;
      } else {
        track.subtitle = PICTURE_CODECS.indexOf(track.codecId) !== -1 ? 'picture' : 'other';
      }
    }
    describeEncodings(track, encodings, inflate);
    const trackData: TrackData = { track, encodings };
    if (!track.unreadable && (track.textFormat === 'ass' || track.textFormat === 'ssa')) {
      try {
        const header = codecPrivate
          ? await decodeContent(codecPrivate, encodings, 2, inflate, MAX_INFLATED_PRIVATE)
          : undefined;
        trackData.script = assScriptOf(header);
      } catch {
        track.unreadable = 'compression';
      }
    }
    data.set(track.number, trackData);
  }
  return data;
}

/**
 * Reads a Matroska file's head: the EBML header, every SeekHead (one that
 * another points to included), Info and Tracks. Rejects at once, from the
 * first read, a file that is not Matroska and one with no Cues (a live or
 * streamed file among them). A read that fails rejects the promise.
 */
export async function openMatroska(
  input: ByteSource,
  options: MatroskaOptions = {},
): Promise<MatroskaOpened> {
  const stats: ReadStats = { requests: 0, bytes: 0 };
  const source = countedSource(input, stats);
  const inflate = options.inflate === null ? undefined : (options.inflate ?? engineInflate());
  const { signal } = options;
  const head = await source.read(0, options.headRead ?? HEAD_READ, signal);
  if (EBML_MAGIC.some((byte, i) => head[i] !== byte)) return rejected('not-matroska', stats);

  try {
    const { docType, readVersion, end } = readDocType(head);
    if ((docType !== 'matroska' && docType !== 'webm') || readVersion > 4) {
      return rejected('not-matroska', stats);
    }

    let at = end;
    let segment = readHeader(head, at);
    while (segment && segment.id === ID.VOID && segment.size !== UNKNOWN_SIZE) {
      at += segment.headerLength + segment.size;
      segment = readHeader(head, at);
    }
    if (!segment || segment.id !== ID.SEGMENT) return rejected('corrupt', stats);
    const segmentStart = at + segment.headerLength;
    const segmentEnd = segment.size === UNKNOWN_SIZE ? input.size : segmentStart + segment.size;

    // The top-level elements in the head, up to the first Cluster.
    const positions = new Map<number, number>();
    const seekHeads: number[] = [];
    at = segmentStart;
    for (;;) {
      if (segmentEnd !== undefined && at >= segmentEnd) break;
      const header = readHeader(head, at);
      if (!header || header.id === ID.CLUSTER || header.size === UNKNOWN_SIZE) break;
      if (header.id === ID.SEEK_HEAD) seekHeads.push(at);
      else if (!positions.has(header.id)) positions.set(header.id, at);
      at += header.headerLength + header.size;
    }

    // Every SeekHead, and every SeekHead they point to; the first position given for an element wins.
    const visited = new Set<number>();
    while (seekHeads.length > 0 && visited.size < MAX_SEEK_HEADS) {
      const position = seekHeads.shift()!;
      if (visited.has(position)) continue;
      visited.add(position);
      const { bytes, dataStart } = await loadElement(
        source,
        head,
        position,
        ID.SEEK_HEAD,
        MAX_SEEK_HEAD,
        signal,
      );
      for (const entry of readSeekHead(bytes, dataStart, segmentStart)) {
        if (input.size !== undefined && entry.position >= input.size) continue;
        if (entry.id === ID.SEEK_HEAD) seekHeads.push(entry.position);
        else if (entry.id !== ID.CLUSTER && !positions.has(entry.id)) {
          positions.set(entry.id, entry.position);
        }
      }
    }

    const tracksAt = positions.get(ID.TRACKS);
    if (tracksAt === undefined) return rejected('no-tracks', stats);
    const cuesPosition = positions.get(ID.CUES);
    if (cuesPosition === undefined) {
      return rejected(segment.size === UNKNOWN_SIZE ? 'unseekable' : 'no-cues', stats);
    }

    const infoAt = positions.get(ID.INFO);
    const info =
      infoAt === undefined
        ? readInfo(new Uint8Array(0), 0)
        : await loadElement(source, head, infoAt, ID.INFO, MAX_INFO, signal).then(
            ({ bytes, dataStart }) => readInfo(bytes, dataStart),
          );
    const tracksElement = await loadElement(source, head, tracksAt, ID.TRACKS, MAX_TRACKS, signal);
    const trackData = await readTracks(tracksElement.bytes, tracksElement.dataStart, inflate);
    if (trackData.size === 0) return rejected('no-tracks', stats);

    const file: MatroskaFile = {
      tracks: Array.from(trackData.values(), (data) => data.track),
      timestampScale: info.timestampScale,
      stats,
      source,
      segmentStart,
      cuesPosition,
      seekHeads: visited.size,
      trackData,
    };
    if (info.duration !== undefined) {
      file.duration = ticksToSeconds(info.duration, info.timestampScale);
    }
    if (info.muxingApp !== undefined) file.muxingApp = info.muxingApp;
    if (info.writingApp !== undefined) file.writingApp = info.writingApp;
    if (inflate) file.inflate = inflate;
    return { ok: true, file };
  } catch (error) {
    if (error instanceof EbmlError) return rejected(problemOf(error), stats);
    throw error;
  }
}

/** One cue point of a track: where one of its blocks starts in time and in the file. */
export interface CueEntry {
  /** Timestamp ticks (Info's TimestampScale). */
  time: number;
  /** Ticks, when the Cues give it (CueDuration). */
  duration?: number;
  /** Where the block's Cluster starts in the file. */
  cluster: number;
  /** Where the block starts in the Cluster's data (CueRelativePosition). */
  relative?: number;
}

export interface CueCount {
  /** Cue points for the track. */
  points: number;
  /** Of which with a CueRelativePosition. */
  relative: number;
  /** Of which with a CueDuration. */
  duration: number;
}

export interface MatroskaCues {
  /** The cue points of the tracks asked for, by track number, in time order. */
  entries: Map<number, CueEntry[]>;
  /** Every track the Cues index, asked for or not. */
  counts: Map<number, CueCount>;
  /** The Cues element's size in bytes. */
  size: number;
}

export type MatroskaCuesRead =
  | { ok: true; cues: MatroskaCues }
  | { ok: false; reason: 'corrupt' | 'too-large' | 'cues-video-only' };

export interface CuesOptions {
  /** The first read's size: small Cues, as video-only ones are, are read whole in it. */
  firstRead?: number;
  /** Each later read's size. */
  chunk?: number;
  /** Cue points kept for one track, past which the Cues are 'too-large'. */
  maxTrackEntries?: number;
  /** Cue points kept for all the tracks asked for together, likewise. */
  maxEntries?: number;
  /** Aborts the Cues' reads, which the reader sets no time limit on (see ByteSource). */
  signal?: ReadSignal;
}

const FIRST_CUES_READ = 64 * 1024;
const CUES_CHUNK = 256 * 1024;
/**
 * A film's track has 1,000 to 2,000 lines and a heavy karaoke track tens of
 * thousands, while 16 MB of Cues can hold a million: past these, a file is
 * turned away before its cue points fill the TV's memory.
 */
const MAX_TRACK_ENTRIES = 100000;
const MAX_ENTRIES = 200000;

interface CueLimits {
  perTrack: number;
  total: number;
  /** Cue points kept so far, all tracks together. */
  kept: number;
}

/**
 * One CuePoint's positions into `cues`. Run for every cue point of a file,
 * so written without object spread, which an ES2017 build turns into a slow
 * helper call.
 */
function readCuePoint(
  bytes: Uint8Array,
  start: number,
  end: number,
  file: MatroskaFile,
  wanted: ReadonlySet<number>,
  cues: MatroskaCues,
  limits: CueLimits,
): void {
  let time: number | undefined;
  // A CueTime comes first in every muxer's files, but may come after the positions.
  const positions: CueEntry[] = [];
  const tracks: number[] = [];
  for (const field of children(bytes, start, end)) {
    if (field.id === ID.CUE_TIME) time = readUint(bytes, field.dataStart, field.end);
    else if (field.id === ID.CUE_TRACK_POSITIONS) {
      let track: number | undefined;
      let cluster: number | undefined;
      let relative: number | undefined;
      let duration: number | undefined;
      for (const part of children(bytes, field.dataStart, field.end)) {
        if (part.id === ID.CUE_TRACK) track = readUint(bytes, part.dataStart, part.end);
        else if (part.id === ID.CUE_CLUSTER_POSITION) {
          cluster = readUint(bytes, part.dataStart, part.end);
        } else if (part.id === ID.CUE_RELATIVE_POSITION) {
          relative = readUint(bytes, part.dataStart, part.end);
        } else if (part.id === ID.CUE_DURATION) {
          duration = readUint(bytes, part.dataStart, part.end);
        }
      }
      // Tracks the file does not have are not counted, so a made-up number cannot fill the map.
      if (track === undefined || cluster === undefined || !file.trackData.has(track)) continue;
      const entry: CueEntry = { time: 0, cluster: file.segmentStart + cluster };
      if (relative !== undefined) entry.relative = relative;
      if (duration !== undefined) entry.duration = duration;
      positions.push(entry);
      tracks.push(track);
    }
  }
  if (time === undefined) return;
  for (let i = 0; i < positions.length; i++) {
    const track = tracks[i]!;
    const entry = positions[i]!;
    entry.time = time;
    let count = cues.counts.get(track);
    if (!count) {
      count = { points: 0, relative: 0, duration: 0 };
      cues.counts.set(track, count);
    }
    count.points++;
    if (entry.relative !== undefined) count.relative++;
    if (entry.duration !== undefined) count.duration++;
    if (!wanted.has(track)) continue;
    const list = cues.entries.get(track)!;
    if (list.length >= limits.perTrack || limits.kept >= limits.total) {
      throw new EbmlError('too-large', 'more cue points than a subtitle track has');
    }
    list.push(entry);
    limits.kept++;
  }
}

function indexesSubtitles(file: MatroskaFile, cues: MatroskaCues): boolean {
  for (const track of cues.counts.keys()) {
    if (file.trackData.get(track)?.track.kind === 'subtitle') return true;
  }
  return false;
}

/** The text subtitle tracks the reader can give lines of. */
export function readableTextTracks(file: MatroskaFile): MatroskaTrack[] {
  return file.tracks.filter((track) => track.subtitle === 'text' && !track.unreadable);
}

/**
 * Reads the Cues and keeps the cue points of `tracks` only (by default every
 * text subtitle track), so memory holds those however many languages the
 * file indexes: Cues run to about 1 MB for a file with 30 subtitle tracks,
 * read in chunks and parsed as they come. Cues that index no subtitle track
 * are rejected, after the first read when the cue points read so far have no
 * CueRelativePosition either, as only muxers from before 2013 write them so.
 */
export async function readMatroskaCues(
  file: MatroskaFile,
  tracks: readonly number[] = file.tracks
    .filter((track) => track.subtitle === 'text')
    .map((track) => track.number),
  options: CuesOptions = {},
): Promise<MatroskaCuesRead> {
  const wanted = new Set(tracks);
  const cues: MatroskaCues = { entries: new Map(), counts: new Map(), size: 0 };
  for (const track of wanted) cues.entries.set(track, []);
  const chunk = options.chunk ?? CUES_CHUNK;
  const limits: CueLimits = {
    perTrack: options.maxTrackEntries ?? MAX_TRACK_ENTRIES,
    total: options.maxEntries ?? MAX_ENTRIES,
    kept: 0,
  };
  const { signal } = options;

  try {
    const position = file.cuesPosition;
    const first = await file.source.read(position, options.firstRead ?? FIRST_CUES_READ, signal);
    const header = readHeader(first, 0);
    if (!header || header.id !== ID.CUES || header.size === UNKNOWN_SIZE) {
      return { ok: false, reason: 'corrupt' };
    }
    if (header.size > MAX_CUES) return { ok: false, reason: 'too-large' };
    cues.size = header.size;
    const end = position + header.headerLength + header.size;

    let buffer = first.subarray(header.headerLength);
    let bufferStart = position + header.headerLength;
    let next = position + first.length;
    let offset = 0;
    let firstRead = true;
    while (bufferStart + offset < end) {
      const point = readHeader(buffer, offset);
      const pointEnd =
        point && point.size !== UNKNOWN_SIZE ? offset + point.headerLength + point.size : Infinity;
      if (!point || pointEnd > buffer.length) {
        if (next >= end) return { ok: false, reason: 'corrupt' };
        if (firstRead) {
          firstRead = false;
          const anyRelative = Array.from(cues.counts.values()).some((count) => count.relative > 0);
          if (cues.counts.size > 0 && !anyRelative && !indexesSubtitles(file, cues)) {
            return { ok: false, reason: 'cues-video-only' };
          }
        }
        const more = await file.source.read(next, Math.min(chunk, end - next), signal);
        if (more.length === 0) return { ok: false, reason: 'corrupt' };
        buffer = concatBytes(buffer.subarray(offset), more);
        bufferStart += offset;
        offset = 0;
        next += more.length;
        continue;
      }
      if (point.id === ID.CUE_POINT) {
        readCuePoint(buffer, offset + point.headerLength, pointEnd, file, wanted, cues, limits);
      }
      offset = pointEnd;
    }
  } catch (error) {
    if (error instanceof EbmlError) return { ok: false, reason: problemOf(error) };
    throw error;
  }

  if (!indexesSubtitles(file, cues)) return { ok: false, reason: 'cues-video-only' };
  for (const list of cues.entries.values()) {
    // In time order, and in file order for cue points at the same time (Chromium 68 sorts unstably).
    list.sort(
      (a, b) => a.time - b.time || a.cluster - b.cluster || (a.relative ?? 0) - (b.relative ?? 0),
    );
  }
  return { ok: true, cues };
}

/** A line's time from the Cues alone, in seconds: `end` is absent when the Cues give no duration. */
export interface LineTiming {
  start: number;
  end?: number;
}

/**
 * Every line's start and end from the Cues alone, none of the text read:
 * the timing a subtitle file can be checked against. Ends are worked out
 * from ticks, so they are as exact as the starts.
 */
export function cueTimings(file: MatroskaFile, entries: readonly CueEntry[]): LineTiming[] {
  const scale = file.timestampScale;
  return entries.map((entry) => {
    const timing: LineTiming = { start: ticksToSeconds(entry.time, scale) };
    if (entry.duration !== undefined && entry.duration > 0) {
      timing.end = ticksToSeconds(entry.time + entry.duration, scale);
    }
    return timing;
  });
}
