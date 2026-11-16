import { type BaseStyle, fromLegacyAlignment, parseMarkup, PLAIN } from './markup';
import { toSeconds } from './time';
import type { Cue } from './types';

export interface AssStyle extends BaseStyle {
  /** Numpad position, 7-9 the top row. */
  alignment: number;
}

// Used when a section has no Format line. SSA's first column is Marked, not Layer.
const EVENT_FORMAT = 'layer,start,end,style,name,marginl,marginr,marginv,effect,text'.split(',');
const ASS_STYLE_FORMAT = (
  'name,fontname,fontsize,primarycolour,secondarycolour,outlinecolour,backcolour,bold,italic,' +
  'underline,strikeout,scalex,scaley,spacing,angle,borderstyle,outline,shadow,alignment,' +
  'marginl,marginr,marginv,encoding'
).split(',');
const SSA_STYLE_FORMAT = (
  'name,fontname,fontsize,primarycolour,secondarycolour,tertiarycolour,backcolour,bold,italic,' +
  'borderstyle,outline,shadow,alignment,marginl,marginr,marginv,alphalevel,encoding'
).split(',');

const TIME = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/;
const DEFAULT_STYLE: AssStyle = { ...PLAIN, alignment: 2 };

/** Splits on the first count - 1 commas only: the last column, Text, keeps its commas. */
export function splitColumns(value: string, count: number): string[] {
  const columns: string[] = [];
  let from = 0;
  while (columns.length < count - 1) {
    const comma = value.indexOf(',', from);
    if (comma === -1) break;
    columns.push(value.slice(from, comma));
    from = comma + 1;
  }
  columns.push(value.slice(from));
  return columns;
}

function readFormat(value: string): string[] {
  return value.split(',').map((column) => column.trim().toLowerCase());
}

function readTime(value: string | undefined): number | undefined {
  const match = TIME.exec((value ?? '').trim());
  return match ? toSeconds(match[1], match[2]!, match[3]!, match[4]) : undefined;
}

/** ASS writes true as -1; anything but zero counts. */
function readFlag(value: string | undefined): boolean {
  const number = Number((value ?? '').trim());
  return !isNaN(number) && number !== 0;
}

/** libass's "*Default" is the same style as "Default", and names match whatever their case. */
function styleKey(name: string | undefined): string {
  return (name ?? '').trim().replace(/^\*/, '').toLowerCase();
}

function readStyle(values: string[], format: string[], legacy: boolean): [string, AssStyle] {
  const column = (name: string) => values[format.indexOf(name)];
  const written = parseInt(column('alignment') ?? '', 10);
  const alignment = legacy
    ? fromLegacyAlignment(written)
    : written >= 1 && written <= 9
      ? written
      : undefined;
  return [
    styleKey(column('name')),
    {
      italic: readFlag(column('italic')),
      bold: readFlag(column('bold')),
      underline: readFlag(column('underline')),
      alignment: alignment ?? DEFAULT_STYLE.alignment,
    },
  ];
}

/** What an ASS or SSA script's header says about its events: styles and line wrapping. */
export interface AssScript {
  /** By name, as styleKey reads it. */
  styles: Map<string, AssStyle>;
  wrapStyle: number;
  /** The [Events] section's columns, lower case. */
  eventFormat: string[];
}

/**
 * Reads a script's sections line by line: [Script Info]'s WrapStyle, the
 * styles and the [Events] Format line. Each Dialogue line is handed to
 * `onDialogue` with the script as read up to it, so a style defined after a
 * line does not apply to it. A Matroska track keeps this header in its
 * CodecPrivate and each event in a block of its own.
 */
export function readAssScript(
  lines: readonly string[],
  onDialogue?: (columns: string[], script: AssScript) => void,
): AssScript {
  let section = '';
  let styleFormat = ASS_STYLE_FORMAT;
  const script: AssScript = { styles: new Map(), wrapStyle: 0, eventFormat: EVENT_FORMAT };

  const inStyles = () => section.indexOf('styles') !== -1;
  const legacyStyles = () => section.indexOf('+') === -1;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.charAt(0) === '[' && line.charAt(line.length - 1) === ']') {
      section = line.slice(1, -1).trim().toLowerCase();
      if (inStyles()) styleFormat = legacyStyles() ? SSA_STYLE_FORMAT : ASS_STYLE_FORMAT;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const kind = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1);

    if (kind === 'wrapstyle') {
      script.wrapStyle = parseInt(value, 10) || 0;
    } else if (kind === 'format') {
      const format = readFormat(value);
      if (inStyles()) styleFormat = format;
      else if (['start', 'end', 'text'].every((name) => format.indexOf(name) !== -1)) {
        script.eventFormat = format;
      }
    } else if (kind === 'style') {
      const [name, style] = readStyle(
        splitColumns(value, styleFormat.length),
        styleFormat,
        legacyStyles(),
      );
      script.styles.set(name, style);
    } else if (kind === 'dialogue' && onDialogue) {
      onDialogue(splitColumns(value, script.eventFormat.length), script);
    }
  }
  return script;
}

/**
 * One event's text as a cue, in its style: italic, bold and underline carry
 * over from the style, override tags change them, and a style or \an in the
 * top row puts the cue at the top. Undefined when the times are not in order
 * or nothing is left to draw (a vector drawing, an empty line).
 */
export function assEventCue(
  start: number,
  end: number,
  styleName: string | undefined,
  text: string,
  script: AssScript,
): Cue | undefined {
  if (!(end > start)) return undefined;
  const style =
    script.styles.get(styleKey(styleName)) ?? script.styles.get('default') ?? DEFAULT_STYLE;
  const markup = parseMarkup(text, { html: false, base: style, wrapStyle: script.wrapStyle });
  if (markup.lines.length === 0) return undefined;
  const cue: Cue = { start, end, lines: markup.lines };
  if ((markup.alignment ?? style.alignment) >= 7) cue.top = true;
  return cue;
}

/**
 * Reads the Dialogue lines of an ASS or SSA script. Columns are found by the
 * [Events] Format line, styles by [V4+ Styles] (or SSA's [V4 Styles]) so a
 * style that is italic or placed at the top carries over. Comment lines and
 * vector drawings are dropped; positions, fonts and effects are ignored.
 */
export function parseAss(lines: readonly string[]): Cue[] {
  const cues: Cue[] = [];
  readAssScript(lines, (columns, script) => {
    const column = (name: string) => columns[script.eventFormat.indexOf(name)];
    const start = readTime(column('start'));
    const end = readTime(column('end'));
    const text = column('text');
    if (start === undefined || end === undefined || text === undefined) return;
    const cue = assEventCue(start, end, column('style'), text, script);
    if (cue) cues.push(cue);
  });
  return cues;
}
