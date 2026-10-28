import { parseAss } from './ass';
import { sortByStart } from './cues';
import { parseMarkup } from './markup';
import { parseSrtOrVtt } from './srt-vtt';
import type { Cue, CueLine, SubtitleFormat } from './types';

// \s covers a byte-order mark too.
const VTT_HEADER = /^\s*WEBVTT/i;
const ASS_SECTION = /^[ \t]*\[(?:script info|events)\][ \t]*$/im;
const ASS_DIALOGUE = /^[ \t]*dialogue[ \t]*:/im;
const LINE_BREAK = /\r\n|\r|\n/;

/** Guesses the format from the text itself: WEBVTT header, [Script Info] / [Events], or SRT. */
export function detectSubtitleFormat(text: string): SubtitleFormat {
  if (VTT_HEADER.test(text)) return 'vtt';
  if (ASS_SECTION.test(text) && ASS_DIALOGUE.test(text)) return 'ass';
  return 'srt';
}

/**
 * The same words over overlapping or back-to-back cues (ASS layers drawing a
 * border under the text, or a line cut in two by the authoring tool) would be
 * drawn twice or flicker, so they become one cue. Needs cues sorted by start.
 */
function mergeRepeats(sorted: Cue[]): Cue[] {
  const merged: Cue[] = [];
  const latestByContent = new Map<string, Cue>();
  for (const cue of sorted) {
    const content = `${cue.top ? 'top' : 'bottom'}${JSON.stringify(cue.lines)}`;
    const earlier = latestByContent.get(content);
    if (earlier && cue.start <= earlier.end) {
      earlier.end = Math.max(earlier.end, cue.end);
      continue;
    }
    latestByContent.set(content, cue);
    merged.push(cue);
  }
  return merged;
}

/**
 * Parses a whole subtitle file into cues sorted by start time. Broken cues
 * are dropped, never the whole file. ASS and SSA keep their text and line
 * breaks only: styling beyond italic, bold and underline is ignored.
 */
export function parseSubtitleText(text: string, format?: SubtitleFormat): Cue[] {
  const lines = text.replace(/^\ufeff/, '').split(LINE_BREAK);
  const kind = format ?? detectSubtitleFormat(text);
  const cues = kind === 'ass' ? parseAss(lines) : parseSrtOrVtt(lines, kind === 'srt');
  return mergeRepeats(sortByStart(cues));
}

/**
 * Turns one cue's text, with SRT or WebVTT inline markup (<i>, <b>, <u>,
 * <font>, <c.class>, <v Name>, {\i1}, entities), into styled lines. Unknown
 * tags are dropped and their text kept. Used for cues hls.js hands over too.
 */
export function parseCueMarkup(text: string): CueLine[] {
  return parseMarkup(text, { html: true }).lines;
}
