import type { Cue } from '../subtitles/types';
import {
  children,
  concatBytes,
  EbmlError,
  ID,
  readHeader,
  readUint,
  readVint,
  UNKNOWN_SIZE,
} from './ebml';
import {
  type CueEntry,
  decodeContent,
  type MatroskaFile,
  ticksToSeconds,
  type TrackData,
} from './matroska';
import { matroskaTextCue } from './matroska-text';

/**
 * Reads a text track's lines block by block, at the places the Cues give:
 * a block starts CueRelativePosition bytes into its Cluster's data, and the
 * Cluster at CueClusterPosition from the Segment's data.
 *
 * Where the Cluster's data starts depends on how many bytes its size took
 * (1 to 8), which only reading the Cluster's head tells. Reading it costs a
 * request per line, as lines almost always sit in clusters of their own, so
 * by default the reader reads the 7 bytes either side instead: from where
 * the block starts if the size took 1 byte to where it starts if it took 8,
 * and finds the one place a block of this track starts, its BlockGroup
 * parsing whole. A place that is not certain (none, or two that do not nest)
 * falls back to reading the Cluster's head. A Cluster's head is read too,
 * at no extra request, when it sits in the same read as its block; its
 * Timestamp then checks the block's time against the cue's.
 */

export interface BlockReaderOptions {
  /** The most one read asks for, however many blocks it covers. */
  maxRead?: number;
  /** Two blocks this close (bytes between them) are read together, gap and all. */
  mergeGap?: number;
  /**
   * 'always' reads every Cluster's head (its size and Timestamp) before its
   * blocks: two requests per line where lines sit in clusters of their own.
   */
  clusterHeads?: 'when-needed' | 'always';
}

/** Why a line has no cue. */
export type LineProblem =
  /** The cue point gives no CueRelativePosition, so the block cannot be found without the whole Cluster. */
  | 'no-position'
  /** Nothing at the place the Cues give is a block of this track. */
  | 'not-found'
  /** A laced block, which text tracks never use. */
  | 'laced'
  /** The block could not be decompressed. */
  | 'undecodable'
  /** The block holds nothing to draw (an empty line, a vector drawing). */
  | 'empty';

export interface LineRequest {
  /** The entry's place in the track's list, handed back with its line. */
  index: number;
  entry: CueEntry;
  /** The next line's start (ticks), used for a line whose length nothing gives. */
  nextTime?: number;
}

export interface LineResult {
  index: number;
  cue?: Cue;
  problem?: LineProblem;
}

/** Lines whose blocks sit close together in the file, read in one go. */
export interface PlannedRead {
  start: number;
  end: number;
  lines: LineRequest[];
}

export interface BlockReaderStats {
  /** Lines with a cue. */
  lines: number;
  /** Lines without one, by why. */
  problems: Partial<Record<LineProblem, number>>;
  /** Cluster heads read on their own (not in the same read as a block). */
  headReads: number;
  /** Blocks longer than the bytes first read for them, read again in full. */
  rereads: number;
  /** Blocks whose place was not certain from the Cues, found by reading their Cluster's head. */
  fallbacks: number;
  /** Blocks whose own time (Cluster Timestamp + block timecode) differs from the cue's. */
  timeMismatches: number;
}

const MAX_READ = 64 * 1024;
const MERGE_GAP = 16 * 1024;
/** An ID of 4 bytes and a size of 1 to 8. */
const MIN_CLUSTER_HEADER = 5;
const MAX_CLUSTER_HEADER = 12;
/** A Cluster's head: its header, a CRC-32 and its Timestamp. */
const CLUSTER_HEAD_READ = 64;
const MAX_TEXT_BLOCK = 256 * 1024;
const FIRST_GUESS = 256;
const MAX_GUESS = 2048;
/** A line nothing gives a length to stays up to this long, or until the next one. */
const NO_DURATION_TICKS_SECONDS = 4;
const MAX_CLUSTER_HEADS = 4096;

interface ClusterHead {
  dataStart: number;
  /** Ticks; absent when the head read did not reach it. */
  timestamp?: number;
}

interface Block {
  /** File positions. */
  start: number;
  end: number;
  payload: Uint8Array;
  timecode: number;
  laced: boolean;
  duration?: number;
  addition?: Uint8Array;
}

/** A block element parsed, or how many bytes from its start it needs, or not a block of the track. */
type Parsed = Block | { needs: number } | undefined;

/** Bytes read from the file at `start`. */
interface Bytes {
  start: number;
  data: Uint8Array;
}

const GROUP_CHILDREN = new Set<number>([
  ID.BLOCK,
  ID.BLOCK_DURATION,
  ID.BLOCK_ADDITIONS,
  ID.REFERENCE_BLOCK,
  ID.REFERENCE_PRIORITY,
  ID.CODEC_STATE,
  ID.DISCARD_PADDING,
]);

function readBlockBody(
  data: Uint8Array,
  start: number,
  end: number,
  track: number,
): Pick<Block, 'payload' | 'timecode' | 'laced'> | undefined {
  const number = readVint(data, start);
  if (!number || number.value !== track) return undefined;
  const at = start + number.length;
  if (at + 3 > end) return undefined;
  const raw = (data[at]! << 8) | data[at + 1]!;
  const timecode = raw >= 0x8000 ? raw - 0x10000 : raw;
  const flags = data[at + 2]!;
  return { payload: data.subarray(at + 3, end), timecode, laced: (flags & 0x06) !== 0 };
}

/**
 * The block element at `at` in `data` (`fileStart` its first byte's place in
 * the file): a BlockGroup, a bare Block (mkvmerge 5.9.0 to 6.3.0 point the
 * Cues at the Block inside the group) or a SimpleBlock, of `track`. `strict`
 * refuses any element a BlockGroup does not hold, as a place guessed at
 * must parse as nothing but a block.
 */
function parseBlockAt(
  data: Uint8Array,
  at: number,
  fileStart: number,
  track: number,
  strict: boolean,
): Parsed {
  try {
    const header = readHeader(data, at);
    if (!header) return { needs: MAX_CLUSTER_HEADER };
    if (header.id !== ID.BLOCK_GROUP && header.id !== ID.BLOCK && header.id !== ID.SIMPLE_BLOCK) {
      return undefined;
    }
    if (header.size === UNKNOWN_SIZE || header.size > MAX_TEXT_BLOCK) return undefined;
    const dataStart = at + header.headerLength;
    const end = dataStart + header.size;
    if (end > data.length) {
      // Check what is there before asking for the rest.
      if (header.id !== ID.BLOCK_GROUP) {
        if (!readBlockBody(data, dataStart, data.length, track)) return undefined;
      } else {
        const first = readHeader(data, dataStart);
        if (first && first.id !== ID.BLOCK && !GROUP_CHILDREN.has(first.id)) return undefined;
        if (first && first.id === ID.BLOCK) {
          const bodyAt = dataStart + first.headerLength;
          if (bodyAt < data.length && !readBlockBody(data, bodyAt, data.length, track)) {
            return undefined;
          }
        }
      }
      return { needs: end - at };
    }
    const block: Block = {
      start: fileStart + at,
      end: fileStart + end,
      payload: data,
      timecode: 0,
      laced: false,
    };
    if (header.id !== ID.BLOCK_GROUP) {
      const body = readBlockBody(data, dataStart, end, track);
      return body ? { ...block, ...body } : undefined;
    }
    let body: ReturnType<typeof readBlockBody>;
    let blocks = 0;
    for (const child of children(data, dataStart, end)) {
      if (child.id === ID.BLOCK) {
        blocks++;
        body = readBlockBody(data, child.dataStart, child.end, track);
      } else if (child.id === ID.BLOCK_DURATION) {
        block.duration = readUint(data, child.dataStart, child.end);
      } else if (child.id === ID.BLOCK_ADDITIONS) {
        for (const more of children(data, child.dataStart, child.end)) {
          if (more.id !== ID.BLOCK_MORE) continue;
          let id = 1;
          let additional: Uint8Array | undefined;
          for (const part of children(data, more.dataStart, more.end)) {
            if (part.id === ID.BLOCK_ADD_ID) id = readUint(data, part.dataStart, part.end);
            else if (part.id === ID.BLOCK_ADDITIONAL) {
              additional = data.subarray(part.dataStart, part.end);
            }
          }
          if (id === 1 && additional) block.addition = additional;
        }
      } else if (strict && !GROUP_CHILDREN.has(child.id)) return undefined;
    }
    if (blocks !== 1 || !body) return undefined;
    return { ...block, ...body };
  } catch (error) {
    if (error instanceof EbmlError) return undefined;
    throw error;
  }
}

function isBlock(parsed: Parsed): parsed is Block {
  return parsed !== undefined && !('needs' in parsed);
}

/**
 * A Cluster's head at `at` in `data`: where its data starts and, when the
 * bytes reach it, its Timestamp (after a CRC-32 or Void, if any).
 */
function parseClusterHead(
  data: Uint8Array,
  at: number,
  fileStart: number,
): ClusterHead | undefined {
  try {
    const header = readHeader(data, at);
    if (!header || header.id !== ID.CLUSTER) return undefined;
    const dataStart = at + header.headerLength;
    const head: ClusterHead = { dataStart: fileStart + dataStart };
    let child = dataStart;
    for (let i = 0; i < 3; i++) {
      const field = readHeader(data, child);
      if (!field || field.size === UNKNOWN_SIZE) break;
      const fieldEnd = child + field.headerLength + field.size;
      if (fieldEnd > data.length) break;
      if (field.id === ID.TIMESTAMP) {
        head.timestamp = readUint(data, child + field.headerLength, fieldEnd);
        break;
      }
      if (field.id !== ID.CRC32 && field.id !== ID.VOID) break;
      child = fieldEnd;
    }
    return head;
  } catch (error) {
    if (error instanceof EbmlError) return undefined;
    throw error;
  }
}

export interface BlockReader {
  /** Groups lines whose blocks sit close together into reads, in file order. */
  plan(lines: readonly LineRequest[]): PlannedRead[];
  /** Makes one planned read (and any it needs after) and turns its blocks into cues. */
  run(read: PlannedRead): Promise<LineResult[]>;
  readonly stats: BlockReaderStats;
}

/** A reader for one text track's blocks. */
export function createBlockReader(
  file: MatroskaFile,
  trackNumber: number,
  options: BlockReaderOptions = {},
): BlockReader {
  const data: TrackData | undefined = file.trackData.get(trackNumber);
  if (!data || data.track.unreadable || !data.track.textFormat) {
    throw new Error('not a readable text track');
  }
  const trackData = data;
  const format = data.track.textFormat;
  const maxRead = options.maxRead ?? MAX_READ;
  const mergeGap = options.mergeGap ?? MERGE_GAP;
  const alwaysHeads = options.clusterHeads === 'always';
  const scale = file.timestampScale;
  const heads = new Map<number, ClusterHead>();
  let guess = FIRST_GUESS;
  const stats: BlockReaderStats = {
    lines: 0,
    problems: {},
    headReads: 0,
    rereads: 0,
    fallbacks: 0,
    timeMismatches: 0,
  };

  function remember(cluster: number, head: ClusterHead) {
    if (heads.size >= MAX_CLUSTER_HEADS) heads.delete(heads.keys().next().value!);
    heads.set(cluster, head);
  }

  /** The bytes a line's block is in: exactly, or the 7 bytes either side of the guess. */
  function spanOf(line: LineRequest): { start: number; end: number } {
    const { cluster, relative = 0 } = line.entry;
    const head = heads.get(cluster);
    if (head) return { start: head.dataStart + relative, end: head.dataStart + relative + guess };
    const start = cluster + MIN_CLUSTER_HEADER + relative;
    const end = cluster + MAX_CLUSTER_HEADER + relative + guess;
    // A head this close comes in the same read, for nothing.
    return start - cluster <= mergeGap ? { start: cluster, end } : { start, end };
  }

  function plan(lines: readonly LineRequest[]): PlannedRead[] {
    const spans = lines
      .filter((line) => line.entry.relative !== undefined)
      .map((line) => ({ line, ...spanOf(line) }))
      .sort((a, b) => a.start - b.start || a.line.index - b.line.index);
    const reads: PlannedRead[] = [];
    let current: PlannedRead | undefined;
    for (const span of spans) {
      if (
        current &&
        span.start - current.end <= mergeGap &&
        Math.max(current.end, span.end) - current.start <= maxRead
      ) {
        current.end = Math.max(current.end, span.end);
        current.lines.push(span.line);
      } else {
        current = { start: span.start, end: span.end, lines: [span.line] };
        reads.push(current);
      }
    }
    // Lines with no position cannot be read; they come back at once, in a read of nothing.
    const unplaced = lines.filter((line) => line.entry.relative === undefined);
    if (unplaced.length > 0) reads.push({ start: 0, end: 0, lines: unplaced });
    return reads;
  }

  async function readBytes(start: number, length: number): Promise<Bytes> {
    return { start, data: await file.source.read(start, length) };
  }

  /** The bytes from `start`, `length` long, from `bytes` when it holds them. */
  async function bytesAt(bytes: Bytes, start: number, length: number): Promise<Bytes> {
    const offset = start - bytes.start;
    if (offset >= 0 && offset + length <= bytes.data.length) {
      return { start, data: bytes.data.subarray(offset, offset + length) };
    }
    if (offset >= 0 && offset < bytes.data.length) {
      const have = bytes.data.subarray(offset);
      const rest = await file.source.read(start + have.length, length - have.length);
      stats.rereads++;
      return { start, data: concatBytes(have, rest) };
    }
    return readBytes(start, length);
  }

  async function headOf(
    cluster: number,
    bytes: Bytes | undefined,
  ): Promise<ClusterHead | undefined> {
    const known = heads.get(cluster);
    if (known) return known;
    let head: ClusterHead | undefined;
    if (
      bytes &&
      cluster >= bytes.start &&
      cluster + MAX_CLUSTER_HEADER <= bytes.start + bytes.data.length
    ) {
      head = parseClusterHead(bytes.data, cluster - bytes.start, bytes.start);
    }
    if (!head && bytes === undefined) {
      stats.headReads++;
      const read = await readBytes(cluster, CLUSTER_HEAD_READ);
      head = parseClusterHead(read.data, 0, read.start);
    }
    if (head) remember(cluster, head);
    return head;
  }

  /**
   * The bytes from `start` to the end of `bytes` when at least `least` of
   * them are there, else read (as many as the guess).
   */
  async function bytesFrom(bytes: Bytes, start: number, least: number): Promise<Bytes> {
    const offset = start - bytes.start;
    if (offset >= 0 && bytes.data.length - offset >= least) {
      return { start, data: bytes.data.subarray(offset) };
    }
    return bytesAt(bytes, start, Math.max(least, guess));
  }

  /** The block at its exact place, read further when the bytes stop short. */
  async function exactBlock(bytes: Bytes, at: number): Promise<Block | undefined> {
    let view = await bytesFrom(bytes, at, MAX_CLUSTER_HEADER);
    let parsed = parseBlockAt(view.data, 0, view.start, trackNumber, false);
    if (parsed && 'needs' in parsed) {
      view = await bytesAt(view, at, parsed.needs);
      parsed = parseBlockAt(view.data, 0, view.start, trackNumber, false);
    }
    return isBlock(parsed) ? parsed : undefined;
  }

  /**
   * The block somewhere in the 8 places its Cluster's size allows. Among
   * those that parse whole, the first wins, as long as every other lies
   * inside it (a bare Block inside the BlockGroup found first); otherwise
   * the place is not certain.
   */
  async function guessedBlock(
    bytes: Bytes,
    cluster: number,
    relative: number,
  ): Promise<Block | 'unsure'> {
    const first = cluster + MIN_CLUSTER_HEADER + relative;
    let view = await bytesFrom(bytes, first, 2 * MAX_CLUSTER_HEADER - MIN_CLUSTER_HEADER);
    for (let attempt = 0; attempt < 2; attempt++) {
      const found: Block[] = [];
      let needs = 0;
      for (let k = 0; k <= MAX_CLUSTER_HEADER - MIN_CLUSTER_HEADER; k++) {
        const parsed = parseBlockAt(view.data, k, view.start, trackNumber, true);
        if (isBlock(parsed)) found.push(parsed);
        else if (parsed && found.length === 0) needs = Math.max(needs, k + parsed.needs);
      }
      if (found.length > 0) {
        const outer = found[0]!;
        const nested = found.every((block) => block.start >= outer.start && block.end <= outer.end);
        return nested ? outer : 'unsure';
      }
      if (needs <= view.data.length) break;
      view = await bytesAt(view, first, needs);
    }
    return 'unsure';
  }

  async function lineOf(line: LineRequest, bytes: Bytes): Promise<LineResult> {
    const { entry, index } = line;
    const relative = entry.relative!;
    let head = await headOf(entry.cluster, bytes);
    let block: Block | undefined;
    if (head) block = await exactBlock(bytes, head.dataStart + relative);
    else {
      const guessed = await guessedBlock(bytes, entry.cluster, relative);
      if (guessed !== 'unsure') block = guessed;
      else {
        stats.fallbacks++;
        head = await headOf(entry.cluster, undefined);
        if (head) block = await exactBlock(bytes, head.dataStart + relative);
      }
    }
    if (!block) return { index, problem: 'not-found' };
    if (block.laced) return { index, problem: 'laced' };
    guess = Math.min(MAX_GUESS, Math.max(guess, 2 * (block.end - block.start)));

    let time = entry.time;
    if (head?.timestamp !== undefined) {
      const own = head.timestamp + block.timecode;
      if (own !== entry.time) {
        stats.timeMismatches++;
        time = own;
      }
    }
    const fallbackEnd = Math.min(
      line.nextTime !== undefined && line.nextTime > time ? line.nextTime : Infinity,
      time + (NO_DURATION_TICKS_SECONDS * 1e9) / scale,
    );
    const duration = block.duration ?? entry.duration;
    const end = duration !== undefined && duration > 0 ? time + duration : fallbackEnd;

    let payload: Uint8Array;
    try {
      payload = await decodeContent(block.payload, trackData.encodings, 1, file.inflate);
    } catch {
      return { index, problem: 'undecodable' };
    }
    const cue = matroskaTextCue(
      format,
      ticksToSeconds(time, scale),
      ticksToSeconds(end, scale),
      payload,
      block.addition,
      trackData.script,
    );
    return cue ? { index, cue } : { index, problem: 'empty' };
  }

  async function run(read: PlannedRead): Promise<LineResult[]> {
    const results: LineResult[] = [];
    const placed = read.lines.filter((line) => line.entry.relative !== undefined);
    for (const line of read.lines) {
      if (line.entry.relative === undefined)
        results.push({ index: line.index, problem: 'no-position' });
    }
    if (placed.length > 0) {
      if (alwaysHeads) {
        for (const line of placed) await headOf(line.entry.cluster, undefined);
      }
      // Heads read above (or earlier) place each block exactly: the planned span may have guessed.
      let start = read.start;
      let end = read.end;
      for (const line of placed) {
        const span = spanOf(line);
        start = Math.min(start, span.start);
        end = Math.max(end, span.end);
      }
      const bytes = await readBytes(start, Math.min(end - start, maxRead + MAX_GUESS));
      for (const line of placed) results.push(await lineOf(line, bytes));
    }
    for (const result of results) {
      if (result.cue) stats.lines++;
      else if (result.problem)
        stats.problems[result.problem] = (stats.problems[result.problem] ?? 0) + 1;
    }
    return results;
  }

  return { plan, run, stats };
}
