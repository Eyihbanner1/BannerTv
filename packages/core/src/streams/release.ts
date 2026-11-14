/** A file extension at the end of a name, video or subtitle. */
const EXTENSION =
  /\.(?:srt|vtt|ass|ssa|sub|smi|idx|txt|mkv|mp4|m4v|webm|avi|ts|m2ts|mts|mov|wmv|flv|mpg|mpeg)$/i;

/**
 * "…x264-GROUP", or "…x264-GROUP[site]" with a site's tag after it. No "["
 * inside the tag, so a long careless line is read once.
 */
const GROUP = /-([a-z0-9]{2,})(?:\[[^\][]*\])?$/i;

// Words a release name ends on that are not a group: "WEB-DL", "Blu-Ray",
// "x264", "DTS-HD", "5.1", a language ("-ITA"), "-sample", "-NOGRP", or a
// subtitle file's own tags ("-HI", "-SDH", "-NHI", "-CD1", "-v2").
const NOT_A_GROUP = new RegExp(
  '^(?:' +
    [
      'dl|rip|web|webdl|webrip|bluray|ray|remux|hdtv|dvd|hd|es|ma',
      'bdrip|brrip|dlrip|hdrip|dvdrip|tvrip|camrip',
      'x26[45]|h26[45]|hevc|avc|av1|xvid|divx|aac\\d?|ac3|eac3|ddp?\\d?|dts|truehd|flac|opus|atmos',
      'hdr|hdr10|sdr|dv|\\d+p|4k|uhd|\\d+|\\d*bits?|mkv|mp4|avi',
      // "S01-S05", "S01E01-E02".
      's\\d+|e\\d+|s\\d+e\\d+',
      'sample|trailer|teaser|featurette|proper|repack|internal|nogrp|nogroup',
      'multi|dual|audio|lang|dub|dubbed|subs?|esubs?|vostfr|truefrench',
      'eng|english|ingles|ita|italian|spa|spanish|esp|fre|french|ger|german|rus|hin|hindi|jpn|kor',
      'lat|latino|castellano',
      'hi|sdh|cc|nhi|nonhi|forced|cd\\d|v\\d',
    ].join('|') +
    ')$',
  'i',
);

/**
 * The group that made a release, lower case: the "FLUX" of
 * "Film.2023.1080p.WEB-DL.DDP5.1.H.264-FLUX.mkv". Undefined when the name
 * does not end on one.
 */
export function releaseGroup(name: string): string | undefined {
  const match = GROUP.exec(name.trim().replace(EXTENSION, ''));
  if (!match || NOT_A_GROUP.test(match[1]!)) return undefined;
  return match[1]!.toLowerCase();
}

/*
 * A subtitle file's name is often its release's name with tags of its own
 * after it: its language ("…-NTb.en.srt", "….English.srt",
 * "…-NTb13_[spa].srt"), that it is for the hard of hearing ("…-CAKES-HI.srt",
 * "…(SDH).srt", "….en[cc].srt") or is not ("…-CAKES-NHI.srt", "….Non-HI.srt"),
 * which disc of a release split in two it goes with ("…-HigHoT-CD1.ENG.srt"),
 * a second version ("…-EVO-HI.v2.srt") or the site it came from
 * ("….HI.C.updated.Addic7ed.com.srt"). Those are read off the end, one at a
 * time, before the release is read.
 */

/** Languages, as ISO 639 codes and names: the end of a name only. */
const LANGUAGE_TAG = new RegExp(
  '^(?:' +
    [
      // ISO 639-1, and the regions and scripts that follow them ("pt-BR", "sr.cyr").
      'en|es|fr|de|it|pt|br|ru|tr|fa|ar|he|iw|id|th|vi|ja|jp|ko|kr|zh|cn|tw|nl|sv|se|no|nb|da|dk',
      'fi|pl|cs|cz|sk|sl|hr|sr|bs|bg|ro|hu|el|gr|uk|ua|et|lv|lt|ms|ca|eu|gl|is|mk|sq|hy|ka|ml|ta|te',
      'bn|ur|mr|kn|lat|cyr|latn|cyrl',
      // ISO 639-2, and the codes subtitle sites use.
      'eng|spa|fre|fra|ger|deu|ita|por|pob|pb|ptbr|rus|tur|ara|heb|hrv|srp|scc|bos|slv|slo|cze|ces',
      'slk|pol|hun|rum|ron|bul|gre|ell|chi|zho|chs|cht|jpn|kor|tha|vie|ind|may|msa|per|fas|far|swe',
      'nor|dan|fin|dut|nld|est|lav|lit|ukr|cat|baq|eus|glg|hin|ben|tam|tel|urd|mal|ice|isl|mac|mkd',
      'alb|sqi|arm|hye|geo|kat|esp|engl',
      'english|spanish|espanol|castellano|latino|french|francais|german|deutsch|italian|italiano',
      'portuguese|brazilian|russian|turkish|turkce|arabic|hebrew|croatian|serbian|bosnian',
      'slovenian|czech|cesky|slovak|polish|hungarian|romanian|bulgarian|greek|chinese|japanese',
      'korean|thai|vietnamese|indonesian|malay|persian|farsi|swedish|norwegian|danish|finnish',
      'dutch|estonian|latvian|lithuanian|ukrainian|catalan|hindi',
    ].join('|') +
    ')$',
  'i',
);
/** For the hard of hearing: "HI", "SDH", "CC". */
const HEARING_TAG = /^(?:hi|sdh|cc)$/i;
/** Plain lines, not for the hard of hearing: "NonHI", "NHI". */
const PLAIN_TAG = /^(?:nonhi|nhi)$/i;
/** "Non-HI" or "Non.HI" at the end, two words that are one tag. */
const NON_HI_END = /[ ._-]+non[ ._-]hi$/i;
/**
 * "SDH" or "hearing impaired" anywhere, or "HI" or "CC" after another word
 * ("…-CAKES-HI", "….HI.cc.en.LGND", "….en[cc]"): "Hi.Score.Girl" is a
 * title.
 */
const HEARING_WORD =
  /(?:^|[^a-z0-9])(?:sdh|hearing[ ._-]?impaired)(?![a-z])|[^a-z0-9](?:hi|cc)(?![a-z0-9])/i;
/**
 * "NonHI", "Non-HI" or "NHI" anywhere says the lines are plain, whatever
 * else the name says: LGND names its plain files "….NonHI.cc.en.LGND".
 */
const PLAIN_WORD = /(?:^|[^a-z0-9])(?:non[ ._-]?hi|nhi)(?![a-z0-9])/i;
/** Tags that say nothing of the release or of the file's lines. */
const OTHER_TAG =
  /^(?:forced|full|subs?|v\d|ansi|utf-?8|c|updated|edit(?:ed)?|orig(?:inal)?|addic7ed|com)$/i;
/** A tag in brackets at the end: "(SDH)", "[cc]", "[ger]", "(1)", "[ANSI]". */
const BRACKET_TAG = /[ ._-]*[[(]([a-z0-9-]{1,12})[\])]$/i;
/** A word after a separator at the end: ".eng", "-HI", " ENG", "_en", "-CD1". */
const END_WORD = /[ ._-]+([a-z0-9]{1,12})$/i;
/** A subtitle pack's numbering before its language: "-NTb13_[spa]". */
const PACK_TAG = /\d+_\[[a-z]{2,3}\]$/i;
/** A disc of a release split in two or more: "CD1", "cd.2", "Disc 1". */
const DISC = /(?:^|[^a-z0-9])(?:cd|dis[ck])[ ._-]?([1-9])(?![0-9])/i;
const DISC_TAG = /^(?:cd|dis[ck])([1-9])$/i;
/** "Part 1 of 2", anywhere. */
const PART_OF = /(?:^|[^a-z0-9])(?:part|pt)[ ._-]?([1-9])[ ._-]*of[ ._-]*[2-9](?![0-9])/i;
/** "Part1" as the last tag of a name that ends on a group: "…XviD-GRP.part1". */
const PART_AFTER_GROUP = /-[a-z0-9]{2,}[ ._-]+(?:part|pt)[ ._-]?([1-9])$/i;

/** What a name says past the release it names. */
export interface NameTags {
  /** The name without its extension and the tags that follow the release. */
  release: string;
  /** It says the file is for the hard of hearing: HI, SDH or CC, and not NonHI or NHI. */
  hearing: boolean;
  /** Which disc of a release split in two or more it goes with: CD1, Disc 2, "Part 1 of 2". */
  part?: number;
}

function isTag(word: string, bracketed: boolean): boolean {
  return (
    LANGUAGE_TAG.test(word) ||
    HEARING_TAG.test(word) ||
    PLAIN_TAG.test(word) ||
    OTHER_TAG.test(word) ||
    DISC_TAG.test(word) ||
    (bracketed && /^\d{1,2}$/.test(word))
  );
}

/**
 * Reads the tags off the end of a name, one at a time, and what the name
 * says of the file. A name of one word keeps it: "It.srt" is the film.
 */
export function readNameTags(name: string): NameTags {
  let text = name.trim();
  // A few rounds at most: a careless name could otherwise be read for long.
  for (let round = 0; round < 12; round++) {
    const before = text;
    text = text.replace(EXTENSION, '').replace(PACK_TAG, '').replace(NON_HI_END, '');
    const bracket = BRACKET_TAG.exec(text);
    const tag = bracket ?? END_WORD.exec(text);
    if (tag && tag.index > 0 && isTag(tag[1]!, !!bracket)) text = text.slice(0, tag.index);
    if (text === before) break;
  }
  const disc = DISC.exec(name) ?? PART_OF.exec(name) ?? PART_AFTER_GROUP.exec(text);
  return {
    release: text,
    hearing: HEARING_WORD.test(name) && !PLAIN_WORD.test(name),
    ...(disc && { part: Number(disc[1]) }),
  };
}

/** YTS and YIFY name their releases with a tag rather than a group: "[YTS.MX]", ".YIFY". */
const YTS = /(?:^|[^a-z0-9])(?:yts(?:[ .](?:mx|am|ag|lt|pm|bz|rs))?|yify)(?![a-z0-9])/i;

/** Whether a release is YTS's (or YIFY's, the same releases' old name): their group, `yts`. */
export function isYtsRelease(name: string): boolean {
  return YTS.test(name);
}
