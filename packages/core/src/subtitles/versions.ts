/**
 * Helpers for the player's list of subtitle versions: which file a source
 * sent is which, which looks made for the video playing, and keeping rows
 * where they were while more arrive.
 */

/** What a release name says about the release, where it says it. */
interface ReleaseFeatures {
  /** "s01e04". */
  episode?: string;
  /** "2160p", "1080p", "720p", "576p", "480p". */
  resolution?: string;
  /** The family of source: releases from one family share their timing. */
  source?: 'web' | 'bluray' | 'hdtv' | 'dvd';
  /** The group that made the release, lower case. */
  group?: string;
}

const EXTENSION = /\.(?:srt|vtt|ass|ssa|sub|txt|mkv|mp4|m4v|webm|avi|ts|mov)$/i;
// Words a release name ends on that are not a group: "WEB-DL", "x264", "5.1".
const NOT_A_GROUP =
  /^(?:dl|rip|web|webdl|webrip|bluray|remux|hdtv|dvd|x26[45]|h26[45]|hevc|avc|aac|ac3|eac3|ddp?\d?|dts|atmos|hdr|hdr10|dv|\d+p|\d+)$/i;

function features(name: string): ReleaseFeatures {
  const found: ReleaseFeatures = {};
  const text = name.trim().replace(EXTENSION, '');
  const words = text.toLowerCase();

  const episode = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})(?![0-9])/.exec(words);
  if (episode) found.episode = `s${Number(episode[1])}e${Number(episode[2])}`;

  const resolution = /(?:^|[^a-z0-9])(2160|1080|720|576|480)[pi](?![a-z0-9])/.exec(words);
  if (resolution) found.resolution = `${resolution[1]}p`;
  else if (/(?:^|[^a-z0-9])(?:4k|uhd)(?![a-z0-9])/.test(words)) found.resolution = '2160p';

  // "Web" last: it is also a word in titles.
  if (/blu[ ._-]?ray|b[dr][ ._-]?(?:rip|remux)|(?:^|[^a-z0-9])remux(?![a-z0-9])/.test(words)) {
    found.source = 'bluray';
  } else if (/(?:^|[^a-z0-9])(?:hdtv|pdtv)(?![a-z0-9])/.test(words)) found.source = 'hdtv';
  else if (/(?:^|[^a-z0-9])dvd(?:rip|scr)?(?![a-z0-9])/.test(words)) found.source = 'dvd';
  else if (
    /(?:^|[^a-z0-9])(?:web[ ._-]?(?:dl|rip)?|amzn|nf|dsnp|hmax|atvp)(?![a-z0-9])/.test(words)
  ) {
    found.source = 'web';
  }

  // "…x264-GROUP", not the "DL" of "WEB-DL".
  const group = /-([a-z0-9]{2,})(?:\[[^\]]*\])?$/i.exec(text);
  if (group && !NOT_A_GROUP.test(group[1]!)) found.group = group[1]!.toLowerCase();
  return found;
}

/** The video's features: its file name first, its title filling the gaps. */
function videoFeatures(video: { filename?: string; title?: string }): ReleaseFeatures {
  const fromTitle = video.title ? features(video.title) : {};
  const fromFile = video.filename ? features(video.filename) : {};
  return { ...fromTitle, ...fromFile };
}

/**
 * Whether a subtitle file's release name looks made for the video playing: a
 * best guess from the two names, so the sheet can say "Matches your video".
 * Every fact both names give must agree, and at least two must: the episode,
 * the resolution, the family of source (web, Blu-ray, TV, DVD) and the group.
 */
export function releaseMatch(
  subtitleName: string | undefined,
  video: { filename?: string; title?: string },
): boolean {
  if (!subtitleName) return false;
  const sub = features(subtitleName);
  const vid = videoFeatures(video);
  let agree = 0;
  for (const field of ['episode', 'resolution', 'source', 'group'] as const) {
    const a = sub[field];
    const b = vid[field];
    if (a === undefined || b === undefined) continue;
    if (a !== b) return false;
    agree++;
  }
  return agree >= 2;
}

/**
 * Numbers the files of each source, in the order given, where a source sent
 * more than one: "OpenSubtitles 1", "OpenSubtitles 2". A source with one file
 * gets no number.
 */
export function numberBySource<T extends { source: string }>(
  items: readonly T[],
): Array<{ item: T; number?: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  const seen = new Map<string, number>();
  return items.map((item) => {
    if ((counts.get(item.source) ?? 0) < 2) return { item };
    const number = (seen.get(item.source) ?? 0) + 1;
    seen.set(item.source, number);
    return { item, number };
  });
}

/**
 * Keys in the order first seen: those already shown keep their places, and
 * new ones go after them in the order given. Keys no longer given are dropped.
 */
export function keepOrder(previous: readonly string[], next: readonly string[]): string[] {
  const wanted = new Set(next);
  const kept = previous.filter((key) => wanted.has(key));
  const known = new Set(kept);
  for (const key of next) {
    if (known.has(key)) continue;
    known.add(key);
    kept.push(key);
  }
  return kept;
}
