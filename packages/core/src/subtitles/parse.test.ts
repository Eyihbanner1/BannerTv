import { describe, expect, it } from 'vitest';
import { detectSubtitleFormat, parseCueMarkup, parseSubtitleText } from './parse';
import type { Cue } from './types';

/** A cue's words as the viewer reads them, one string per line. */
function words(cue: Cue): string {
  return cue.lines.map((line) => line.map((span) => span.text).join('')).join('\n');
}

function times(cues: Cue[]): Array<[number, number]> {
  return cues.map((cue) => [cue.start, cue.end]);
}

describe('detectSubtitleFormat', () => {
  it('knows WebVTT by its header, even after a byte-order mark and blank lines', () => {
    expect(detectSubtitleFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toBe('vtt');
    expect(detectSubtitleFormat('\ufeff\n  WEBVTT - Title\n')).toBe('vtt');
  });

  it('knows ASS and SSA by a section header together with Dialogue lines', () => {
    const ass =
      '[Script Info]\nTitle: x\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,,,0,0,0,,Hi';
    expect(detectSubtitleFormat(ass)).toBe('ass');
    expect(detectSubtitleFormat('[events]\r\ndialogue: 0,0:00:01.00,0:00:02.00,,,0,0,0,,Hi')).toBe(
      'ass',
    );
  });

  it('falls back to SRT, including for text that only mentions a section', () => {
    expect(detectSubtitleFormat('1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
    expect(detectSubtitleFormat('1\n00:00:01,000 --> 00:00:02,000\n[Events]')).toBe('srt');
    expect(detectSubtitleFormat('')).toBe('srt');
  });
});

describe('parseSubtitleText: SRT', () => {
  it('reads a typical file with italics, bold, a font tag, an entity and a top cue', () => {
    const srt = [
      '\ufeff1',
      '00:00:01,000 --> 00:00:03,500',
      'Where are you going?',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,000',
      '<i>To the lighthouse.</i>',
      "<i>Don't wait up.</i>",
      '',
      '3',
      '00:00:06,500 --> 00:00:08,000',
      '{\\an8}[DOOR SLAMS]',
      '',
      '4',
      '00:00:09,000 --> 00:00:11,250',
      '- Did you <b>hear</b> that?',
      '- <font color="#ffff00">Yes</font> &amp; no.',
      '',
    ].join('\r\n');

    expect(parseSubtitleText(srt)).toEqual([
      { start: 1, end: 3.5, lines: [[{ text: 'Where are you going?' }]] },
      {
        start: 4,
        end: 6,
        lines: [
          [{ text: 'To the lighthouse.', italic: true }],
          [{ text: "Don't wait up.", italic: true }],
        ],
      },
      { start: 6.5, end: 8, lines: [[{ text: '[DOOR SLAMS]' }]], top: true },
      {
        start: 9,
        end: 11.25,
        lines: [
          [{ text: '- Did you ' }, { text: 'hear', bold: true }, { text: ' that?' }],
          [{ text: '- Yes & no.' }],
        ],
      },
    ]);
  });

  it('accepts lone CR line endings', () => {
    const cues = parseSubtitleText('1\r00:00:01,000 --> 00:00:02,000\rOne\rTwo\r\r');
    expect(cues.map(words)).toEqual(['One\nTwo']);
  });

  it('splits cues without numbers or blank lines, dropping the next cue number from the text', () => {
    const srt = [
      '00:00:01,000 --> 00:00:02,000',
      'One',
      '00:00:03,000 --> 00:00:04,000',
      'Two',
      '3',
      '00:00:05,000 --> 00:00:06,000',
      'Three',
    ].join('\n');
    expect(parseSubtitleText(srt).map(words)).toEqual(['One', 'Two', 'Three']);
  });

  it('ignores extra blank lines and whitespace around the cue number', () => {
    const srt =
      '\n\n\n 1 \n00:00:01,000 --> 00:00:02,000\nOne\n\n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n\n\n';
    expect(parseSubtitleText(srt).map(words)).toEqual(['One', 'Two']);
  });

  it('reads comma or dot fractions of any length, 1 to 3 digit hours, and no hours', () => {
    const srt = [
      '00:00:01.5 --> 00:00:02,25',
      'a',
      '',
      '0:00:03,007 --> 0:00:04,1',
      'b',
      '',
      '100:00:00,000 --> 100:00:01,000',
      'c',
      '',
      '00:05,000 --> 00:06,000',
      'd',
      '',
      '00:00:07 --> 00:00:08',
      'e',
    ].join('\n');
    expect(times(parseSubtitleText(srt))).toEqual([
      [1.5, 2.25],
      [3.007, 4.1],
      [5, 6],
      [7, 8],
      [360000, 360001],
    ]);
  });

  it('ignores coordinates and other text after the end time', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000  X1:100 X2:500 Y1:20 Y2:80\nPlaced';
    expect(parseSubtitleText(srt)).toEqual([{ start: 1, end: 2, lines: [[{ text: 'Placed' }]] }]);
  });

  it('drops cues that end before they start, have no text, or have broken times, and keeps the rest', () => {
    const srt = [
      '1',
      '00:00:05,000 --> 00:00:05,000',
      'Zero length',
      '',
      '2',
      '00:00:06,000 --> 00:00:04,000',
      'Backwards',
      '',
      '3',
      '00:00:07,000 --> 00:00:08,000',
      '',
      '4',
      '-00:00:01,000 --> 00:00:02,000',
      'Negative',
      '',
      '5',
      '00:00:aa,000 --> 00:00:10,000',
      'Letters',
      '',
      '6',
      '00:61:00,000 --> 00:62:00,000',
      'No such minute',
      '',
      '7',
      '00:00:09,000 --> 00:00:10,000',
      '<i></i>&nbsp;',
      '',
      '8',
      '00:00:11,000 --> 00:00:12,000',
      'Good',
    ].join('\n');
    expect(parseSubtitleText(srt)).toEqual([{ start: 11, end: 12, lines: [[{ text: 'Good' }]] }]);
  });

  it('keeps text that a stray blank line split off its cue, but never after a broken cue', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'First half',
      '',
      'second half',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      'Two',
      '',
      '3',
      '00:00:xx,000 --> 00:00:06,000',
      'Broken',
      '',
      'still broken',
      '',
      '4',
      '00:00:07,000 --> 00:00:08,000',
      'Four',
    ].join('\n');
    expect(parseSubtitleText(srt).map(words)).toEqual(['First half\nsecond half', 'Two', 'Four']);
  });

  it('ignores lines before the first cue', () => {
    const srt = 'Subtitles by someone\n\n1\n00:00:01,000 --> 00:00:02,000\nOne';
    expect(parseSubtitleText(srt).map(words)).toEqual(['One']);
  });

  it('sorts cues by start and keeps the file order of cues that start together', () => {
    const srt = [
      '00:00:05,000 --> 00:00:06,000',
      'Late',
      '',
      '00:00:01,000 --> 00:00:02,000',
      'Early A',
      '',
      '00:00:01,000 --> 00:00:03,000',
      'Early B',
      '',
      '00:00:01,000 --> 00:00:01,500',
      'Early C',
    ].join('\n');
    expect(parseSubtitleText(srt).map(words)).toEqual(['Early A', 'Early B', 'Early C', 'Late']);
  });

  it('merges repeats of the same words that overlap or touch', () => {
    const srt = [
      '00:00:01,000 --> 00:00:02,000',
      'Hello',
      '',
      '00:00:01,000 --> 00:00:02,000',
      'Hello',
      '',
      '00:00:02,000 --> 00:00:03,000',
      'Hello',
      '',
      '00:00:04,000 --> 00:00:05,000',
      'Hello',
    ].join('\n');
    expect(times(parseSubtitleText(srt))).toEqual([
      [1, 3],
      [4, 5],
    ]);
  });

  it('parses ten thousand cues quickly', () => {
    const parts: string[] = [];
    for (let i = 0; i < 10000; i++) {
      const start = i * 2;
      const stamp = (seconds: number) =>
        `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(
          Math.floor(seconds / 60) % 60,
        ).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
      parts.push(`${i + 1}\n${stamp(start)} --> ${stamp(start + 1)}\nLine <i>number</i> ${i}\n`);
    }
    const began = Date.now();
    const cues = parseSubtitleText(parts.join('\n'));
    const took = Date.now() - began;
    expect(cues).toHaveLength(10000);
    expect(cues[9999]).toEqual({
      start: 19998,
      end: 19999,
      lines: [[{ text: 'Line ' }, { text: 'number', italic: true }, { text: ' 9999' }]],
    });
    expect(took).toBeLessThan(1000);
  });

  it('follows the format it is given over the guess', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi';
    expect(parseSubtitleText(text, 'srt').map(words)).toEqual(['Hi']);
    expect(parseSubtitleText(text, 'ass')).toEqual([]);
  });

  it('returns no cues for empty or unrelated text', () => {
    expect(parseSubtitleText('')).toEqual([]);
    expect(parseSubtitleText('<html><body>Not found</body></html>')).toEqual([]);
  });
});

describe('parseSubtitleText: WebVTT', () => {
  const vtt = [
    'WEBVTT - Chapter 1',
    'Kind: captions',
    'Language: en',
    '',
    'NOTE This file was made by hand.',
    'It has notes, styles and regions.',
    '',
    'STYLE',
    '::cue(.yellow) { color: yellow; }',
    '::cue(v[voice="Mara"]) { font-style: italic }',
    '',
    'REGION',
    'id:fred',
    'width:40%',
    '',
    'intro',
    '00:01.000 --> 00:04.000 line:0 align:start position:10%',
    "<v Mara>Who's there?</v>",
    '',
    '00:00:05.000 --> 00:00:07.000 line:85% align:middle',
    "<c.yellow.bg_black>It's me,</c> <v.loud Tom>Tom!</v>",
    '',
    'NOTE',
    'A note between cues',
    '',
    '2',
    '00:00:08.000 --> 00:00:10.000 position:50% line:10%,start',
    '<i>Thinking...</i>',
    '<ruby>漢<rt>kan</rt>字<rt>ji</rt></ruby>',
    '',
    '00:00:11.000 --> 00:00:13.000 line:-1',
    'Karaoke <00:00:11.500><b>time</b><00:00:12.000> tags',
    '',
    '00:00:14.000 --> 00:00:15.000 line:2',
    '<lang en>Second line from the top</lang>',
    '',
  ].join('\n');

  it('skips the header, NOTE, STYLE and REGION blocks and cue identifiers', () => {
    expect(parseSubtitleText(vtt)).toEqual([
      { start: 1, end: 4, lines: [[{ text: "Who's there?" }]], top: true },
      { start: 5, end: 7, lines: [[{ text: "It's me, Tom!" }]] },
      {
        start: 8,
        end: 10,
        lines: [[{ text: 'Thinking...', italic: true }], [{ text: '漢字' }]],
        top: true,
      },
      {
        start: 11,
        end: 13,
        lines: [[{ text: 'Karaoke ' }, { text: 'time', bold: true }, { text: ' tags' }]],
      },
      { start: 14, end: 15, lines: [[{ text: 'Second line from the top' }]], top: true },
    ]);
  });

  it('puts a cue at the top when its line setting is in the top fifth of the picture', () => {
    const settings = [
      'line:0',
      'line:0%',
      'line:20%',
      'line:4',
      'line:0,end',
      'line:12.5%,center',
      'line:21%',
      'line:5',
      'line:-1',
      'line:-17',
      'line:auto',
      'line:50%',
      'align:start position:0%',
    ];
    const text = ['WEBVTT', ''];
    settings.forEach((setting, i) => {
      text.push(
        `00:00:${String(i).padStart(2, '0')}.000 --> 00:00:${String(i).padStart(2, '0')}.500 ${setting}`,
        setting,
        '',
      );
    });
    const placed = parseSubtitleText(text.join('\n')).map((cue) => [words(cue), cue.top === true]);
    expect(placed).toEqual([
      ['line:0', true],
      ['line:0%', true],
      ['line:20%', true],
      ['line:4', true],
      ['line:0,end', true],
      ['line:12.5%,center', true],
      ['line:21%', false],
      ['line:5', false],
      ['line:-1', false],
      ['line:-17', false],
      ['line:auto', false],
      ['line:50%', false],
      ['align:start position:0%', false],
    ]);
  });

  it('drops a cue whose timing line is broken, with its text, and reads on', () => {
    const text = [
      'WEBVTT',
      '',
      '00:01.000 --> later',
      'Lost',
      '',
      '00:02.000 --> 00:03.000',
      'Kept',
    ].join('\n');
    expect(parseSubtitleText(text).map(words)).toEqual(['Kept']);
  });

  it('starts a cue straight after the header when the blank line is missing', () => {
    const text = 'WEBVTT\n00:01.000 --> 00:02.000\nHi\n00:03.000 --> 00:04.000\nThere';
    expect(parseSubtitleText(text).map(words)).toEqual(['Hi', 'There']);
  });

  it('never treats text after a blank line as part of the cue before it', () => {
    const text = 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n\nid-without-timing\n\n';
    expect(parseSubtitleText(text).map(words)).toEqual(['Hi']);
  });
});

function assScript(...events: string[]): string {
  return [
    '[Script Info]',
    '; Script generated by Aegisub',
    'Title: Sample',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
    'Style: Thoughts,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
    'Style: Sign,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,8,10,10,10,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\r\n');
}

describe('parseSubtitleText: ASS and SSA', () => {
  it('reads Dialogue lines by the Format columns, keeping commas in the text', () => {
    const cues = parseSubtitleText(
      assScript(
        'Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,This is a comment line',
        "Dialogue: 0,0:00:01.00,0:00:03.50,Default,Mara,0,0,0,,Well, well, well.\\NWho's this?",
        'Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,{\\i1}Italic{\\i0}, then {\\b1}bold{\\b0}, {\\u1}under{\\u0}.',
      ),
    );
    expect(cues).toEqual([
      { start: 1, end: 3.5, lines: [[{ text: 'Well, well, well.' }], [{ text: "Who's this?" }]] },
      {
        start: 4,
        end: 6,
        lines: [
          [
            { text: 'Italic', italic: true },
            { text: ', then ' },
            { text: 'bold', bold: true },
            { text: ', ' },
            { text: 'under', underline: true },
            { text: '.' },
          ],
        ],
      },
    ]);
  });

  it('carries italic, bold and top placement over from the style', () => {
    const cues = parseSubtitleText(
      assScript(
        "Dialogue: 0,0:00:06.50,0:00:08.00,Thoughts,,0,0,0,,I hope she didn't notice.",
        "Dialogue: 0,0:00:09.00,0:00:10.00,Sign,,0,0,0,,{\\fad(200,200)}MARA'S BAKERY",
        'Dialogue: 0,0:00:10.00,0:00:11.00,*sign,,0,0,0,,{\\r}Still the sign style',
        'Dialogue: 0,0:00:11.00,0:00:12.00,Missing,,0,0,0,,An unknown style is Default',
      ),
    );
    expect(cues).toEqual([
      { start: 6.5, end: 8, lines: [[{ text: "I hope she didn't notice.", italic: true }]] },
      { start: 9, end: 10, lines: [[{ text: "MARA'S BAKERY", bold: true }]], top: true },
      { start: 10, end: 11, lines: [[{ text: 'Still the sign style', bold: true }]], top: true },
      { start: 11, end: 12, lines: [[{ text: 'An unknown style is Default' }]] },
    ]);
  });

  it('applies \\an and font-weight overrides, and \\r goes back to the style', () => {
    const cues = parseSubtitleText(
      assScript(
        'Dialogue: 0,0:00:11.00,0:00:12.00,Default,,0,0,0,,{\\an8\\b700}Top and bold',
        'Dialogue: 0,0:00:12.00,0:00:13.00,Sign,,0,0,0,,{\\an2\\b400}Moved down, not bold',
        'Dialogue: 0,0:00:13.00,0:00:14.00,Thoughts,,0,0,0,,{\\i0}upright {\\r}italic again',
      ),
    );
    expect(cues).toEqual([
      { start: 11, end: 12, lines: [[{ text: 'Top and bold', bold: true }]], top: true },
      { start: 12, end: 13, lines: [[{ text: 'Moved down, not bold' }]] },
      {
        start: 13,
        end: 14,
        lines: [[{ text: 'upright ' }, { text: 'italic again', italic: true }]],
      },
    ]);
  });

  it('turns \\N into a line break, \\n into a space and \\h into a hard space, and hides {comments}', () => {
    const [cue] = parseSubtitleText(
      assScript(
        'Dialogue: 0,0:00:15.00,0:00:16.00,Default,,0,0,0,,Hard\\Nbreak, soft\\nbreak and\\hhard space{TL note: a pun}',
      ),
    );
    expect(cue?.lines).toEqual([
      [{ text: 'Hard' }],
      [{ text: 'break, soft break and\u00a0hard space' }],
    ]);
  });

  it('keeps angle brackets and ampersands as written, since ASS has no tags or entities', () => {
    const [cue] = parseSubtitleText(
      assScript('Dialogue: 0,0:00:19.00,0:00:20.00,Default,,0,0,0,,<i>literal</i> &amp; I <3 you'),
    );
    expect(cue?.lines).toEqual([[{ text: '<i>literal</i> &amp; I <3 you' }]]);
  });

  it('drops vector drawings and lines that are only drawings', () => {
    const cues = parseSubtitleText(
      assScript(
        'Dialogue: 0,0:00:13.00,0:00:14.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}',
        'Dialogue: 0,0:00:14.00,0:00:15.00,Default,,0,0,0,,{\\p2}m 0 0 l 10 10{\\p0}Caption',
      ),
    );
    expect(cues.map(words)).toEqual(['Caption']);
  });

  it('shows the same words once when several layers draw them', () => {
    const cues = parseSubtitleText(
      assScript(
        'Dialogue: 1,0:00:17.00,0:00:18.00,Default,,0,0,0,,Twice',
        'Dialogue: 0,0:00:17.00,0:00:18.00,Default,,0,0,0,,{\\bord3}Twice',
      ),
    );
    expect(cues).toEqual([{ start: 17, end: 18, lines: [[{ text: 'Twice' }]] }]);
  });

  it('drops lines with broken times or that end before they start', () => {
    const cues = parseSubtitleText(
      assScript(
        'Dialogue: 0,0:00:xx.00,0:00:02.00,Default,,0,0,0,,Broken',
        'Dialogue: 0,0:00:05.00,0:00:04.00,Default,,0,0,0,,Backwards',
        'Dialogue: 0,0:00:06.00',
        'Dialogue: 0,1:02:03.45,1:02:04.5,Default,,0,0,0,,Fine',
      ),
    );
    expect(times(cues)).toEqual([[3723.45, 3724.5]]);
  });

  it('finds the columns wherever the Format line puts them', () => {
    const script = [
      '[Script Info]',
      '',
      '[Events]',
      'Format: Start, End, Text',
      'Dialogue: 0:00:01.00,0:00:02.00,Hello, again',
    ].join('\n');
    expect(parseSubtitleText(script)).toEqual([
      { start: 1, end: 2, lines: [[{ text: 'Hello, again' }]] },
    ]);
  });

  it('reads SSA v4 styles and the legacy \\a alignment numbers', () => {
    const script = [
      '[Script Info]',
      'ScriptType: v4.00',
      '',
      '[V4 Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding',
      'Style: Default,Tahoma,24,16777215,65535,65535,-2147483640,-1,0,1,1,2,2,30,30,10,0,0',
      'Style: Top,Tahoma,24,16777215,65535,65535,-2147483640,0,0,1,1,2,6,30,30,10,0,0',
      '',
      '[Events]',
      'Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0000,0000,0000,,Bold by style',
      'Dialogue: Marked=0,0:00:03.00,0:00:04.00,Top,,0000,0000,0000,,At the top',
      'Dialogue: Marked=0,0:00:05.00,0:00:06.00,Default,,0000,0000,0000,,{\\a6}Also at the top',
      'Dialogue: Marked=0,0:00:07.00,0:00:08.00,Top,,0000,0000,0000,,{\\a2}Moved down',
    ].join('\n');
    expect(parseSubtitleText(script)).toEqual([
      { start: 1, end: 2, lines: [[{ text: 'Bold by style', bold: true }]] },
      { start: 3, end: 4, lines: [[{ text: 'At the top' }]], top: true },
      { start: 5, end: 6, lines: [[{ text: 'Also at the top', bold: true }]], top: true },
      { start: 7, end: 8, lines: [[{ text: 'Moved down' }]] },
    ]);
  });

  it('parses ten thousand Dialogue lines quickly', () => {
    const events: string[] = [];
    for (let i = 0; i < 10000; i++) {
      const at = (seconds: number) =>
        `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00`;
      events.push(
        `Dialogue: 0,${at(i * 2)},${at(i * 2 + 1)},Default,,0,0,0,,Line {\\i1}${i}{\\i0}, ok`,
      );
    }
    const began = Date.now();
    const cues = parseSubtitleText(assScript(...events));
    expect(Date.now() - began).toBeLessThan(1000);
    expect(cues).toHaveLength(10000);
    expect(cues[1]?.lines).toEqual([
      [{ text: 'Line ' }, { text: '1', italic: true }, { text: ', ok' }],
    ]);
  });
});

describe('parseCueMarkup', () => {
  it('reads plain text as one span per line', () => {
    expect(parseCueMarkup('Hello\nworld')).toEqual([[{ text: 'Hello' }], [{ text: 'world' }]]);
  });

  it('reads <i>, <b> and <u> in any case, with attributes, nested', () => {
    expect(parseCueMarkup('<I>Shout</I> <b class="x">bold <i>both</i></b> <U>under</u>')).toEqual([
      [
        { text: 'Shout', italic: true },
        { text: ' ' },
        { text: 'bold ', bold: true },
        { text: 'both', bold: true, italic: true },
        { text: ' ' },
        { text: 'under', underline: true },
      ],
    ]);
  });

  it('runs an unclosed tag to the end of the cue and ignores a stray closing tag', () => {
    expect(parseCueMarkup('<i>Runs on\nto the end')).toEqual([
      [{ text: 'Runs on', italic: true }],
      [{ text: 'to the end', italic: true }],
    ]);
    expect(parseCueMarkup('</i>plain <i>slanted')).toEqual([
      [{ text: 'plain ' }, { text: 'slanted', italic: true }],
    ]);
  });

  it('drops font, class, voice and language tags but keeps their text', () => {
    expect(parseCueMarkup('<font color="red" face="Arial">Red</font> text')).toEqual([
      [{ text: 'Red text' }],
    ]);
    expect(
      parseCueMarkup('<v Mara><c.loud>Hi</c></v> <lang fr>bonjour</lang> <span>x</span>'),
    ).toEqual([[{ text: 'Hi bonjour x' }]]);
  });

  it('keeps ruby base text and drops the reading above it', () => {
    expect(
      parseCueMarkup(
        '<ruby>東京<rt>とうきょう</rt></ruby>に<ruby>行<rp>(</rp><rt>い</rt><rp>)</rp></ruby>く',
      ),
    ).toEqual([[{ text: '東京に行く' }]]);
  });

  it('drops karaoke timestamps', () => {
    expect(parseCueMarkup('One <00:00:01.000>two <00:02.500>three')).toEqual([
      [{ text: 'One two three' }],
    ]);
  });

  it('reads SRT-style {\\i1} {\\b1} {\\u1} overrides and drops the others', () => {
    expect(
      parseCueMarkup('{\\an8}{\\i1}slanted{\\i0} {\\b1}heavy{\\b0}{\\fs20} {\\u1}lined'),
    ).toEqual([
      [
        { text: 'slanted', italic: true },
        { text: ' ' },
        { text: 'heavy', bold: true },
        { text: ' ' },
        { text: 'lined', underline: true },
      ],
    ]);
  });

  it('keeps braces that are not overrides', () => {
    expect(parseCueMarkup('{laughs} and {\\unclosed')).toEqual([
      [{ text: '{laughs} and {\\unclosed' }],
    ]);
  });

  it('decodes named and numeric entities', () => {
    expect(
      parseCueMarkup(
        '&amp; &lt;b&gt; &quot;q&quot; &apos;a&apos; caf&#233; caf&#xE9; a&nbsp;b &lrm;x&rlm; &AMP;',
      ),
    ).toEqual([[{ text: '& <b> "q" \'a\' café café a\u00a0b \u200ex\u200f &' }]]);
  });

  it('leaves unknown or impossible entities and lone angle brackets as written', () => {
    expect(parseCueMarkup('AT&T &bogus; &#0; &#x110000; &toString; I <3 you, a < b > c')).toEqual([
      [{ text: 'AT&T &bogus; &#0; &#x110000; &toString; I <3 you, a < b > c' }],
    ]);
  });

  it('breaks lines at <br>, CRLF and lone CR, and never puts a break inside a span', () => {
    const lines = parseCueMarkup('a<br>b<br/>c\r\nd\re');
    expect(lines).toEqual([
      [{ text: 'a' }],
      [{ text: 'b' }],
      [{ text: 'c' }],
      [{ text: 'd' }],
      [{ text: 'e' }],
    ]);
    for (const line of parseCueMarkup('<i>x\ny</i>\r\nz')) {
      for (const span of line) expect(span.text).not.toMatch(/[\r\n]/);
    }
  });

  it('never reads a tag across a line break', () => {
    expect(parseCueMarkup('if a<b\nand c>d')).toEqual([
      [{ text: 'if a<b' }],
      [{ text: 'and c>d' }],
    ]);
  });

  it('merges neighbouring spans in the same style', () => {
    expect(parseCueMarkup('<b>a</b><b>b</b><font>c</font>d')).toEqual([
      [{ text: 'ab', bold: true }, { text: 'cd' }],
    ]);
  });

  it('trims each line, drops empty ones, and returns nothing for an empty cue', () => {
    expect(parseCueMarkup('  <i> hi </i>  \n   \n<b></b>\n')).toEqual([
      [{ text: 'hi', italic: true }],
    ]);
    expect(parseCueMarkup('<i> </i>\n&nbsp;\n&lrm;')).toEqual([]);
    expect(parseCueMarkup('')).toEqual([]);
  });

  it('turns tabs into spaces and drops control characters', () => {
    expect(parseCueMarkup('a\u0000b\tc\u0007')).toEqual([[{ text: 'ab c' }]]);
  });
});
