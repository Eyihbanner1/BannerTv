/** A file extension at the end of a name, video or subtitle. */
const EXTENSION =
  /\.(?:srt|vtt|ass|ssa|sub|txt|mkv|mp4|m4v|webm|avi|ts|m2ts|mts|mov|wmv|flv|mpg|mpeg)$/i;

/**
 * "…x264-GROUP", or "…x264-GROUP[site]" with a site's tag after it. No "["
 * inside the tag, so a long careless line is read once.
 */
const GROUP = /-([a-z0-9]{2,})(?:\[[^\][]*\])?$/i;

// Words a release name ends on that are not a group: "WEB-DL", "Blu-Ray",
// "x264", "DTS-HD", "5.1", a language ("-ITA"), "-sample" or "-NOGRP".
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
