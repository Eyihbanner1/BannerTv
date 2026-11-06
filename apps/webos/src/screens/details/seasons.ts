import { isUnmarked, MIN_RESUME_SECONDS, nextVideo, type ProgressEntry } from '@bannertv/core';
import type { MetaDetail, Video } from '@bannertv/protocol';

export interface Season {
  /** Null for videos without season numbers, such as a channel's uploads. */
  number: number | null;
  videos: Video[];
}

function byEpisode(a: Video, b: Video): number {
  const episode = (a.episode ?? Infinity) - (b.episode ?? Infinity);
  if (episode !== 0 && !isNaN(episode)) return episode;
  return (a.released ?? '').localeCompare(b.released ?? '');
}

/**
 * Splits a series' videos into seasons in order, with Specials (season 0)
 * last, as TV apps list them. Videos without a season go in one unnumbered
 * group at the end.
 */
export function groupSeasons(videos: readonly Video[]): Season[] {
  const groups = new Map<number | null, Video[]>();
  for (const video of videos) {
    const number = video.season ?? null;
    const group = groups.get(number);
    if (group) group.push(video);
    else groups.set(number, [video]);
  }
  const rank = (n: number | null) => (n === null ? Infinity : n === 0 ? 1e9 : n);
  return Array.from(groups.keys())
    .sort((a, b) => rank(a) - rank(b))
    .map((number) => ({ number, videos: groups.get(number)!.sort(byEpisode) }));
}

/** Season 1 when there is one, otherwise the first listed. */
export function defaultSeason(seasons: readonly Season[]): number {
  const first = seasons.findIndex((season) => season.number !== null && season.number >= 1);
  return first === -1 ? 0 : first;
}

/** The season holding the video, or the default one when it is not listed. */
export function seasonOf(seasons: readonly Season[], videoId: string): number {
  const found = seasons.findIndex((season) => season.videos.some((video) => video.id === videoId));
  return found === -1 ? defaultSeason(seasons) : found;
}

export type EpisodeState =
  | { kind: 'upcoming' }
  | { kind: 'watched' }
  | { kind: 'started'; fraction: number; secondsLeft: number }
  | { kind: 'new' };

/**
 * Where the viewer is with an episode, as the episode lists show it: not out
 * yet (an undated or unreadable date counts as out), watched here or on
 * Trakt, part watched, or not started.
 */
export function episodeState(
  video: Video,
  seen: ProgressEntry | undefined,
  watched: boolean,
  now: number,
): EpisodeState {
  if (video.released !== undefined && Date.parse(video.released) > now) return { kind: 'upcoming' };
  // Marked not watched here outranks Trakt's tick.
  if (seen?.watched === true || (watched && !isUnmarked(seen))) return { kind: 'watched' };
  if (seen && seen.duration > 0 && seen.position > 0) {
    return {
      kind: 'started',
      fraction: Math.min(1, seen.position / seen.duration),
      secondsLeft: Math.max(0, seen.duration - seen.position),
    };
  }
  return { kind: 'new' };
}

/**
 * Where a series' page sends the viewer: back into the episode left part-way
 * (`resume`), the episode stopped in its first seconds again from the start
 * (`again`), the next aired episode after a finished one (`next`), or, with
 * nothing played here, the first aired episode (`first`). With nothing
 * played here but episodes Trakt ticks as watched, `next` is the episode
 * after the furthest ticked one. Undefined when the viewer is caught up, the
 * next episode has not aired, or the episode played is not listed.
 */
export type StartPoint =
  | { kind: 'resume'; video: Video; at: number }
  | { kind: 'again'; video: Video }
  | { kind: 'next'; video: Video }
  | { kind: 'first'; video: Video };

export interface StartReader {
  /** The title's latest progress, if any. */
  latest: ProgressEntry | undefined;
  resumeAt: (videoId: string) => number | undefined;
  /** Trakt's watched ticks. */
  ticked: (videoId: string) => boolean;
}

/**
 * The reader a series' page uses: the latest progress that says where the
 * viewer is up to (an episode marked not watched does not), and Trakt's ticks
 * less those marked not watched here.
 */
export function startReader(
  progress: {
    forMeta(metaId: string): readonly ProgressEntry[];
    get(videoId: string): ProgressEntry | undefined;
    resumeAt(videoId: string): number | undefined;
  },
  ticks: { has(videoId: string): boolean },
  metaId: string,
): StartReader {
  return {
    latest: progress.forMeta(metaId).find((entry) => !isUnmarked(entry)),
    resumeAt: (videoId) => progress.resumeAt(videoId),
    ticked: (videoId) => ticks.has(videoId) && !isUnmarked(progress.get(videoId)),
  };
}

/** Out by `now`: an undated or unreadable date counts as out. */
export function aired(video: Video, now: number): boolean {
  return episodeState(video, undefined, false, now).kind !== 'upcoming';
}

/** What marking offers for an episode held on a series' page. */
export interface MarkOffer {
  /** The episode is watched: it is offered as not watched. */
  watched: boolean;
  /** The season's episodes that are out, which Mark season marks. */
  out: Video[];
  /** All of those are watched: the season is offered as not watched. */
  allWatched: boolean;
  /** The season's number, when it can be marked: a numbered season with more than one out. */
  season: number | undefined;
}

export function markOffer(
  video: Video,
  season: Season,
  isWatched: (videoId: string) => boolean,
  now: number,
): MarkOffer {
  const out = season.videos.filter((episode) => aired(episode, now));
  const markable = season.number !== null && season.number > 0 && out.length > 1;
  return {
    watched: isWatched(video.id),
    out,
    allWatched: out.length > 0 && out.every((episode) => isWatched(episode.id)),
    season: markable ? season.number! : undefined,
  };
}

/** The ticked regular episode furthest into the series, by season then episode. */
function furthestTicked(seasons: readonly Season[], ticked: (videoId: string) => boolean) {
  let furthest: Video | undefined;
  for (const season of seasons) {
    // Specials and unnumbered videos sit apart from the story.
    if (season.number === null || season.number === 0) continue;
    for (const video of season.videos) if (ticked(video.id)) furthest = video;
  }
  return furthest;
}

export function startPoint(
  meta: MetaDetail,
  seasons: readonly Season[],
  reader: StartReader,
  now: number,
): StartPoint | undefined {
  const { latest } = reader;
  if (latest) {
    const video = meta.videos.find((candidate) => candidate.id === latest.videoId);
    if (!video) return undefined;
    const at = reader.resumeAt(video.id);
    if (at !== undefined) return { kind: 'resume', video, at };
    // Stopped in its first seconds: it starts again, as Continue Watching has it.
    if (!latest.watched && latest.position < MIN_RESUME_SECONDS) return { kind: 'again', video };
    const next = nextVideo(meta, video.id, now);
    return next ? { kind: 'next', video: next } : undefined;
  }
  const ticked = furthestTicked(seasons, reader.ticked);
  if (ticked) {
    const next = nextVideo(meta, ticked.id, now);
    return next ? { kind: 'next', video: next } : undefined;
  }
  // An announced series has nothing to play yet.
  const first = seasons[0]?.videos[0];
  return first && aired(first, now) ? { kind: 'first', video: first } : undefined;
}

/**
 * The season a series' page opens on, and the episode in it that focus goes
 * to: where the viewer starts, else the last episode played or ticked (a
 * caught-up viewer sees where they got to), else Season 1's first.
 */
export function openingEpisode(
  seasons: readonly Season[],
  point: StartPoint | undefined,
  reader: StartReader,
): { season: number; index: number } {
  const target =
    point?.video.id ?? reader.latest?.videoId ?? furthestTicked(seasons, reader.ticked)?.id;
  if (target !== undefined) {
    for (let season = 0; season < seasons.length; season++) {
      const index = seasons[season]!.videos.findIndex((video) => video.id === target);
      if (index !== -1) return { season, index };
    }
  }
  return { season: defaultSeason(seasons), index: 0 };
}
