import { isUnmarked, playedCard, type ProgressMark, type TraktMark } from '@bannertv/core';
import type { ContentType, MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { watchedSet } from './library';
import { playedVideos, progress } from './playback';
import { forgetPausedOnTrakt, markOnTrakt } from './trakt';

/** The id and type a title's progress is kept under, which an addon's answer may not repeat. */
export interface TitleRoute {
  metaId: string;
  type: ContentType;
}

/** Watched here, or ticked on Trakt and not marked not watched here since. */
export function isWatched(videoId: string): boolean {
  const own = progress.get(videoId);
  return own?.watched === true || (watchedSet.has(videoId) && !isUnmarked(own));
}

/** The most episodes one Mark season takes: a long anime season would push out other progress. */
export const MAX_SEASON_MARKS = 100;

/**
 * Marks a series' episodes watched or not watched (Hold OK on an episode, a
 * long press on the phone), in the order given, the last as the most recent.
 * Marked watched, the last gets a card from the title's page, so Continue
 * Watching offers the episode after it and History lists it. Trakt's history
 * follows when the profile is signed in there.
 */
export function markEpisodes(
  route: TitleRoute,
  meta: MetaDetail,
  videos: readonly Video[],
  watched: boolean,
): void {
  const chosen = videos.slice(-MAX_SEASON_MARKS);
  if (chosen.length === 0) return;
  const marks: ProgressMark[] = chosen.map((video) => ({ ...route, videoId: video.id }));
  const last = chosen[chosen.length - 1]!;
  // Earlier episodes marked watched leave the viewer where they are up to.
  const spot = progress.forMeta(route.metaId).find((entry) => !isUnmarked(entry));
  const spotVideo = spot && meta.videos.find((video) => video.id === spot.videoId);
  const keep =
    watched && spotVideo && !chosen.includes(spotVideo) && comesAfter(spotVideo, last)
      ? spotVideo.id
      : undefined;
  progress.mark(marks, watched, keep);
  if (watched && !keep) playedVideos.record(playedCard(meta, last.id, meta, route));
  markOnTrakt(
    chosen.map((video): TraktMark => {
      const mark: TraktMark = { metaId: route.metaId, type: route.type };
      if (video.season !== undefined) mark.season = video.season;
      if (video.episode !== undefined) mark.episode = video.episode;
      const at = progress.get(video.id)?.updatedAt;
      if (watched && at !== undefined) mark.watchedAt = at;
      return mark;
    }),
    watched,
  );
}

/** Whether `a` is a later episode than `b`, in the regular seasons. */
function comesAfter(a: Video, b: Video): boolean {
  if (!a.season || !b.season || a.episode === undefined || b.episode === undefined) return false;
  return a.season > b.season || (a.season === b.season && a.episode > b.episode);
}

/** Marks a film (or a title played as one video) watched or not watched, as markEpisodes. */
export function markFilm(
  route: TitleRoute,
  item: MetaPreview,
  meta: MetaDetail | undefined,
  videoId: string,
  watched: boolean,
): void {
  progress.mark([{ ...route, videoId }], watched);
  if (watched) playedVideos.record(playedCard(item, videoId, meta, route));
  const mark: TraktMark = { metaId: route.metaId, type: route.type };
  const at = progress.get(videoId)?.updatedAt;
  if (watched && at !== undefined) mark.watchedAt = at;
  markOnTrakt([mark], watched);
}

/**
 * Takes a title off Continue Watching until it plays again, here and, through
 * the account, on the profile's other screens; off Trakt's paused list too
 * when signed in there.
 */
export function leaveContinueWatching(route: TitleRoute): void {
  if (progress.leaveRow(route.metaId)) forgetPausedOnTrakt(route.metaId, route.type);
}
