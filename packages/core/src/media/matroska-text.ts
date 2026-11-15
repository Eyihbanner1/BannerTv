import { type AssScript, assEventCue, readAssScript, splitColumns } from '../subtitles/ass';
import { textCue } from '../subtitles/srt-vtt';
import type { Cue } from '../subtitles/types';
import { decodeUtf8 } from './ebml';

/**
 * How a Matroska text track writes each line in its block:
 * - srt: S_TEXT/UTF8, the line's text with SRT's inline tags;
 * - ass, ssa: S_TEXT/ASS and S_TEXT/SSA, the event's columns without its
 *   times ("ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text"),
 *   the script's header (styles, WrapStyle) in the track's CodecPrivate;
 * - vtt: S_TEXT/WEBVTT, the cue's text, its settings and identifier in a
 *   BlockAdditional (as mkvmerge writes it);
 * - webm-vtt: WebM's D_WEBVTT/SUBTITLES and CAPTIONS, the identifier, the
 *   settings and the text one after another (as ffmpeg writes it).
 */
export type MatroskaTextFormat = 'srt' | 'ass' | 'ssa' | 'vtt' | 'webm-vtt';

export const TEXT_CODECS: Readonly<Record<string, MatroskaTextFormat>> = {
  'S_TEXT/UTF8': 'srt',
  'S_TEXT/ASCII': 'srt',
  'S_TEXT/ASS': 'ass',
  S_ASS: 'ass',
  'S_TEXT/SSA': 'ssa',
  S_SSA: 'ssa',
  'S_TEXT/WEBVTT': 'vtt',
  'D_WEBVTT/SUBTITLES': 'webm-vtt',
  'D_WEBVTT/CAPTIONS': 'webm-vtt',
};

/** Subtitles drawn as pictures: recognised so a track list can name them, never decoded. */
export const PICTURE_CODECS: readonly string[] = [
  'S_HDMV/PGS',
  'S_VOBSUB',
  'S_DVBSUB',
  'S_IMAGE/BMP',
];

/** The nine columns of an ASS or SSA event in a Matroska block. */
const ASS_BLOCK_COLUMNS = 9;
const ASS_STYLE_COLUMN = 2;
const LINE_BREAK = /\r\n|\r|\n/;

/** A track's text, without the NUL bytes some muxers pad it with. */
export function blockText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return decodeUtf8(bytes.subarray(0, end));
}

/** The script header an ASS or SSA track keeps in its CodecPrivate. */
export function assScriptOf(codecPrivate: Uint8Array | undefined): AssScript {
  const text = codecPrivate ? blockText(codecPrivate).replace(/^\uFEFF/, '') : '';
  return readAssScript(text.split(LINE_BREAK));
}

/**
 * One block's line as a cue, `start` and `end` in seconds; undefined when
 * nothing is left to draw. `addition` is the block's BlockAdditional, which
 * only S_TEXT/WEBVTT uses.
 */
export function matroskaTextCue(
  format: MatroskaTextFormat,
  start: number,
  end: number,
  payload: Uint8Array,
  addition: Uint8Array | undefined,
  script: AssScript | undefined,
): Cue | undefined {
  const text = blockText(payload);
  switch (format) {
    case 'srt':
      return textCue(start, end, text);
    case 'ass':
    case 'ssa': {
      const columns = splitColumns(text, ASS_BLOCK_COLUMNS);
      const events = script ?? readAssScript([]);
      if (columns.length < ASS_BLOCK_COLUMNS)
        return assEventCue(start, end, undefined, text, events);
      return assEventCue(
        start,
        end,
        columns[ASS_STYLE_COLUMN],
        columns[ASS_BLOCK_COLUMNS - 1]!,
        events,
      );
    }
    case 'vtt': {
      // The settings are the first line of the addition, the identifier the second.
      const settings = addition ? (blockText(addition).split(LINE_BREAK)[0] ?? '') : '';
      return textCue(start, end, text, settings);
    }
    case 'webm-vtt': {
      const lines = text.split(LINE_BREAK);
      const settings = lines[1] ?? '';
      return textCue(start, end, lines.slice(2).join('\n'), settings);
    }
  }
}
