import { ID } from '../ebml';
import {
  ascii,
  type Built,
  append,
  bytes,
  el,
  float64,
  join,
  joinAll,
  type Part,
  str,
  uint,
  uintBytes,
  UNKNOWN,
  utf8,
} from './helpers';

/**
 * Writes Matroska files the muxers will not make: header stripping on text,
 * Cues only in a second SeekHead, Cues pointing at the Block in a group (as
 * mkvmerge 5.9.0 to 6.3.0 wrote them), SimpleBlock subtitles, laced blocks,
 * clusters of every size width, and a film's length of video held as runs
 * of zeros so the reader's reads over two hours can be counted.
 */

export interface SyntheticTrack {
  number: number;
  codecId: string;
  kind?: 'subtitle' | 'video';
  language?: string;
  name?: string;
  forced?: boolean;
  /** FlagCommentary. */
  commentary?: boolean;
  codecPrivate?: Uint8Array;
  /** ContentCompAlgo 3: these bytes are taken off the front of every block of the track. */
  stripped?: Uint8Array;
  /**
   * ContentCompAlgo 0 (zlib) with this ContentEncodingScope: 1 the blocks,
   * each compressed with `deflate`; 2 the CodecPrivate, given compressed.
   */
  zlib?: { scope: number; deflate?: (bytes: Uint8Array) => Uint8Array };
  encrypted?: boolean;
}

export interface SyntheticLine {
  track: number;
  /** Milliseconds (the TimestampScale is 1 ms). */
  time: number;
  duration?: number;
  text: string;
}

export interface SyntheticOptions {
  /** Milliseconds of video. */
  length: number;
  tracks: SyntheticTrack[];
  lines: SyntheticLine[];
  /** A Cluster each this many milliseconds. */
  clusterLength?: number;
  /** Video frames a second, each a SimpleBlock of zeros. */
  frameRate?: number;
  /** The last bytes of video frame `index` (counted from 0), in place of zeros. */
  videoTail?: (index: number) => Uint8Array | undefined;
  /** Bytes of video a second. */
  videoRate?: number;
  /** How subtitle blocks are written. */
  blocks?: 'group' | 'simple' | 'group-without-duration';
  /** CueRelativePosition at the Block inside the BlockGroup. */
  cuesAtBlock?: boolean;
  noCueDuration?: boolean;
  noCueRelative?: boolean;
  /** Bytes each Cluster's size takes, cycling through the list (8 for unknown size too). */
  clusterSizeWidths?: number[];
  /** The first SeekHead lists Info, Tracks and a second SeekHead; only the second lists the Cues. */
  cuesInSecondSeekHead?: boolean;
  noCues?: boolean;
  segmentUnknownSize?: boolean;
  /** Lacing flags on every subtitle block. */
  laced?: boolean;
  /** Milliseconds added to each subtitle block's own timecode, against its CueTime. */
  blockTimeShift?: number;
  /** A SeekPosition for the Cues past 2^53. */
  hugeCuesPosition?: boolean;
  /** Track numbers the file does not have, given a position in every cue point too. */
  strayCueTracks?: number[];
  /** Tracks the Cues leave out, as `mkvmerge --cues N:none` does. */
  uncuedTracks?: number[];
  docType?: string;
}

const VIDEO_TRACK = 1;

function int16(value: number): Uint8Array {
  const raw = value < 0 ? value + 0x10000 : value;
  return bytes(raw >> 8, raw & 0xff);
}

function trackEntry(track: SyntheticTrack): Built {
  const fields: Built[] = [
    uint(ID.TRACK_NUMBER, track.number),
    uint(ID.TRACK_TYPE, track.kind === 'video' ? 1 : 0x11),
    el(ID.CODEC_ID, ascii(track.codecId)),
  ];
  if (track.kind === 'video') fields.push(uint(ID.DEFAULT_DURATION, 41708333));
  if (track.language) fields.push(el(ID.LANGUAGE, ascii(track.language)));
  if (track.name) fields.push(str(ID.NAME, track.name));
  if (track.forced) fields.push(uint(ID.FLAG_FORCED, 1));
  if (track.commentary) fields.push(uint(ID.FLAG_COMMENTARY, 1));
  if (track.codecPrivate) fields.push(el(ID.CODEC_PRIVATE, track.codecPrivate));
  if (track.stripped || track.encrypted || track.zlib) {
    const encoding: Built[] = [uint(ID.CONTENT_ENCODING_SCOPE, track.zlib?.scope ?? 1)];
    if (track.zlib) {
      encoding.push(el(ID.CONTENT_COMPRESSION, join(uint(ID.CONTENT_COMP_ALGO, 0))));
    } else if (track.encrypted) {
      encoding.push(uint(ID.CONTENT_ENCODING_TYPE, 1), el(ID.CONTENT_ENCRYPTION, []));
    } else {
      encoding.push(
        el(
          ID.CONTENT_COMPRESSION,
          join(uint(ID.CONTENT_COMP_ALGO, 3), el(ID.CONTENT_COMP_SETTINGS, track.stripped!)),
        ),
      );
    }
    fields.push(el(ID.CONTENT_ENCODINGS, join(el(ID.CONTENT_ENCODING, join(...encoding)))));
  }
  return el(ID.TRACK_ENTRY, join(...fields));
}

interface CuePlace {
  time: number;
  track: number;
  cluster: number;
  relative: number;
  duration?: number;
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, i) => data[i] === byte);
}

/** Builds the file as parts, with the cue points it indexes. */
export function synthesize(options: SyntheticOptions): { parts: Part[]; cues: CuePlace[] } {
  const clusterLength = options.clusterLength ?? 5000;
  const frameRate = options.frameRate ?? 1;
  const videoRate = options.videoRate ?? 625000;
  const frameBytes = Math.round(videoRate / frameRate);
  const widths = options.clusterSizeWidths ?? [];
  const trackOf = new Map(options.tracks.map((track) => [track.number, track]));
  const lines = options.lines
    .map((line, order) => ({ line, order }))
    .sort((a, b) => a.line.time - b.line.time || a.order - b.order)
    .map((entry) => entry.line);

  const header = el(
    ID.EBML,
    join(
      uint(0x4286, 1),
      uint(0x42f7, 1),
      uint(0x42f2, 4),
      uint(0x42f3, 8),
      el(ID.DOC_TYPE, ascii(options.docType ?? 'matroska')),
      uint(0x4287, 4),
      uint(ID.DOC_TYPE_READ_VERSION, 2),
    ),
  );
  const info = el(
    ID.INFO,
    join(
      uint(ID.TIMESTAMP_SCALE, 1000000),
      float64(ID.DURATION, options.length),
      str(ID.MUXING_APP, 'synthetic'),
      str(ID.WRITING_APP, 'synthetic'),
    ),
  );
  const video: SyntheticTrack = { number: VIDEO_TRACK, codecId: 'V_TEST', kind: 'video' };
  const tracks = el(ID.TRACKS, join(...[video, ...options.tracks].map(trackEntry)));

  // Clusters, with each block's place in its Cluster's data.
  const clusters: Array<{ built: Built; cues: Array<Omit<CuePlace, 'cluster'>>; video: number }> =
    [];
  let next = 0;
  let frames = 0;
  for (let start = 0, index = 0; start < options.length; start += clusterLength, index++) {
    const end = Math.min(options.length, start + clusterLength);
    const content: Part[] = [];
    let at = 0;
    const push = (built: Built) => {
      append(content, built.parts);
      at += built.length;
    };
    push(uint(ID.TIMESTAMP, start));
    const cues: Array<Omit<CuePlace, 'cluster'>> = [];
    const frameStep = 1000 / frameRate;
    let frame = Math.ceil(start / frameStep) * frameStep;
    const videoAt = at;
    while (frame < end || (next < lines.length && lines[next]!.time < end)) {
      const line = lines[next];
      if (line && line.time < end && (frame >= end || line.time < frame)) {
        next++;
        const track = trackOf.get(line.track)!;
        let payload = utf8(line.text);
        if (track.stripped) {
          if (!startsWith(payload, track.stripped))
            throw new Error('line does not start with the stripped bytes');
          payload = payload.subarray(track.stripped.length);
        }
        if (track.zlib && track.zlib.scope & 1) payload = track.zlib.deflate!(payload);
        const timecode = line.time - start + (options.blockTimeShift ?? 0);
        const flags = (options.blocks === 'simple' ? 0x80 : 0) | (options.laced ? 0x02 : 0);
        const body = [
          bytes(0x80 | line.track),
          int16(timecode),
          bytes(flags),
          ...(options.laced ? [bytes(0)] : []),
          payload,
        ];
        const cue: Omit<CuePlace, 'cluster'> = { time: line.time, track: line.track, relative: at };
        if (line.duration !== undefined && !options.noCueDuration) cue.duration = line.duration;
        if (options.blocks === 'simple') {
          push(el(ID.SIMPLE_BLOCK, body));
        } else {
          const block = el(ID.BLOCK, body);
          const parts: Built[] = [block];
          if (options.blocks !== 'group-without-duration' && line.duration !== undefined) {
            parts.push(uint(ID.BLOCK_DURATION, line.duration));
          }
          const group = el(ID.BLOCK_GROUP, join(...parts));
          // The group's ID and size come before the Block.
          if (options.cuesAtBlock)
            cue.relative = at + group.length - block.length - (parts[1]?.length ?? 0);
          push(group);
        }
        cues.push(cue);
      } else {
        const tail = options.videoTail?.(frames++);
        const data: Part[] = tail ? [frameBytes - tail.length, tail] : [frameBytes];
        push(
          el(
            ID.SIMPLE_BLOCK,
            [bytes(0x80 | VIDEO_TRACK), int16(frame - start), bytes(0x80), ...data],
            8,
          ),
        );
        frame += frameStep;
      }
    }
    const width = widths.length > 0 ? widths[index % widths.length] : undefined;
    clusters.push({
      built: el(ID.CLUSTER, content, width),
      cues: [{ time: start, track: VIDEO_TRACK, relative: videoAt }, ...cues],
      video: start,
    });
  }

  // Positions: the SeekHead's are 8 bytes wide, so its size does not depend on them.
  const seekEntry = (id: number, position: number) =>
    el(ID.SEEK, join(el(ID.SEEK_ID, uintBytes(id)), el(ID.SEEK_POSITION, uintBytes(position, 8))));
  const firstSeekIds = options.cuesInSecondSeekHead
    ? [ID.INFO, ID.TRACKS, ID.SEEK_HEAD]
    : options.noCues
      ? [ID.INFO, ID.TRACKS]
      : [ID.INFO, ID.TRACKS, ID.CUES];
  const seekHeadLength = el(
    ID.SEEK_HEAD,
    join(...firstSeekIds.map((id) => seekEntry(id, 0))),
  ).length;
  const infoAt = seekHeadLength;
  const tracksAt = infoAt + info.length;
  let clusterAt = tracksAt + tracks.length;
  const places: CuePlace[] = [];
  for (const cluster of clusters) {
    for (const cue of cluster.cues) {
      if ((options.uncuedTracks ?? []).indexOf(cue.track) < 0)
        places.push({ ...cue, cluster: clusterAt });
    }
    clusterAt += cluster.built.length;
  }
  const cuesAt = clusterAt;
  const cuePoints = places.map((place) => {
    const positions: Built[] = [
      uint(ID.CUE_TRACK, place.track),
      uint(ID.CUE_CLUSTER_POSITION, place.cluster),
    ];
    if (!options.noCueRelative) positions.push(uint(ID.CUE_RELATIVE_POSITION, place.relative));
    if (place.duration !== undefined) positions.push(uint(ID.CUE_DURATION, place.duration));
    const stray = (options.strayCueTracks ?? []).map((track) =>
      el(
        ID.CUE_TRACK_POSITIONS,
        join(uint(ID.CUE_TRACK, track), uint(ID.CUE_CLUSTER_POSITION, place.cluster)),
      ),
    );
    return el(
      ID.CUE_POINT,
      join(uint(ID.CUE_TIME, place.time), el(ID.CUE_TRACK_POSITIONS, join(...positions)), ...stray),
    );
  });
  const cuesElement = options.noCues ? undefined : el(ID.CUES, joinAll(cuePoints));
  const secondAt = cuesAt + (cuesElement?.length ?? 0);
  const position = (id: number) => {
    if (id === ID.INFO) return infoAt;
    if (id === ID.TRACKS) return tracksAt;
    if (id === ID.SEEK_HEAD) return secondAt;
    return options.hugeCuesPosition ? Math.pow(2, 60) : cuesAt;
  };
  const seekHead = el(ID.SEEK_HEAD, join(...firstSeekIds.map((id) => seekEntry(id, position(id)))));
  const content: Part[] = [...seekHead.parts, ...info.parts, ...tracks.parts];
  for (const cluster of clusters) append(content, cluster.built.parts);
  if (cuesElement) append(content, cuesElement.parts);
  if (options.cuesInSecondSeekHead) {
    append(content, el(ID.SEEK_HEAD, join(seekEntry(ID.CUES, cuesAt))).parts);
  }
  const segment = el(ID.SEGMENT, content, options.segmentUnknownSize ? UNKNOWN : 8);
  return { parts: [...header.parts, ...segment.parts], cues: places };
}
