import type { Video } from '@bannertv/protocol';

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
