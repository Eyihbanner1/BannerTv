import { describe, expect, it } from 'vitest';
import { createCueIndex } from './cues';
import { detectEncoding } from './encoding';
import { languageKey, languageName } from './languages';
import { parseCueMarkup, parseSubtitleText } from './parse';
import type { Cue, CueLine } from './types';

// Core is typed without the DOM, but the tests run in Node, which has it.
declare const TextDecoder: new (label: string) => unknown;

/** A cue's words as the viewer reads them, one string per line. */
function words(cue: Cue): string {
  return text(cue.lines);
}

function text(lines: CueLine[]): string {
  return lines.map((line) => line.map((span) => span.text).join('')).join('\n');
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = Date.now();
  const value = run();
  return { value, ms: Date.now() - started };
}

/** A small seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function assScript(scriptInfo: string[], ...events: string[]): string {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    ...scriptInfo,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
  ].join('\n');
}

// A file the TV cannot read in time freezes the player, and a broken or
// hostile file can hold one very long line. These took over a second each on
// a laptop for 40,000 characters, and grew with the square of the length.
describe('long lines stay fast', () => {
  const LONG = 50000;

  it('reads a run of letters after "<" that never closes as text, in one pass', () => {
    const { value, ms } = timed(() => parseCueMarkup(`<${'a'.repeat(LONG)}`));
    expect(ms).toBeLessThan(250);
    expect(text(value)).toHaveLength(LONG + 1);
  });

  it('keeps a long run of spaces inside a line, in one pass', () => {
    const { value, ms } = timed(() => parseCueMarkup(`a${' '.repeat(LONG)}b`));
    expect(ms).toBeLessThan(250);
    expect(text(value)).toHaveLength(LONG + 2);
  });

  it('reads a timing line whose settings hold a long run of spaces, in one pass', () => {
    const srt = `1\n00:00:01,000 --> 00:00:02,000 a${' '.repeat(LONG)}b\nHi\n`;
    const { value, ms } = timed(() => parseSubtitleText(srt));
    expect(ms).toBeLessThan(250);
    expect(value.map(words)).toEqual(['Hi']);
  });

  it('copes with thousands of override blocks and stray braces on one ASS line', () => {
    const line = `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{${'\\i1'.repeat(20000)}}Hi ${'{'.repeat(20000)}`;
    const { value, ms } = timed(() => parseSubtitleText(assScript([], line)));
    expect(ms).toBeLessThan(500);
    expect(value).toHaveLength(1);
  });
});

describe('SRT timing lines', () => {
  it('keeps settings apart from the end time only when whitespace separates them', () => {
    const srt = [
      '1',
      '00:00:01,000\t-->\t00:00:02,000\t ',
      'Tabs and trailing spaces',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000x',
      'Glued to the end time',
      '',
      '3',
      '00:00:05,000 --> 00:00:06,000   line:0  ',
      'Top',
    ].join('\n');
    const cues = parseSubtitleText(srt);
    expect(cues.map(words)).toEqual(['Tabs and trailing spaces', 'Top']);
    expect(cues[1]!.top).toBe(true);
  });

  it('reads a time written with hundreds of fraction digits', () => {
    const cues = parseSubtitleText(`1\n00:00:01,5${'0'.repeat(400)} --> 00:00:02,000\nA\n`);
    expect(cues.map((cue) => [cue.start, cue.end])).toEqual([[1.5, 2]]);
  });

  it('drops a numbered cue whose arrow is mangled, rather than adding it to the cue before', () => {
    // Machine-translated files turn "-->" into a dash or an arrow sign.
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'Hello',
      '',
      '2',
      '00:00:03,000 –> 00:00:04,000',
      'Lost',
      '',
      '3',
      '00:00:05,000 → 00:00:06,000',
      'Lost too',
      '',
      '4',
      '00:00:07,000 --> 00:00:08,000',
      'World',
    ].join('\r\n');
    expect(parseSubtitleText(srt).map(words)).toEqual(['Hello', 'World']);
  });

  it('still adds unnumbered text after a stray blank line to the cue before', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nFirst half\n\nsecond half\n';
    expect(parseSubtitleText(srt).map(words)).toEqual(['First half\nsecond half']);
  });
});

describe('WebVTT header lines', () => {
  it('skips header metadata and the HLS timestamp map', () => {
    const vtt = [
      'WEBVTT',
      'Kind: captions',
      'Language: en',
      'X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000',
      '',
      '00:00:01.000 --> 00:00:02.000 align:start position:0% line:0',
      'Hi',
    ].join('\n');
    expect(parseSubtitleText(vtt)).toEqual([
      { start: 1, end: 2, lines: [[{ text: 'Hi' }]], top: true },
    ]);
  });
});

describe('entities in cue text', () => {
  it('break the line at an encoded line break instead of hiding one inside a span', () => {
    expect(parseCueMarkup('One&#10;Two&#13;&#10;Three&#x2028;Four')).toEqual([
      [{ text: 'One' }],
      [{ text: 'Two' }],
      [{ text: 'Three' }],
      [{ text: 'Four' }],
    ]);
  });

  it('turn an encoded tab into a space and drop encoded control characters', () => {
    expect(parseCueMarkup('a&#9;b&#7;c&#x1b;d&#127;e')).toEqual([[{ text: 'a bcde' }]]);
  });

  it('keep the style across an encoded line break', () => {
    expect(parseCueMarkup('<i>One&#10;Two</i>')).toEqual([
      [{ text: 'One', italic: true }],
      [{ text: 'Two', italic: true }],
    ]);
  });
});

// libass and VSFilter both draw \n as a space unless the script, or the line
// with \q2, turns automatic wrapping off; \N always breaks.
describe('ASS soft line breaks', () => {
  const line = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Soft\\nbreak';

  it('are a space under the usual wrap styles', () => {
    for (const wrap of [[], ['WrapStyle: 0'], ['WrapStyle: 1'], ['WrapStyle: 3']]) {
      expect(parseSubtitleText(assScript(wrap, line)).map(words)).toEqual(['Soft break']);
    }
  });

  it('are a line break under WrapStyle 2', () => {
    expect(parseSubtitleText(assScript(['WrapStyle: 2'], line)).map(words)).toEqual([
      'Soft\nbreak',
    ]);
  });

  it('follow a \\q override on the line, and \\q alone goes back to the script', () => {
    const cues = parseSubtitleText(
      assScript(
        [],
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\q2}a\\nb{\\q}c\\nd',
        'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\q0}e\\nf',
      ),
    );
    expect(cues.map(words)).toEqual(['a\nbc d', 'e f']);
  });

  it('draw nothing inside a vector drawing', () => {
    const cues = parseSubtitleText(
      assScript(
        [],
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0\\nl 1 1{\\p0}Hi',
      ),
    );
    expect(cues.map(words)).toEqual(['Hi']);
  });

  it('ignore a [Fonts] section after the events', () => {
    const cues = parseSubtitleText(
      assScript(
        [],
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi',
        '',
        '[Fonts]',
        'fontname: a.ttf',
        "M'X:a",
      ),
    );
    expect(cues.map(words)).toEqual(['Hi']);
  });
});

describe('random input', () => {
  const PIECES = [
    '<i>',
    '</i>',
    '<b>',
    '</b>',
    '<u>',
    '<c.x>',
    '<v Bob>',
    '<ruby>',
    '<rt>',
    '</rt>',
    '</ruby>',
    '<br>',
    '<00:00:01.000>',
    '{\\i1}',
    '{\\i0}',
    '{\\an8}',
    '{\\p1}',
    '{\\p0}',
    '{\\q2}',
    '{note}',
    '\\N',
    '\\n',
    '\\h',
    '&amp;',
    '&#10;',
    '&#13;',
    '&#9;',
    '&#0;',
    '&#x2028;',
    '&nbsp;',
    '&lrm;',
    '\n',
    '\r',
    '\r\n',
    '\u2028',
    ' ',
    '\t',
    '\u0007',
    '\u200b',
    'a',
    'Hello',
    '<',
    '>',
    '{',
    '}',
    '&',
    '1',
    '-->',
    'line:0',
    'WEBVTT',
    '[Events]',
    '00:00:01,000 --> 00:00:02,000',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,x',
  ];
  /** Line breaks, tabs and other control characters, none of which a span may hold. */
  function hasBreakOrControl(spanText: string): boolean {
    for (let i = 0; i < spanText.length; i++) {
      const code = spanText.charCodeAt(i);
      if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
    }
    return false;
  }

  function expectDrawable(lines: CueLine[]) {
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      for (const span of line) {
        expect(span.text).not.toBe('');
        expect(hasBreakOrControl(span.text)).toBe(false);
      }
      expect(line[0]!.text).not.toMatch(/^\s/);
      expect(line[line.length - 1]!.text).not.toMatch(/\s$/);
    }
  }

  function piece(next: () => number): string {
    return PIECES[Math.floor(next() * PIECES.length)]!;
  }

  it('always gives trimmed lines of non-empty spans with no breaks or control characters', () => {
    const next = random(7);
    for (let n = 0; n < 5000; n++) {
      let cue = '';
      const count = Math.floor(next() * 12);
      for (let p = 0; p < count; p++) cue += piece(next);
      expectDrawable(parseCueMarkup(cue));
    }
  });

  it('always gives sorted cues that end after they start, in every format', () => {
    const next = random(11);
    for (let n = 0; n < 1500; n++) {
      let file = '';
      const count = Math.floor(next() * 40);
      for (let p = 0; p < count; p++) file += piece(next) + (next() < 0.4 ? '\n' : '');
      let previous = -Infinity;
      for (const cue of parseSubtitleText(file)) {
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.start).toBeGreaterThanOrEqual(previous);
        expect(cue.lines.length).toBeGreaterThan(0);
        expectDrawable(cue.lines);
        previous = cue.start;
      }
    }
  });
});

describe('createCueIndex at the edges', () => {
  const cue = (start: number, end: number): Cue => ({
    start,
    end,
    lines: [[{ text: `${start}` }]],
  });

  it('shows nothing for a clock that reads NaN, then recovers', () => {
    const index = createCueIndex([cue(0, 1)]);
    expect(index.at(NaN)).toEqual([]);
    expect(index.at(0.5)).toHaveLength(1);
  });

  it('keeps a cue that never ends', () => {
    const index = createCueIndex([cue(0, Infinity), cue(1, 2)]);
    expect(index.at(1.5)).toHaveLength(2);
    expect(index.at(1e9)).toHaveLength(1);
  });

  it('does not depend on the list it was given changing later', () => {
    const list = [cue(2, 3), cue(0, 1)];
    const index = createCueIndex(list);
    list.length = 0;
    expect(index.at(0.5)).toHaveLength(1);
  });
});

describe('encodings and languages as addons send them', () => {
  it('spots UTF-16 without a byte-order mark for text that is not Latin', () => {
    const file = '1\r\n00:00:01,000 --> 00:00:02,000\r\nПривет мир\r\n';
    const bytes: number[] = [];
    for (let i = 0; i < file.length; i++) {
      const code = file.charCodeAt(i);
      bytes.push(code & 0xff, code >> 8);
    }
    expect(detectEncoding(new Uint8Array(bytes), 'ru')).toBe('utf-16le');
  });

  it('only returns labels TextDecoder accepts', () => {
    const latin1 = new Uint8Array([0x48, 0x69, 0x20, 0xe9]);
    const languages = ['rus', 'gre', 'tur', 'heb', 'ara', 'tha', 'vie', 'chi', 'zht', 'jpn', 'kor'];
    for (const language of [...languages, 'scc', 'sr-Cyrl', 'est', undefined]) {
      const label = detectEncoding(latin1, language);
      expect(() => new TextDecoder(label)).not.toThrow();
    }
  });

  it('reads region and script tags in any case and with underscores', () => {
    expect(
      ['en_US', ' ENG ', 'pt-PT', 'pt_BR', 'por-br', 'es-ES', 'es-MX', 'spa-419', 'zh-Hant-TW'].map(
        languageKey,
      ),
    ).toEqual(['en', 'en', 'pt', 'pt-br', 'pt-br', 'es', 'es-419', 'es-419', 'zh-hant']);
    expect(['zh-CN', 'chi-tw', 'sr-Latn', 'nb-NO', 'iw', 'in', 'fil'].map(languageKey)).toEqual([
      'zh-hans',
      'zh-hant',
      'sr',
      'no',
      'he',
      'id',
      'tl',
    ]);
    expect(['pt-BR', 'es-MX', 'Español', 'xx-YY'].map(languageName)).toEqual([
      'Portuguese (Brazil)',
      'Spanish (Latin America)',
      'Spanish',
      'xx-YY',
    ]);
  });
});
