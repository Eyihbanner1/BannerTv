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

  it('knows a credit for the people who made or synced the file, and a site’s address', () => {
    expect(isAdCue(cue('Subtitles by explosiveskull'))).toBe(true);
    expect(isAdCue(cue('Sync & corrections by honeybunny\nwww.addic7ed.com'))).toBe(true);
    expect(isAdCue(cue('Synced and corrected by VitoSilans\n-- www.Addic7ed.com --'))).toBe(true);
    expect(isAdCue(cue('Subtitles by:\nGrzesiek Zieba'))).toBe(true);
    expect(isAdCue(cue('-= www.OpenSubtitles.org =-'))).toBe(true);
    expect(isAdCue(cue('Downloaded from\nYTS.MX'))).toBe(true);
    expect(isAdCue(cue('Downloaded From www.example-subs.com'))).toBe(true);
    // Markup around the words changes nothing.
    expect(
      isAdCue({
        start: 0,
        end: 2,
        lines: [[{ text: 'Subtitles by ', italic: true }, { text: 'aRRow' }]],
      }),
    ).toBe(true);
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

  it('gives back the same list for a file with no adverts', () => {
    const cues = [cue('Hello.'), cue('Goodbye.', 4, 6)];
    expect(stripAdCues(cues)).toBe(cues);
  });
});
