/**
 * Helpers for the player's list of subtitle versions: which file a source
 * sent is which, which looks made for the video playing, and keeping rows
 * where they were while more arrive.
 */

import { isYtsRelease, readNameTags, releaseGroup } from '../streams/release';

/** A family of sources: releases from one family share their timing, another's differ. */
type SourceFamily = 'web' | 'bluray' | 'hdtv' | 'dvd' | 'cam' | 'ts' | 'tc' | 'scr';

/** What a release name says about the release, where it says it. */
interface ReleaseFeatures {
  /** The season, from "s01e04", "1x04" or a season pack's "S01". */
  season?: number;
  /** The episodes, from "s01e04", "S01E01E02", "S01E01-E03" or "S01E01-03". Never episode 0 alone. */
  episodes?: number[];
  /** "2160p", "1080p", "720p", "576p", "480p"; none from a name that gives two ("720p/1080p"). */
  resolution?: string;
  source?: SourceFamily;
  /** The group that made the release, lower case; `yts` for YTS and YIFY. */
  group?: string;
  /** The name with its tags and separators taken out, for telling two equal names. */
  plain: string;
}

/** The video playing, as its names and its id say. */
export interface VideoRelease {
  filename?: string;
  title?: string;
  /** The season and episode playing, from the video's id; a film has none. */
  season?: number;
  episode?: number;
}

/** What matching reads of a subtitle file: its names, and what its addon says of it. */
export interface MatchedFile {
  /** The name the addon gives the file: its file name, or the release it matches. */
  label?: string;
  /** A second release name, for matching only (OpenSubtitles' release name). */
  releaseName?: string;
  /** The addon found the file by the video's hash: someone linked it to this very file. */
  hashMatch?: boolean;
  season?: number;
  episode?: number;
}

const EPISODE =
  /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})((?:[ ._]?-?[ ._]?e\d{1,3}|-\d{1,3}(?![0-9a-z]))*)(?![0-9])/;
const CROSS_EPISODE = /(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?![a-z0-9])/;
const SEASON_PACK = /(?:^|[^a-z0-9])s(\d{1,2})(?![a-z0-9])/;

/** "e02e03", "-e03" or "-03" after the first episode: the others, a dash making a range. */
function moreEpisodes(first: number, rest: string): number[] {
  const episodes = [first];
  const re = /(-?)[ ._]?e?(\d{1,3})/g;
  for (let found = re.exec(rest); found; found = re.exec(rest)) {
    const next = Number(found[2]);
    const last = episodes[episodes.length - 1]!;
    if (found[1] && next > last && next - last <= 30) {
      for (let n = last + 1; n <= next; n++) episodes.push(n);
    } else episodes.push(next);
  }
  return episodes;
}

/** Each word on its own, between separators. */
const word = (pattern: string) => new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?![a-z0-9])`);

// The web's own words (WEB-DL, WEBRip, a service's tag) before a copy made in the cinema
// (camcorder, telesync, telecine, screener: each timed its own way), so "The.TS.Madison…
// WEB-DL" is from the web; "web" alone last, as it is also a word in titles.
const SOURCES: ReadonlyArray<readonly [SourceFamily, RegExp]> = [
  ['bluray', /blu[ ._-]?ray|b[dr][ ._-]?(?:rip|remux)|(?:^|[^a-z0-9])remux(?![a-z0-9])/],
  ['hdtv', word('hdtv|pdtv')],
  ['dvd', word('dvd(?:rip|r|5|9)?')],
  ['web', word('web[ ._-]?(?:dl|rip)|amzn|nf|dsnp|hmax|atvp')],
  ['cam', word('(?:hd|hq)?[ ._-]?cam(?:rip)?')],
  ['ts', word('(?:hd[ ._-]?)?(?:ts|telesync|tsrip)')],
  ['tc', word('(?:hd[ ._-]?)?(?:tc|telecine)')],
  ['scr', word('(?:dvd|bd|web)?[ ._-]?(?:scr|screener)')],
  ['web', word('web')],
];

function features(name: string): ReleaseFeatures {
  const tags = readNameTags(name);
  const words = tags.release.toLowerCase();
  const found: ReleaseFeatures = { plain: words.replace(/[^a-z0-9]+/g, ' ').trim() };

  const episode = EPISODE.exec(words);
  const cross = episode ? null : CROSS_EPISODE.exec(words);
  if (episode) {
    found.season = Number(episode[1]);
    const episodes = moreEpisodes(Number(episode[2]), episode[3] ?? '');
    // "S01E00" alone is a name cut short ("S01E0") or the start of a range read no further:
    // no episode.
    if (episodes.length > 1 || episodes[0] !== 0) found.episodes = episodes;
  } else if (cross) {
    found.season = Number(cross[1]);
    found.episodes = [Number(cross[2])];
  } else {
    const pack = SEASON_PACK.exec(words);
    if (pack) found.season = Number(pack[1]);
  }

  const resolutions = new Set<string>();
  const re = /(?:^|[^a-z0-9])(2160|1080|720|576|480)[pi](?![a-z0-9])/g;
  for (let res = re.exec(words); res; res = re.exec(words)) resolutions.add(`${res[1]}p`);
  if (resolutions.size === 0 && /(?:^|[^a-z0-9])(?:4k|uhd)(?![a-z0-9])/.test(words)) {
    resolutions.add('2160p');
  }
  // "WEBRip.720p/1080p" names two releases: it says neither.
  if (resolutions.size === 1) found.resolution = Array.from(resolutions)[0];

  for (const [family, pattern] of SOURCES) {
    if (!pattern.test(words)) continue;
    found.source = family;
    break;
  }

  const group = isYtsRelease(name) ? 'yts' : releaseGroup(tags.release);
  if (group) found.group = group;
  return found;
}

/** The video's features: its file name first, its title filling the gaps. */
function videoFeatures(video: VideoRelease): ReleaseFeatures {
  const fromTitle = video.title ? features(video.title) : { plain: '' };
  const fromFile = video.filename ? features(video.filename) : { plain: '' };
  return { ...fromTitle, ...fromFile };
}

const episodeKey = (found: ReleaseFeatures) =>
  found.episodes ? `${found.season}:${found.episodes.join(',')}` : undefined;

/**
 * How a subtitle file's names match the video playing, best first:
 * `exact`, the same release name, which gives a group or agrees on at least
 * two facts; `group`, the same group and at least one more fact; `loose`, at
 * least two facts (episode, resolution, family of source) but no group on
 * both sides to confirm it, so the file may be another service's or another
 * group's; undefined, no match. Every fact the file's names and the video's
 * both give must agree.
 */
export type ReleaseMatch = 'exact' | 'group' | 'loose';

/**
 * What a file's names say of its release: its own name first, the second
 * release name its addon sends (OpenSubtitles' `movieReleaseName`) filling
 * only what that leaves out. So a fact its own name gives against the video
 * ("…1080p…-NTb.ita.srt" on a 720p stream) is never outweighed by a second
 * name that leaves it out ("AMZN.WEB-DL.DDP5.1.H.264-NTb").
 */
function fileFeatures(file: Pick<MatchedFile, 'label' | 'releaseName'>): {
  facts: ReleaseFeatures;
  names: ReleaseFeatures[];
} {
  const names = [file.label, file.releaseName]
    .filter((name): name is string => !!name)
    .map(features);
  const [own, second] = names;
  return { facts: { ...second, ...own, plain: own?.plain ?? '' }, names };
}

/**
 * How many facts (episode, resolution, family of source, group) a file and
 * the video both give and agree on; undefined when one of them differs.
 */
function agreeing(sub: ReleaseFeatures, vid: ReleaseFeatures): number | undefined {
  const facts: Array<[string | undefined, string | undefined]> = [
    [episodeKey(sub), episodeKey(vid)],
    [sub.resolution, vid.resolution],
    [sub.source, vid.source],
    [sub.group, vid.group],
  ];
  let agree = 0;
  for (const [a, b] of facts) {
    if (a === undefined || b === undefined) continue;
    if (a !== b) return undefined;
    agree++;
  }
  return agree;
}

/**
 * How a subtitle file's names match the video playing (`ReleaseMatch`): its
 * own name, with the second release name its addon sends filling what that
 * leaves out (`fileFeatures`). A best guess from the names.
 */
export function fileReleaseMatch(
  file: Pick<MatchedFile, 'label' | 'releaseName'>,
  video: VideoRelease,
): ReleaseMatch | undefined {
  const { facts, names } = fileFeatures(file);
  if (names.length === 0) return undefined;
  const vid = videoFeatures(video);
  const agree = agreeing(facts, vid);
  if (agree === undefined) return undefined;
  // One of its names is the video's file name or title, once both are read past their tags,
  // and that name gives the group or two facts: "Dune.Part.Two.2024.4K" says only the
  // resolution, and "Inception" nothing.
  const videoNames = [video.filename, video.title]
    .filter((name): name is string => !!name)
    .map((name) => features(name).plain);
  const same = names.some(
    (name) => !!name.plain && videoNames.indexOf(name.plain) !== -1 && (!!name.group || agree >= 2),
  );
  if (same) return 'exact';
  if (agree < 2) return undefined;
  return facts.group !== undefined && vid.group !== undefined ? 'group' : 'loose';
}

/** Whether a subtitle file's release name matches the video playing, however loosely. */
export function releaseMatch(subtitleName: string | undefined, video: VideoRelease): boolean {
  return fileReleaseMatch({ label: subtitleName }, video) !== undefined;
}

/**
 * Whether its addon found the file by the video's hash and its names do not
 * say it is another release: OpenSubtitles links many files to one hash, some
 * made for another source, group or episode ("…DVDRip.XviD-REWARD" on an
 * HDTV file of LOL's), and those count as a loose match at most.
 */
export function linkedToVideo(file: MatchedFile, video: VideoRelease): boolean {
  return !!file.hashMatch && agreeing(fileFeatures(file).facts, videoFeatures(video)) !== undefined;
}

/**
 * Whether a file is made for the release playing, so it may show at once:
 * its name matches the video's with the group confirming it (or is the very
 * same name, saying enough), or its addon found it by the video's hash and
 * its names do not say otherwise (`linkedToVideo`). A loose match on the
 * episode and resolution alone is not enough: another group's or another
 * service's file says as much.
 */
export function madeForRelease(file: MatchedFile, video: VideoRelease): boolean {
  const match = fileReleaseMatch(file, video);
  return match === 'exact' || match === 'group' || linkedToVideo(file, video);
}

/**
 * Whether a file is for another episode than the one playing, or another
 * season: by the season and episode its addon gives, or by its own name. Its
 * second release name counts only when neither says anything: OpenSubtitles'
 * is often cut short ("Fallout.2024.S01E0"), a whole season's
 * ("S01E00-10"), or another season's by mistake. Never for a film, nor when
 * neither side says.
 */
export function otherEpisode(file: MatchedFile, video: VideoRelease): boolean {
  const named = videoFeatures(video);
  const season = video.season ?? named.season;
  const episodes = video.episode !== undefined ? [video.episode] : named.episodes;
  if (season === undefined && episodes === undefined) return false;
  const claims: Array<{ season?: number; episodes?: number[] }> = [];
  if (file.season !== undefined || file.episode !== undefined) {
    claims.push({
      ...(file.season !== undefined && { season: file.season }),
      ...(file.episode !== undefined && { episodes: [file.episode] }),
    });
  }
  if (file.label) claims.push(features(file.label));
  const says = (claim: { season?: number; episodes?: number[] }) =>
    claim.season !== undefined || claim.episodes !== undefined;
  if (!claims.some(says) && file.releaseName) claims.push(features(file.releaseName));
  return claims.some(
    (claim) =>
      (claim.season !== undefined && season !== undefined && claim.season !== season) ||
      (claim.episodes !== undefined &&
        episodes !== undefined &&
        !claim.episodes.some((episode) => episodes.indexOf(episode) !== -1)),
  );
}

/**
 * Which disc of a release split in two or more the file goes with, by its
 * name ("CD1", "cd.2", "Disc 1", "Part 1 of 2"): it covers only part of the
 * video. Undefined for a whole file, and for one whose disc the video's own
 * name gives too: then it is that disc's file.
 */
export function discPart(
  file: Pick<MatchedFile, 'label'>,
  video: VideoRelease,
): number | undefined {
  const part = file.label ? readNameTags(file.label).part : undefined;
  if (part === undefined) return undefined;
  for (const name of [video.filename, video.title]) {
    if (name && readNameTags(name).part === part) return undefined;
  }
  return part;
}

/** Whether a name says the file is for the hard of hearing: HI, SDH or CC. */
export function hearingName(name: string | undefined): boolean {
  return !!name && readNameTags(name).hearing;
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
