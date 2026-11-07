import type { Cue } from './types';

/*
 * Lines that subtitle sites put into the files they hand out: OpenSubtitles'
 * own adverts, a site's address, and credits for the people who made or
 * synced the file. They are not part of the film, so they never show.
 *
 * Only a cue whose whole text is such a line goes. A line of dialogue that
 * happens to say "subtitles" or "support us" stays, and so does a cue that
 * holds dialogue next to an advert line.
 */

/**
 * Sites that hand out subtitle files, as they name themselves in their lines.
 * Where a site's name is also a word ("podnapisi" and "titlovi" are
 * "subtitles"), only its address counts.
 */
const SITE =
  /(?:open-?subtitles|osdb\.link|addic7ed|subscene|podnapisi\.net|yify[ -]?subtitles|yts-?subs|yts\.(?:mx|am|ag|lt|rs)|tvsubtitles|subsmax|allsubs\.org|titlovi\.com|legendas\.tv|subtitulos\.es|subdl\.com|subsource\.net)/i;

/** OpenSubtitles' adverts, as it writes them across one or two lines. */
const ADVERT =
  /advertise your product or brand here|support us and become (?:a )?vip member|please rate this subtitle|help other users to choose the best subtitles/i;

/**
 * A credit for the file: "Subtitles by explosiveskull", "Sync & corrections
 * by honeybunny", "Synced and corrected by VitoSilans". After "by" come a few
 * words of names, never a sentence: "Subtitles by the door are crooked." is
 * dialogue.
 */
const CREDIT =
  /^(?:english |eng )?(?:subtitles?|subs|subtitled|subtitling|captioned|captioning|transcript|sync(?:ed|hed|hronized|hronised)?|re-?sync(?:ed|hed)?|corrections?|corrected|ripped)(?: (?:and|&|\+) (?:sync(?:ed|hed)?|corrections?|corrected|timing|timed|encoded))*:? by:? +([^?!]{1,60})$/i;

/** "Downloaded from" and a site: an address, or a site's name. */
const DOWNLOADED =
  /^downloaded (?:from|at|on|via):? .*(?:\b[a-z0-9-]+\.(?:org|com|net|info|tv|me|io|cc|to|link|mx|am|ru|ro|co|biz)\b)/i;

/** The words of a cue, its lines joined with a space, as the viewer reads them. */
function cueText(cue: Cue): string[] {
  return cue.lines.map((line) =>
    line
      .map((span) => span.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** A line that is only an advert or a site's name, framed by dashes or stars or not. */
function isAdvertLine(line: string): boolean {
  return SITE.test(line) || ADVERT.test(line);
}

/** A credit line: its names are a few words, not a sentence ending in a full stop. */
function isCredit(text: string): boolean {
  const credit = CREDIT.exec(text);
  if (!credit) return false;
  const names = credit[1]!.trim();
  if (/[.,;]$/.test(names) && !SITE.test(names)) return false;
  return names.split(' ').length <= 5;
}

/**
 * Whether a cue is a subtitle site's advert or a credit for the file, and
 * nothing else: every line an advert or a site's address, or the whole text
 * one credit or "Downloaded from" a site.
 */
export function isAdCue(cue: Cue): boolean {
  const lines = cueText(cue).filter((line) => line !== '');
  if (lines.length === 0) return false;
  if (lines.every(isAdvertLine)) return true;
  // Frames some sites draw around the words: "-- Subtitles by X --", "== www.site.com ==".
  const text = lines
    .join(' ')
    .replace(/^[-=*~#_ ]+|[-=*~#_ ]+$/g, '')
    .trim();
  if (text.length > 160) return false;
  if (isCredit(text) || DOWNLOADED.test(text)) return true;
  // A credit with the site's address on the next line: "Sync and corrections by X / www.addic7ed.com".
  const [first, ...rest] = lines;
  return (
    rest.length > 0 &&
    isCredit(first!.replace(/^[-=*~#_ ]+|[-=*~#_ ]+$/g, '')) &&
    rest.every(isAdvertLine)
  );
}

/**
 * The cues without the subtitle site's adverts and credits. The same array
 * when there are none, so nothing is copied for a clean file.
 */
export function stripAdCues<T extends Cue>(cues: T[]): T[] {
  if (!cues.some(isAdCue)) return cues;
  return cues.filter((cue) => !isAdCue(cue));
}
