import { describe, expect, it } from 'vitest';
import { isAdCue, stripAdCues } from './ads';
import { parseSubtitleText } from './parse';
import type { Cue } from './types';

/** A cue with these lines, as the parser makes it. */
const cue = (text: string, start = 1, end = 3): Cue => ({
  start,
  end,
  lines: text.split('\n').map((line) => [{ text: line }]),
});

describe('isAdCue', () => {
  it('knows the lines OpenSubtitles adds to the files it hands out', () => {
    expect(
      isAdCue(cue('Advertise your product or brand here\ncontact www.OpenSubtitles.org today')),
    ).toBe(true);
    expect(
      isAdCue(
        cue('Support us and become VIP member\nto remove all ads from www.OpenSubtitles.org'),
      ),
    ).toBe(true);
    expect(
      isAdCue(
        cue(
          'Api.OpenSubtitles.org is deprecated, please\nimplement REST API from OpenSubtitles.com',
        ),
      ),
    ).toBe(true);
    expect(
      isAdCue(
        cue(
          'Please rate this subtitle at www.osdb.link/b2kfa\nHelp other users to choose the best subtitles',
        ),
      ),
    ).toBe(true);
    expect(
      isAdCue(
        cue('Watch any video online with Open-SUBTITLES\nFree Browser extension: osdb.link/ext'),
      ),
    ).toBe(true);
  });

  it('knows an advert whose first line leads into the site’s address on the next', () => {
    expect(isAdCue(cue('Do you want subtitles for any video?\n-=[ ai.OpenSubtitles.com ]=-'))).toBe(
      true,
    );
    expect(isAdCue(cue('Official YIFY movies site:\nYTS.MX'))).toBe(true);
    expect(isAdCue(cue('-- Official YIFY movies site: --\nYTS.LT'))).toBe(true);
    // The same on one line, as before.
    expect(isAdCue(cue('Do you want subtitles for any video? -=[ ai.OpenSubtitles.com ]=-'))).toBe(
      true,
    );
    // Dialogue next to a site's address stays, even when it starts the same way.
    expect(isAdCue(cue('I found the official site:\nwww.addic7ed.com'))).toBe(false);
    expect(
      isAdCue(cue('Do you want subtitles for any video you make?\nYTS.MX is down again.')),
    ).toBe(false);
  });

  it('knows a credit for the people who made or synced the file at its start or end, and a site’s address', () => {
    expect(isAdCue(cue('Subtitles by explosiveskull'), true)).toBe(true);
    expect(isAdCue(cue('Subtitles by:\nGrzesiek Zieba'), true)).toBe(true);
    expect(isAdCue(cue('-- Ripped by aRRow --'), true)).toBe(true);
    // A credit with a site's address goes wherever it is, as do the address and "Downloaded from".
    expect(isAdCue(cue('Sync & corrections by honeybunny\nwww.addic7ed.com'))).toBe(true);
    expect(isAdCue(cue('Synced and corrected by VitoSilans\n-- www.Addic7ed.com --'))).toBe(true);
    expect(isAdCue(cue('-= www.OpenSubtitles.org =-'))).toBe(true);
    expect(isAdCue(cue('Downloaded from\nYTS.MX'))).toBe(true);
    expect(isAdCue(cue('Downloaded From www.example-subs.com'))).toBe(true);
    // Markup around the words changes nothing.
    expect(
      isAdCue(
        {
          start: 0,
          end: 2,
          lines: [[{ text: 'Subtitles by ', italic: true }, { text: 'aRRow' }]],
        },
        true,
      ),
    ).toBe(true);
    // Among the film's lines, a credit on its own is taken for dialogue.
    expect(isAdCue(cue('Subtitles by explosiveskull'))).toBe(false);
  });

  it('never takes words after "by" that start with an ordinary word for a credit', () => {
    for (const line of [
      'Ripped by the claws of a bear',
      'Corrected by hand',
      'Transcript by the court clerk',
      'Corrections by my editor',
      'Corrected by a factor of ten',
      'Synced by this machine',
    ]) {
      expect(isAdCue(cue(line), true)).toBe(false);
    }
    expect(isAdCue(cue('Corrected by hand\nwww.addic7ed.com'))).toBe(false);
  });

  it('leaves dialogue alone, even when it says "subtitles", "support us" or "downloaded"', () => {
    expect(isAdCue(cue('Where are you going?'))).toBe(false);
    expect(isAdCue(cue('Subtitles by the door are crooked.'))).toBe(false);
    expect(isAdCue(cue('Who did the subtitles by the way?'))).toBe(false);
    expect(isAdCue(cue('Support us, Johnny! Please!'))).toBe(false);
    expect(isAdCue(cue('You should become a VIP member at the club.'))).toBe(false);
    expect(isAdCue(cue('We need to remove all ads from the billboard.'))).toBe(false);
    expect(isAdCue(cue('I downloaded it from the server last night.'))).toBe(false);
    expect(isAdCue(cue('Downloaded from the server, just like you said.'))).toBe(false);
    expect(isAdCue(cue('Advertise? We can barely pay the rent.'))).toBe(false);
    // "Podnapisi" and "titlovi" are words for subtitles; only the sites' addresses are adverts.
    expect(isAdCue(cue('Gdje su titlovi?'))).toBe(false);
    expect(isAdCue(cue('Kje so podnapisi?'))).toBe(false);
    // Dialogue next to an advert line stays: the cue is not wholly an advert.
    expect(isAdCue(cue('Where are you going?\nwww.addic7ed.com'))).toBe(false);
    expect(isAdCue(cue('♪ ♪'))).toBe(false);
  });
});

describe('stripAdCues', () => {
  it('takes the adverts out of a real-looking file and keeps every line of the film', () => {
    const cues = parseSubtitleText(
      [
        '1',
        '00:00:01,000 --> 00:00:04,000',
        'Advertise your product or brand here',
        'contact www.OpenSubtitles.org today',
        '',
        '2',
        '00:00:12,500 --> 00:00:15,000',
        'I never thought I would see you again.',
        '',
        '3',
        '00:00:15,500 --> 00:00:18,000',
        '<i>Subtitles? Support us, they said.</i>',
        '',
        '4',
        '00:01:30,000 --> 00:01:33,000',
        'Sync & corrections by honeybunny',
        'www.addic7ed.com',
        '',
        '5',
        '01:50:00,000 --> 01:50:04,000',
        'Support us and become VIP member',
        'to remove all ads from www.OpenSubtitles.org',
        '',
      ].join('\n'),
    );
    const kept = stripAdCues(cues);
    expect(
      kept.map((line) => line.lines.map((spans) => spans.map((s) => s.text).join(''))),
    ).toEqual([['I never thought I would see you again.'], ['Subtitles? Support us, they said.']]);
  });

  it('takes credits out only among the first and last three lines, and adverts wherever they are', () => {
    const film = [
      cue('Subtitles by explosiveskull', 1, 3),
      cue('Where have you been?', 10, 12),
      cue('Out in the woods.', 20, 22),
      cue('And the sheep?', 30, 32),
      // A sentence carried on into the next line.
      cue('Ripped by wolves', 40, 42),
      cue('as we slept.', 43, 45),
      cue('Do you want subtitles for any video?\n-=[ ai.OpenSubtitles.com ]=-', 50, 52),
      cue('No one believed him.', 60, 62),
      cue('I did.', 70, 72),
      cue('Goodbye.', 80, 82),
      cue('Synced and corrected by VitoSilans', 90, 92),
    ];
    const kept = stripAdCues(film).map((line) => line.lines[0]![0]!.text);
    expect(kept).toEqual([
      'Where have you been?',
      'Out in the woods.',
      'And the sheep?',
      'Ripped by wolves',
      'as we slept.',
      'No one believed him.',
      'I did.',
      'Goodbye.',
    ]);
    // The edges are counted among the lines left once the adverts are out.
    const advertsFirst = [
      cue('Advertise your product or brand here\ncontact www.OpenSubtitles.org today', 1, 3),
      cue('Official YIFY movies site:\nYTS.MX', 4, 6),
      cue('Do you want subtitles for any video?\n-=[ ai.OpenSubtitles.com ]=-', 7, 9),
      cue('Ripped by aRRow', 10, 12),
      ...Array.from({ length: 6 }, (_, i) => cue(`Line ${i + 1}.`, 20 + i * 10, 22 + i * 10)),
    ];
    expect(stripAdCues(advertsFirst).map((line) => line.lines[0]![0]!.text)).toEqual(
      Array.from({ length: 6 }, (_, i) => `Line ${i + 1}.`),
    );
  });

  it('gives back the same list for a file with no adverts', () => {
    const cues = [cue('Hello.'), cue('Goodbye.', 4, 6)];
    expect(stripAdCues(cues)).toBe(cues);
  });
});
