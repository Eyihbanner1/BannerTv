import { parseMarkup } from './markup';
import { toSeconds } from './time';
import type { Cue } from './types';

// Hours optional (WebVTT's mm:ss.ttt), 1-3 digits; comma or dot before a
// fraction of any length.
const STAMP = '(?:(\\d{1,3}):)?(\\d{1,2}):(\\d{1,2})(?:[,.](\\d+))?';
// Anything after the end time is WebVTT cue settings or SRT X1:… coordinates.
// It is read apart from the pattern: a lazy match followed by trailing spaces
// would be retried from every space of a long run.
const TIMING = new RegExp(`^\\s*${STAMP}\\s*-?->\\s*${STAMP}`);
const STARTS_WITH_SPACE = /^\s/;
const CUE_NUMBER = /^\s*\d+\s*$/;

/** WebVTT lines are about a twentieth of the picture tall: lines 0-4 are the top fifth, like line:20%. */
const TOP_LINES = 4;
const TOP_PERCENT = 20;

interface Block {
  start: number;
  end: number;
  settings: string;
  text: string[];
}

interface Timing {
  start: number;
  end: number;
  settings: string;
}

function readTiming(line: string): Timing | undefined {
  const match = TIMING.exec(line);
  if (!match) return undefined;
  // "00:00:02,000x" is not an end time: settings are set apart by whitespace.
  const rest = line.slice(match[0].length);
  if (rest !== '' && !STARTS_WITH_SPACE.test(rest)) return undefined;
  const start = toSeconds(match[1], match[2]!, match[3]!, match[4]);
  const end = toSeconds(match[5], match[6]!, match[7]!, match[8]);
  if (start === undefined || end === undefined) return undefined;
  return { start, end, settings: rest.trim() };
}

/**
 * WebVTT's line setting, read only as far as top or bottom: a non-negative
 * line number counts from the top and a negative one from the bottom; a
 * percentage is the distance from the top.
 */
function isTopLine(settings: string): boolean {
  const match = /(?:^|\s)line:(\S+)/.exec(settings);
  if (!match) return false;
  const value = match[1]!.split(',')[0]!;
  if (/^\d+(?:\.\d+)?%$/.test(value)) return parseFloat(value) <= TOP_PERCENT;
  if (/^-?\d+$/.test(value)) {
    const number = parseInt(value, 10);
    return number >= 0 && number <= TOP_LINES;
  }
  return false;
}

function toCue(block: Block): Cue | undefined {
  if (!(block.end > block.start)) return undefined;
  const markup = parseMarkup(block.text.join('\n'), { html: true });
  if (markup.lines.length === 0) return undefined;
  const cue: Cue = { start: block.start, end: block.end, lines: markup.lines };
  const top =
    isTopLine(block.settings) || (markup.alignment !== undefined && markup.alignment >= 7);
  if (top) cue.top = true;
  return cue;
}

/**
 * SRT and WebVTT share a shape: a timing line, then text up to a blank line.
 * A timing line always starts a new cue, so files that leave out the blank
 * line or the cue number still split correctly, and a cue whose timing line
 * is broken is skipped up to the next blank line.
 *
 * Between cues WebVTT has identifiers, NOTE, STYLE and REGION blocks, all of
 * which are skipped. SRT has only cue numbers there, so other text after a
 * blank line is a cue's text that a stray blank line cut in two, and it goes
 * back on the cue before it. Text after a cue number is not: it belongs to a
 * cue whose timing line is missing or mangled ("00:00:03,000 –> …"), and is
 * dropped with it.
 */
export function parseSrtOrVtt(lines: readonly string[], strayTextBelongsToCue: boolean): Cue[] {
  const blocks: Block[] = [];
  let state: 'between' | 'text' | 'skip' = 'between';
  let current: Block | undefined;
  // The cue that text after a blank line goes back on; none after a broken cue.
  let owner: Block | undefined;

  for (const line of lines) {
    if (line.indexOf('->') !== -1) {
      const timing = readTiming(line);
      if (timing || line.indexOf('-->') !== -1) {
        // With no blank line before it, the line above a timing line is the next cue's number.
        const above = current?.text[current.text.length - 1];
        if (state === 'text' && above !== undefined && CUE_NUMBER.test(above)) current!.text.pop();
        current = timing ? { ...timing, text: [] } : undefined;
        if (current) blocks.push(current);
        owner = undefined;
        state = current ? 'text' : 'skip';
        continue;
      }
    }

    if (line.trim() === '') {
      if (state === 'text') owner = current;
      state = 'between';
    } else if (state === 'text') {
      current!.text.push(line);
    } else if (state === 'between' && CUE_NUMBER.test(line)) {
      // A cue number opens the next cue, so what follows is never the last
      // cue's text, even when the timing line under it cannot be read.
      owner = undefined;
    } else if (state === 'between' && strayTextBelongsToCue && owner) {
      owner.text.push(line);
    }
  }

  const cues: Cue[] = [];
  for (const block of blocks) {
    const cue = toCue(block);
    if (cue) cues.push(cue);
  }
  return cues;
}
