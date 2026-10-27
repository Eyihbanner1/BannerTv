import type { CueLine, CueSpan } from './types';

/** The style a cue's text starts in. ASS styles can make a whole line italic or bold. */
export interface BaseStyle {
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

export const PLAIN: BaseStyle = { italic: false, bold: false, underline: false };

export interface MarkupOptions {
  /**
   * SRT and WebVTT: HTML-like tags and entities count, and only {\...}
   * blocks are ASS overrides. ASS itself has no tags or entities, every
   * {...} block is hidden (a comment when it has no backslash), \N is a
   * line break and \h a hard space.
   */
  html: boolean;
  base?: BaseStyle;
  /**
   * The ASS script's WrapStyle. ASS's \n is a line break only under
   * WrapStyle 2 (or a line's own \q2) and a space otherwise, as in libass
   * and VSFilter.
   */
  wrapStyle?: number;
}

export interface Markup {
  lines: CueLine[];
  /** Numpad position (1-9, 7-9 the top row) from the first \an or legacy \a override. */
  alignment?: number;
}

/** SSA's \a and [V4 Styles] count 1-3 bottom, 5-7 top, 9-11 middle. */
const LEGACY_ALIGNMENT: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  5: 7,
  6: 8,
  7: 9,
  9: 4,
  10: 5,
  11: 6,
};

export function fromLegacyAlignment(value: number): number | undefined {
  return LEGACY_ALIGNMENT[value];
}

// Sticky, so each is tried exactly where the '<' or '&' is. Whatever follows
// the tag name starts with something other than a letter or digit: if the
// name and the rest could both take letters, a long run of them with no '>'
// would be retried at every split, which takes seconds on a TV.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:[^a-zA-Z0-9<>\r\n][^<>\r\n]*)?>/y;
const TIMESTAMP_TAG = /<(?:\d+:)?\d{1,2}:\d{1,2}[.,]\d+>/y;
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/y;
const OVERRIDE = /^([a-z]+)(\d*)$/;
const INVISIBLE_ONLY = /^[\s\u200b-\u200f\u2060]*$/;
const SPACE = /\s/;

const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['lrm', '\u200e'],
  ['rlm', '\u200f'],
]);

function decodeEntity(match: RegExpExecArray): string | undefined {
  const [, decimal, hex, name] = match;
  if (name !== undefined) return NAMED_ENTITIES.get(name.toLowerCase());
  const code = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex!, 16);
  const isSurrogate = code >= 0xd800 && code <= 0xdfff;
  if (code === 0 || code > 0x10ffff || isSurrogate) return undefined;
  return String.fromCodePoint(code);
}

function sameStyle(a: CueSpan, b: CueSpan): boolean {
  return !a.italic === !b.italic && !a.bold === !b.bold && !a.underline === !b.underline;
}

/**
 * The text without its trailing whitespace. Counted back by hand: /\s+$/
 * starts again from every space of a run that is not at the end, so a long
 * run in the middle of a line takes quadratic time.
 */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && SPACE.test(text.charAt(end - 1))) end--;
  return text.slice(0, end);
}

/** Strips the line's outer whitespace; a line of nothing but spaces and direction marks is empty. */
function trimLine(spans: CueSpan[]): CueSpan[] {
  while (spans.length > 0) {
    const first = spans[0]!;
    first.text = first.text.replace(/^\s+/, '');
    if (first.text !== '') break;
    spans.shift();
  }
  while (spans.length > 0) {
    const last = spans[spans.length - 1]!;
    last.text = trimEnd(last.text);
    if (last.text !== '') break;
    spans.pop();
  }
  return spans.every((span) => INVISIBLE_ONLY.test(span.text)) ? [] : spans;
}

/**
 * One pass over the text. Styles are counters for HTML-like tags, so nested
 * and unclosed <i> work (an unclosed tag runs to the end of the cue), while
 * ASS overrides such as {\i1} and {\i0} set them outright.
 */
export function parseMarkup(text: string, options: MarkupOptions): Markup {
  const { html } = options;
  const base = options.base ?? PLAIN;
  let italic = base.italic ? 1 : 0;
  let bold = base.bold ? 1 : 0;
  let underline = base.underline ? 1 : 0;
  let hidden = 0; // inside <rt> or <rp>: ruby annotations are not drawn
  let drawing = false; // inside an ASS \p1 vector drawing, whose "text" is path commands
  let alignment: number | undefined;
  let wrapStyle = options.wrapStyle ?? 0;
  // Where the next '}' is: unknown until first needed, Infinity once there is none.
  let closingBrace = -1;

  const lines: CueLine[] = [];
  let line: CueSpan[] = [];
  let pending = '';

  function flush() {
    if (pending === '') return;
    const span: CueSpan = { text: pending };
    if (italic > 0) span.italic = true;
    if (bold > 0) span.bold = true;
    if (underline > 0) span.underline = true;
    pending = '';
    const last = line[line.length - 1];
    if (last && sameStyle(last, span)) last.text += span.text;
    else line.push(span);
  }

  function endLine() {
    flush();
    const finished = trimLine(line);
    if (finished.length > 0) lines.push(finished);
    line = [];
  }

  /**
   * One character of text, written or from an entity: &#10; breaks the line
   * like a written line break would, so no span ever holds one.
   */
  function put(char: string) {
    if (char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') {
      endLine();
      return;
    }
    const code = char.charCodeAt(0);
    if (char === '\t') pending += ' ';
    else if (code >= 0x20 && code !== 0x7f) pending += char;
  }

  function applyTag(closing: boolean, name: string) {
    const step = closing ? -1 : 1;
    switch (name) {
      case 'i':
        italic = Math.max(0, italic + step);
        break;
      case 'b':
        bold = Math.max(0, bold + step);
        break;
      case 'u':
        underline = Math.max(0, underline + step);
        break;
      case 'rt':
      case 'rp':
        hidden = Math.max(0, hidden + step);
        break;
      case 'ruby':
        if (closing) hidden = 0;
        break;
      case 'br':
        endLine();
        break;
      default:
      // <font>, <c.class>, <v Name>, <lang>, <span> and the rest: the text stays, the tag goes.
    }
  }

  function applyOverride(tag: string) {
    if (tag.charAt(0) === 'r') {
      // \r and \rStyleName go back to the line's own style.
      italic = base.italic ? 1 : 0;
      bold = base.bold ? 1 : 0;
      underline = base.underline ? 1 : 0;
      return;
    }
    const match = OVERRIDE.exec(tag);
    if (!match) return;
    const name = match[1]!;
    const value = match[2] === '' ? undefined : Number(match[2]);
    switch (name) {
      case 'i':
        italic =
          value === undefined ? (base.italic ? 1 : 0) : value === 0 ? 0 : Math.max(italic, 1);
        break;
      case 'u':
        underline =
          value === undefined ? (base.underline ? 1 : 0) : value === 0 ? 0 : Math.max(underline, 1);
        break;
      case 'b':
        // \b1 and \b0, or a font weight: \b700 is bold, \b400 is not.
        if (value === undefined) bold = base.bold ? 1 : 0;
        else bold = value === 1 || value >= 600 ? Math.max(bold, 1) : 0;
        break;
      case 'an':
        if (alignment === undefined && value !== undefined && value >= 1 && value <= 9) {
          alignment = value;
        }
        break;
      case 'a':
        if (alignment === undefined && value !== undefined) alignment = fromLegacyAlignment(value);
        break;
      case 'p':
        drawing = value !== undefined && value > 0;
        break;
      case 'q':
        wrapStyle = value ?? options.wrapStyle ?? 0;
        break;
      default:
      // Fonts, colours, positions, animations: the plain overlay cannot draw them.
    }
  }

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (char === '\n' || char === '\u2028' || char === '\u2029') {
      endLine();
      continue;
    }
    if (char === '\r') {
      if (text.charAt(i + 1) !== '\n') endLine();
      continue;
    }

    if (char === '<' && html) {
      TAG.lastIndex = i;
      const tag = TAG.exec(text);
      if (tag) {
        flush();
        applyTag(tag[1] === '/', tag[2]!.toLowerCase());
        i = TAG.lastIndex - 1;
        continue;
      }
      TIMESTAMP_TAG.lastIndex = i;
      if (TIMESTAMP_TAG.test(text)) {
        i = TIMESTAMP_TAG.lastIndex - 1;
        continue;
      }
    }

    if (char === '{' && (!html || text.charAt(i + 1) === '\\')) {
      if (closingBrace < i) {
        closingBrace = text.indexOf('}', i);
        if (closingBrace === -1) closingBrace = Infinity;
      }
      if (closingBrace !== Infinity) {
        flush();
        const tags = text.slice(i + 1, closingBrace).split('\\');
        // tags[0] is whatever came before the first backslash: an ASS comment.
        for (let t = 1; t < tags.length; t++) applyOverride(tags[t]!.trim());
        i = closingBrace;
        continue;
      }
    }

    if (char === '\\' && !html) {
      const next = text.charAt(i + 1);
      if (next === 'N' || (next === 'n' && wrapStyle === 2)) {
        endLine();
        i++;
        continue;
      }
      if (next === 'n') {
        if (hidden === 0 && !drawing) pending += ' ';
        i++;
        continue;
      }
      if (next === 'h') {
        if (hidden === 0 && !drawing) pending += '\u00a0';
        i++;
        continue;
      }
    }

    if (hidden > 0 || drawing) continue;

    if (char === '&' && html) {
      ENTITY.lastIndex = i;
      const entity = ENTITY.exec(text);
      const decoded = entity ? decodeEntity(entity) : undefined;
      if (decoded !== undefined) {
        put(decoded);
        i = ENTITY.lastIndex - 1;
        continue;
      }
    }

    put(char);
  }
  endLine();

  return alignment === undefined ? { lines } : { lines, alignment };
}
