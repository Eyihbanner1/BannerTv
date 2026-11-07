import type { SubtitleDrift } from '../playback/drifts';
import { languageKey } from './languages';
import type { Cue } from './types';

/*
 * Reads a subtitle file against the video it is for, so the player can pick
 * the one that fits best before showing any: does it last as long as the
 * video, is it in the language's script, is it a full file rather than signs
 * only, is it for the hard of hearing, and does its length show a frame-rate
 * drift. Everything here is a judgement on strong evidence only; where the
 * evidence is thin it says nothing, and the file is taken as it is.
 */

/** Writing systems told apart, by the letters in a file's text. */
export type Script =
  | 'latin'
  | 'cyrillic'
  | 'greek'
  | 'armenian'
  | 'hebrew'
  | 'arabic'
  | 'devanagari'
  | 'bengali'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam'
  | 'sinhala'
  | 'thai'
  | 'lao'
  | 'myanmar'
  | 'georgian'
  | 'hangul'
  | 'ethiopic'
  | 'khmer'
  | 'kana'
  | 'han';

/** Unicode blocks by first and last code point, in order. Letters outside them are not counted. */
const BLOCKS: ReadonlyArray<readonly [number, number, Script]> = [
  [0x00c0, 0x024f, 'latin'],
  [0x0370, 0x03ff, 'greek'],
  [0x0400, 0x052f, 'cyrillic'],
  [0x0530, 0x058f, 'armenian'],
  [0x0590, 0x05ff, 'hebrew'],
  [0x0600, 0x06ff, 'arabic'],
  [0x0750, 0x077f, 'arabic'],
  [0x08a0, 0x08ff, 'arabic'],
  [0x0900, 0x097f, 'devanagari'],
  [0x0980, 0x09ff, 'bengali'],
  [0x0b80, 0x0bff, 'tamil'],
  [0x0c00, 0x0c7f, 'telugu'],
  [0x0c80, 0x0cff, 'kannada'],
  [0x0d00, 0x0d7f, 'malayalam'],
  [0x0d80, 0x0dff, 'sinhala'],
  [0x0e00, 0x0e7f, 'thai'],
  [0x0e80, 0x0eff, 'lao'],
  [0x1000, 0x109f, 'myanmar'],
  [0x10a0, 0x10ff, 'georgian'],
  [0x1100, 0x11ff, 'hangul'],
  [0x1200, 0x137f, 'ethiopic'],
  [0x1780, 0x17ff, 'khmer'],
  [0x1e00, 0x1eff, 'latin'],
  [0x1f00, 0x1fff, 'greek'],
  [0x3040, 0x30ff, 'kana'],
  [0x3130, 0x318f, 'hangul'],
  [0x31f0, 0x31ff, 'kana'],
  [0x3400, 0x4dbf, 'han'],
  [0x4e00, 0x9fff, 'han'],
  [0xac00, 0xd7af, 'hangul'],
  [0xf900, 0xfaff, 'han'],
  [0xfb1d, 0xfb4f, 'hebrew'],
  [0xfb50, 0xfdff, 'arabic'],
  [0xfe70, 0xfeff, 'arabic'],
  [0xff66, 0xff9f, 'kana'],
];

function scriptOfCode(code: number): Script | undefined {
  if (code < 0x80) {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) ? 'latin' : undefined;
  }
  // × and ÷ sit among the Latin letters.
  if (code === 0xd7 || code === 0xf7) return undefined;
  for (const [first, last, script] of BLOCKS) {
    if (code < first) return undefined;
    if (code <= last) return script;
  }
  return undefined;
}

/** The scripts a language is written in, by language key. Languages not listed are not judged. */
const LANGUAGE_SCRIPTS: Readonly<Record<string, readonly Script[]>> = (() => {
  const table: Record<string, readonly Script[]> = {};
  const set = (keys: string, scripts: readonly Script[]) => {
    for (const key of keys.split(' ')) table[key] = scripts;
  };
  set(
    'en fr de es es-419 pt pt-br it nl sv no da fi is pl cs sk hu ro tr hr sl sq et lv lt vi id ms tl ca eu gl cy ga gd eo sw af so la',
    ['latin'],
  );
  set('ru uk be bg mk kk mn', ['cyrillic']);
  // Written in either.
  set('sr bs az uz', ['latin', 'cyrillic']);
  set('ku', ['arabic', 'latin']);
  set('el', ['greek']);
  set('ar fa ur', ['arabic']);
  set('he yi', ['hebrew']);
  set('hi mr ne', ['devanagari']);
  set('bn', ['bengali']);
  set('ta', ['tamil']);
  set('te', ['telugu']);
  set('kn', ['kannada']);
  set('ml', ['malayalam']);
  set('si', ['sinhala']);
  set('th', ['thai']);
  set('lo', ['lao']);
  set('my', ['myanmar']);
  set('ka', ['georgian']);
  set('hy', ['armenian']);
  set('am', ['ethiopic']);
  set('km', ['khmer']);
  set('ko', ['hangul']);
  set('zh zh-hans zh-hant', ['han']);
  set('ja', ['kana', 'han']);
  return table;
})();

/** What a file's lines say about it, read once when it loads. Nothing here depends on the video. */
export interface SubtitleProfile {
  /** Lines (cues) in the file, its adverts taken out. */
  lines: number;
  /** Seconds: when the first line starts. */
  start: number;
  /**
   * Seconds: when the last line ends, leaving out up to two stray lines set
   * ten minutes or more after the rest (a credit after the end titles).
   */
  end: number;
  /**
   * Seconds: the latest few line ends (TAIL_LINES at most) among the same
   * lines, latest first, for telling lines that run on past the video's end
   * from a lone late line.
   */
  latestEnds: number[];
  /** Letters read for their script, at most MAX_LETTERS. */
  letters: number;
  /** Of those, the letters in each script. */
  scripts: Partial<Record<Script, number>>;
  /** Lines marked for the hard of hearing: sounds in brackets, a speaker's name, music alone. */
  hearingLines: number;
  /** The release name the addon sent says it is for the hard of hearing (SDH). */
  hearingLabel: boolean;
  /** The release name says it holds only forced lines, or signs and songs. */
  forcedLabel: boolean;
}

/** Letters read for the script check: enough to judge, and no more than a TV needs to count. */
const MIN_LETTERS = 200;
const MAX_LETTERS = 30000;
/**
 * A line set this long after every line before it is a stray credit, not the
 * film's last line. Long, so that a quiet stretch before a film's last words
 * is never taken for one.
 */
const STRAY_GAP_S = 600;
const MAX_STRAYS = 2;
/** Line ends kept from the end of a file (`latestEnds`). */
const TAIL_LINES = 3;

/** A sound or a description in brackets at the start of a line: "[door creaks]", "(sighs) I know". */
const BRACKETED = /^[-–—]?\s*[[(][^\])]{2,}[\])]/;
/** A speaker's name in capitals before a colon: "JOHN: Over here.", "- MAN #2: Hey!". */
const SPEAKER = /^[-–—]?\s*[A-Z][A-Z0-9'’.# -]{1,28}:(?:\s|$)/;
/** Music notes alone, with no words between them. */
const MUSIC_ALONE = /^[\s♪♫#*~]*[♪♫][\s♪♫#*~]*$/;
const HEARING_LABEL = /(?:^|[^a-z])(?:sdh|hearing[ ._-]?impaired)(?:[^a-z]|$)/i;
const FORCED_LABEL = /(?:^|[^a-z])(?:forced|signs?[ ._-]*(?:&|and|\+|\/)[ ._-]*songs)(?:[^a-z]|$)/i;

function lineText(line: Cue['lines'][number]): string {
  return line
    .map((span) => span.text)
    .join('')
    .trim();
}

function isHearingLine(text: string): boolean {
  if (BRACKETED.test(text) || MUSIC_ALONE.test(text)) return true;
  const speaker = SPEAKER.exec(text);
  // Two capitals at least, so "I: ..." or "A: ..." in a quiz is not a name.
  return !!speaker && (speaker[0].match(/[A-Z]/g) ?? []).length >= 2;
}

/**
 * Reads a parsed file (sorted by start, as parseSubtitleText gives it, its
 * adverts already taken out) for its checks, with the release name the addon
 * sent, if any.
 */
export function profileSubtitles(cues: readonly Cue[], label?: string): SubtitleProfile {
  const scripts: Partial<Record<Script, number>> = {};
  let letters = 0;
  let hearingLines = 0;
  for (const cue of cues) {
    let hearing = false;
    for (const line of cue.lines) {
      const text = lineText(line);
      if (!hearing && isHearingLine(text)) hearing = true;
      if (letters >= MAX_LETTERS) continue;
      for (let i = 0; i < text.length; i++) {
        const script = scriptOfCode(text.charCodeAt(i));
        if (script === undefined) continue;
        scripts[script] = (scripts[script] ?? 0) + 1;
        letters++;
      }
    }
    if (hearing) hearingLines++;
  }

  // The latest end among the lines up to each one, for telling stray lines at the end.
  const latest: number[] = [];
  let latestEnd = 0;
  for (const cue of cues) {
    latestEnd = Math.max(latestEnd, cue.end);
    latest.push(latestEnd);
  }
  // The last line counted: up to MAX_STRAYS stray lines at the end are left out.
  let last = cues.length - 1;
  for (let strays = 0; last > 0 && strays < MAX_STRAYS; strays++) {
    if (cues[last]!.start - latest[last - 1]! <= STRAY_GAP_S) break;
    last--;
  }
  const end = last >= 0 ? latest[last]! : latestEnd;
  // The latest few ends among the lines counted, latest first.
  const latestEnds: number[] = [];
  for (let i = 0; i <= last; i++) {
    const lineEnd = cues[i]!.end;
    if (latestEnds.length === TAIL_LINES && lineEnd <= latestEnds[TAIL_LINES - 1]!) continue;
    let at = latestEnds.length;
    while (at > 0 && latestEnds[at - 1]! < lineEnd) at--;
    latestEnds.splice(at, 0, lineEnd);
    if (latestEnds.length > TAIL_LINES) latestEnds.pop();
  }

  return {
    lines: cues.length,
    start: cues.length > 0 ? cues[0]!.start : 0,
    end,
    latestEnds,
    letters,
    scripts,
    hearingLines,
    hearingLabel: !!label && HEARING_LABEL.test(label),
    forcedLabel: !!label && FORCED_LABEL.test(label),
  };
}

/** Under this share of its letters in the language's script, a file is in another language. */
const RIGHT_SCRIPT_SHARE = 0.2;
/** Japanese is written with kana among the kanji; Chinese has none. */
const JAPANESE_KANA_SHARE = 0.05;
const CHINESE_KANA_SHARE = 0.2;

/**
 * Whether the file's text is in the script of the language it is offered in:
 * a file offered as English whose letters are Cyrillic is another language's.
 * 'unknown' when the language's script is not known or the file has too few
 * letters to say.
 */
export function judgeScript(
  profile: Pick<SubtitleProfile, 'letters' | 'scripts'>,
  language: string,
): 'right' | 'wrong' | 'unknown' {
  const key = languageKey(language);
  const expected = LANGUAGE_SCRIPTS[key];
  if (!expected || profile.letters < MIN_LETTERS) return 'unknown';
  const share = (script: Script) => (profile.scripts[script] ?? 0) / profile.letters;
  let inScript = 0;
  for (const script of expected) inScript += share(script);
  if (inScript < RIGHT_SCRIPT_SHARE) return 'wrong';
  if (key === 'ja' && share('kana') < JAPANESE_KANA_SHARE) return 'wrong';
  if (key.indexOf('zh') === 0 && share('kana') > CHINESE_KANA_SHARE) return 'wrong';
  return 'right';
}

/** The length of the video the file is for. */
export interface VideoLength {
  /** Seconds; undefined when not known, and for a live broadcast. */
  seconds?: number;
  /**
   * The video's own length, from the player. The title's running time from
   * its page is rounded and may be another cut's: good enough to tell a file
   * that stops half way, never a drift.
   */
  exact: boolean;
}

/** The video's length when it can be judged by: known, and longer than a clip or a sample. */
const MIN_JUDGED_S = 300;
/** A file timed for 25 fps runs this much shorter than one for 23.976 fps, and the other way round longer. */
export const FRAME_RATE_RATIO = 25 / (24000 / 1001);
/** Lines a minute under which a file holds only signs and the odd line in another language. */
const SIGNS_PER_MINUTE = 1.2;
/** Past this many lines a file is never taken for signs only, however long the video. */
const SIGNS_MAX_LINES = 150;
/** A file that stops before this share of the video, and over PARTIAL_GAP_S before its end, covers only part. */
const PARTIAL_SHARE = 0.7;
const PARTIAL_GAP_S = 600;
/** A file is past the video's end only beyond this: releases differ by a few seconds. */
const PAST_END_MIN_S = 10;
const PAST_END_SHARE = 0.003;
/**
 * A file falls behind (timed for film speed on a faster, PAL, video) only on
 * strong evidence: its last line ends past the video's end by at least half
 * of what the frame rates' ratio gives (2.1%), and so do its last
 * BEHIND_MIN_LINES lines. Less than that, or one or two late lines, is
 * another release's ending, a teaser or a translator's credit: no drift.
 */
const BEHIND_MIN_SHARE = (FRAME_RATE_RATIO - 1) / 2;
const BEHIND_MIN_LINES = 3;
/** With only the title's running time to go by, a file is too long only well past it. */
const RUNTIME_LONG_SHARE = 1.25;
/** Lines marked for the hard of hearing, at least this many and this share, make an SDH file. */
const HEARING_MIN_LINES = 8;
const HEARING_SHARE = 0.07;

/** How a file sits against the video, and what that means for picking it. */
export interface SubtitleFit {
  /** Whether the text is in the language's script. */
  script: 'right' | 'wrong' | 'unknown';
  /** Only signs and the odd line: a forced file, not the dialogue. */
  signs: boolean;
  /** For the hard of hearing: sounds and speakers' names among the lines. */
  hearing: boolean;
  /**
   * How its length sits against the video's: 'short' stops well before the
   * end (part of the film, such as CD1), 'long' runs past the end by more
   * than a frame-rate drift explains (another cut). Undefined when the
   * video's length cannot be judged by.
   */
  length?: 'fits' | 'short' | 'long';
  /** The last line's end over the video's length, when known. */
  coverage?: number;
  /** A drift its length gives away: stretching fixes it. */
  drift?: SubtitleDrift;
  /** Passed over like a file that could not be read: in another script, or signs only. */
  unfit: boolean;
}

function judgedLength(video: VideoLength): number | undefined {
  const { seconds } = video;
  return seconds !== undefined && isFinite(seconds) && seconds >= MIN_JUDGED_S
    ? seconds
    : undefined;
}

function pastEndMargin(seconds: number): number {
  return Math.max(PAST_END_MIN_S, seconds * PAST_END_SHARE);
}

/**
 * Judges one file against the video. The drift that only other files can
 * show ('ahead') is left to judgeSubtitleFits.
 */
export function judgeSubtitleFit(
  profile: SubtitleProfile,
  video: VideoLength,
  language: string,
): SubtitleFit {
  const script = judgeScript(profile, language);
  const hearing =
    profile.hearingLabel ||
    (profile.hearingLines >= HEARING_MIN_LINES &&
      profile.hearingLines / Math.max(1, profile.lines) >= HEARING_SHARE);
  const fit: SubtitleFit = { script, signs: profile.forcedLabel, hearing, unfit: false };
  const seconds = judgedLength(video);
  if (seconds !== undefined) {
    const perMinute = profile.lines / (seconds / 60);
    if (perMinute < SIGNS_PER_MINUTE && profile.lines < SIGNS_MAX_LINES) fit.signs = true;
    fit.coverage = profile.end / seconds;
    const margin = pastEndMargin(seconds);
    if (profile.end < seconds * PARTIAL_SHARE && seconds - profile.end > PARTIAL_GAP_S) {
      fit.length = 'short';
    } else if (!video.exact) {
      fit.length = profile.end > seconds * RUNTIME_LONG_SHARE ? 'long' : 'fits';
    } else if (profile.end <= seconds + margin) {
      fit.length = 'fits';
    } else if (profile.end > seconds * FRAME_RATE_RATIO + margin) {
      fit.length = 'long';
    } else {
      // Past the end, but by no more than a file timed for film speed runs
      // on a faster (PAL) video: stretched onto the video's clock, it ends in
      // time. Only when it runs on well past the end, line after line.
      fit.length = 'fits';
      const pastEnd = profile.latestEnds.filter((lineEnd) => lineEnd > seconds + margin).length;
      if (
        !fit.signs &&
        profile.end >= seconds * (1 + BEHIND_MIN_SHARE) &&
        pastEnd >= BEHIND_MIN_LINES
      ) {
        fit.drift = 'behind';
      }
    }
  }
  fit.unfit = fit.script === 'wrong' || fit.signs;
  return fit;
}

/** Two files' last lines this close (a share of the time) end together. */
const AGREE_SHARE = 0.01;
/** How close a file's end must come to a frame-rate drift's before the others' to count as one. */
const DRIFT_TOLERANCE = 0.005;
/** Files ending well before the video, beyond any end titles, tell nothing of where the last line goes. */
const CREDITS_MAX_S = 900;

function median(values: readonly number[]): number {
  // Plain numbers: two that are equal are alike, so an unstable sort needs no tie-break.
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Where most of these files' last lines agree to end (within AGREE_SHARE of
 * their middle), when at least two do; undefined when they do not agree.
 */
function agreedEnd(ends: readonly number[]): number | undefined {
  if (ends.length < 2) return undefined;
  const consensus = median(ends);
  const agreeing = ends.filter((end) => Math.abs(end - consensus) <= consensus * AGREE_SHARE);
  return agreeing.length >= 2 && agreeing.length * 2 > ends.length ? consensus : undefined;
}

/**
 * Judges the files offered in one language together: each on its own, and
 * one ending about 4% before the others ('ahead': timed for 25 fps on a
 * film-speed video) when at least two others that fit the video agree on
 * where the last line goes, none agrees with it, and stretched it still ends
 * within the video. A file judged on its own as falling behind ('behind') is
 * not, when such others agree on an end and its own is not about 4% after
 * theirs: it is another cut, or has a longer ending, and is too long. Only
 * with the video's own length.
 */
export function judgeSubtitleFits<K>(
  files: ReadonlyArray<{ id: K; profile: SubtitleProfile }>,
  video: VideoLength,
  language: string,
): Map<K, SubtitleFit> {
  const fits = new Map<K, SubtitleFit>();
  for (const file of files) fits.set(file.id, judgeSubtitleFit(file.profile, video, language));
  const seconds = judgedLength(video);
  if (!video.exact || seconds === undefined) return fits;
  const margin = pastEndMargin(seconds);
  // Files that fit the video as they are, with a last line where a film's goes.
  const steady = files.filter((file) => {
    const fit = fits.get(file.id)!;
    return (
      !fit.unfit &&
      fit.length === 'fits' &&
      fit.drift === undefined &&
      file.profile.end >= seconds - CREDITS_MAX_S &&
      file.profile.end <= seconds + margin
    );
  });
  for (const file of files) {
    const fit = fits.get(file.id)!;
    if (fit.unfit || fit.length !== 'fits') continue;
    const end = file.profile.end;
    const others = steady.filter((other) => other !== file).map((other) => other.profile.end);
    const consensus = agreedEnd(others);
    if (consensus === undefined) continue;
    if (fit.drift === 'behind') {
      if (Math.abs(end / consensus - FRAME_RATE_RATIO) > DRIFT_TOLERANCE) {
        delete fit.drift;
        fit.length = 'long';
      }
      continue;
    }
    if (fit.drift !== undefined) continue;
    if (others.some((other) => Math.abs(other - end) <= end * AGREE_SHARE)) continue;
    if (Math.abs(end / consensus - 1 / FRAME_RATE_RATIO) > DRIFT_TOLERANCE) continue;
    if (end * FRAME_RATE_RATIO > seconds + margin) continue;
    fit.drift = 'ahead';
  }
  return fits;
}
