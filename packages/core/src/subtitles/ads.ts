import type { Cue } from './types';

/*
 * Lines that subtitle sites put into the files they hand out: OpenSubtitles'
 * own adverts, a site's address, and credits for the people who made or
 * synced the file. They are not part of the film, so they never show.
 *
 * Only a cue whose whole text is such a line goes. A line of dialogue that
 * happens to say "subtitles" or "support us" stays, and so does a cue that
 * holds dialogue next to an advert line. Adverts and sites' addresses go
 * wherever they are; a credit goes only among the file's first or last few
 * lines, where sites put them, so a line of dialogue that reads like one
 * ("Corrected by a factor of ten") stays.
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
 * The words sites put before their address on the next line: "Do you want
 * subtitles for any video? / -=[ ai.OpenSubtitles.com ]=-" and "Official
 * YIFY movies site: / YTS.MX". Only as the whole line, so dialogue that
 * starts the same way stays.
 */
const LEAD_IN = /^(?:do you want subtitles for any video\??|official yify movies site:?)$/i;

/** Frames some sites draw around the words: "-- Subtitles by X --", "== www.site.com ==". */
const FRAME = /^[-=*~#_ ]+|[-=*~#_ ]+$/g;

/**
 * A credit for the file: "Subtitles by explosiveskull", "Sync & corrections
 * by honeybunny", "Synced and corrected by VitoSilans". After "by" come a few
 * words of names, never a sentence: "Subtitles by the door are crooked." is
 * dialogue.
 */
const CREDIT =
  /^(?:english |eng )?(?:subtitles?|subs|subtitled|subtitling|captioned|captioning|transcript|sync(?:ed|hed|hronized|hronised)?|re-?sync(?:ed|hed)?|corrections?|corrected|ripped)(?: (?:and|&|\+) (?:sync(?:ed|hed)?|corrections?|corrected|timing|timed|encoded))*:? by:? +([^?!]{1,60})$/i;

/**
 * Ordinary words that start what comes after "by" in dialogue, never a
 * name: "Corrected by hand", "Ripped by the claws of a bear", "Transcript by
 * my editor".
 */
const ORDINARY =
  /^(?:the|a|an|my|your|his|her|its|our|their|this|that|these|those|some|any|all|no|every|each|another|other|me|you|him|us|them|it|one|someone|somebody|anyone|nobody|people|hand|mistake|accident|chance|design|force|far|now|then|default|nature|law|heart|night|day|name|sight|ear|eye|phone|mail|email|car|train|bus|foot|air|sea|land|way)$/i;

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
  return SITE.test(line) || ADVERT.test(line) || LEAD_IN.test(line.replace(FRAME, ''));
}

/**
 * A credit line: its names are a few words, not a sentence ending in a full
 * stop, and do not start with an ordinary word.
 */
function isCredit(text: string): boolean {
  const credit = CREDIT.exec(text);
  if (!credit) return false;
  const names = credit[1]!.trim();
  if (/[.,;]$/.test(names) && !SITE.test(names)) return false;
  const words = names.split(' ');
  return words.length <= 5 && !ORDINARY.test(words[0]!);
}

/**
 * Whether a cue is a subtitle site's advert or a credit for the file, and
 * nothing else: every line an advert or a site's address, "Downloaded from"
 * a site, or a credit with the site's address. A credit on its own counts
 * only when the cue is among the file's first or last few lines (`atEdge`).
 */
export function isAdCue(cue: Cue, atEdge = false): boolean {
  const lines = cueText(cue).filter((line) => line !== '');
  if (lines.length === 0) return false;
  if (lines.every(isAdvertLine)) return true;
  const text = lines.join(' ').replace(FRAME, '').trim();
  if (text.length > 160) return false;
  if (DOWNLOADED.test(text)) return true;
  // A credit with the site's address on the next line: "Sync and corrections by X / www.addic7ed.com".
  const [first, ...rest] = lines;
  if (rest.length > 0 && isCredit(first!.replace(FRAME, '')) && rest.every(isAdvertLine)) {
    return true;
  }
  return atEdge && isCredit(text);
}

/** A credit goes only among this many lines at the file's start or end. */
const CREDIT_EDGE = 3;

/**
 * The cues without the subtitle site's adverts and credits: the adverts
 * wherever they are, then the credits among the first and last
 * CREDIT_EDGE lines left. The same array when there are none.
 */
export function stripAdCues<T extends Cue>(cues: T[]): T[] {
  const lines = cues.filter((cue) => !isAdCue(cue));
  const last = lines.length - CREDIT_EDGE;
  const kept = lines.filter(
    (cue, index) => (index >= CREDIT_EDGE && index < last) || !isAdCue(cue, true),
  );
  return kept.length === cues.length ? cues : kept;
}
