import type { MetaDetail, Stream, Video } from '@bannertv/protocol';
import type { StreamEntry } from '../streams/types';

type Episode = Video & { season: number; episode: number };

function isEpisode(video: Video): video is Episode {
  return video.season !== undefined && video.episode !== undefined;
}

/** Some addons list a video twice; the first copy is the one shown. */
function uniqueById(videos: readonly Video[]): Video[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

/** Infinity when the date is missing or unreadable, so undated copies sort after dated ones. */
function releaseTime(video: Video): number {
  const time = video.released === undefined ? NaN : Date.parse(video.released);
  return Number.isNaN(time) ? Infinity : time;
}

/** Undated videos count as aired: many addons leave the date out of old episodes. */
function hasAired(video: Video, now: number): boolean {
  const time = releaseTime(video);
  return time === Infinity || time <= now;
}

/**
 * Specials (season 0) sit apart from the story, so a special leads to the
 * next special and a regular episode to the next regular one, across seasons.
 * Two entries for the same season and episode are one episode.
 */
function episodeAfter(videos: readonly Video[], current: Episode): Video | undefined {
  const specials = current.season === 0;
  // Chromium 68 does not sort stably, so the original order is the last key, by hand.
  const episodes = videos
    .map((video, index) => ({ video, index }))
    .filter((item): item is { video: Episode; index: number } => {
      return isEpisode(item.video) && (item.video.season === 0) === specials;
    })
    .sort(
      (a, b) =>
        a.video.season - b.video.season ||
        a.video.episode - b.video.episode ||
        releaseTime(a.video) - releaseTime(b.video) ||
        a.index - b.index,
    )
    .map(({ video }) => video);
  return episodes
    .slice(episodes.indexOf(current) + 1)
    .find((video) => video.season !== current.season || video.episode !== current.episode);
}

/**
 * The episode after `videoId` in a series: by season, then episode, staying
 * among specials (season 0) or among regular seasons, and skipping episodes
 * that have not aired by `now` (milliseconds). Undefined at the end.
 *
 * An unaired next episode gives undefined rather than the one after it, so
 * autoplay never jumps over an episode. Videos without season and episode
 * numbers follow the order the addon listed them in.
 */
export function nextVideo(meta: MetaDetail, videoId: string, now: number): Video | undefined {
  const videos = uniqueById(meta.videos);
  const index = videos.findIndex((video) => video.id === videoId);
  const current = videos[index];
  if (!current) return undefined;
  const next = isEpisode(current) ? episodeAfter(videos, current) : videos[index + 1];
  return next && hasAired(next, now) ? next : undefined;
}

/** Whether a stream is in the binge group and the player can play it by itself. */
function inBingeGroup(stream: Stream, bingeGroup: string): boolean {
  return (
    stream.source.kind === 'url' &&
    stream.behaviorHints.bingeGroup === bingeGroup &&
    stream.behaviorHints.proxyHeaders === undefined
  );
}

/**
 * The first playable stream in the same binge group, for playing the next episode straight on.
 * Streams that need proxy headers are left out because the `<video>` element cannot send them.
 */
export function findBingeStream(
  streams: readonly Stream[],
  bingeGroup: string | undefined,
): Stream | undefined {
  if (!bingeGroup) return undefined;
  return streams.find((stream) => inBingeGroup(stream, bingeGroup));
}

/**
 * The release to carry on with into another episode: the addon that sent the
 * playing stream and the binge group it named. Only these two names, never a
 * link, so it can travel in a route.
 */
export interface BingeHint {
  /** The addon's manifest id. */
  addonId: string;
  /** The addon's name for the release, such as "torrentio|1080p|WEB-DL". */
  bingeGroup?: string;
  /**
   * The release group, such as "FLUX", for a release remembered for the
   * title (ReleaseMemory): found by it when the binge group is not there.
   */
  releaseGroup?: string;
}

/**
 * The hint for the stream playing now. Undefined when there is no stream, or
 * it names no binge group: then there is no release to carry on with.
 */
export function bingeHint(entry: StreamEntry | null | undefined): BingeHint | undefined {
  const bingeGroup = entry?.stream.behaviorHints.bingeGroup;
  return entry && bingeGroup ? { addonId: entry.addonId, bingeGroup } : undefined;
}

/**
 * The same addon's stream of the same release, as Stremio's binge watching
 * picks it: the first, in the order given, that the player can play. Streams
 * that can't play are passed over, so one first in the group does not hide
 * another that can. A hint with a release group (a release remembered for
 * the title) falls back to the addon's first playable stream from that
 * group. Undefined when the hint names neither or the release is not there;
 * the caller then picks as it would for any video, never another of the
 * addon's releases.
 */
export function bingeEntry(
  entries: readonly StreamEntry[],
  hint: BingeHint,
): StreamEntry | undefined {
  const { addonId, bingeGroup, releaseGroup } = hint;
  const playable = (entry: StreamEntry) =>
    entry.addonId === addonId && entry.assessment.action.kind === 'play';
  const byGroup = bingeGroup
    ? entries.find((entry) => playable(entry) && inBingeGroup(entry.stream, bingeGroup))
    : undefined;
  if (byGroup || !releaseGroup) return byGroup;
  const group = releaseGroup.toLowerCase();
  return entries.find(
    (entry) =>
      playable(entry) &&
      entry.stream.source.kind === 'url' &&
      entry.stream.behaviorHints.proxyHeaders === undefined &&
      entry.facts.releaseGroup?.toLowerCase() === group,
  );
}
