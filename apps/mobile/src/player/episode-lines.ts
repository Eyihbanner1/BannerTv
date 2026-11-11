import type { ProgressEntry } from '@bannertv/core';
import type { Video } from '@bannertv/protocol';
import { episodeState } from '@tv/screens/details/seasons';

/** What an episode's row in the player's Episodes panel says under its name, as on the TV. */
export type EpisodeNote =
  | { kind: 'playing' }
  | { kind: 'upcoming'; released: string }
  | { kind: 'watched' }
  | { kind: 'started'; minutesLeft: number }
  | { kind: 'none' };

export interface EpisodeLine {
  video: Video;
  /** Its number: the addon's, else its place in the season. */
  number: number;
  note: EpisodeNote;
  /** A tap plays it, or for the one playing closes the panel. Not one that isn't out yet. */
  playable: boolean;
}

/**
 * One season's episodes as the player's Episodes panel lists them, as the TV's Episodes sheet
 * does: the one playing says so, then each says whether it is not out yet, watched (here or on
 * Trakt) or part watched, with the minutes left.
 */
export function episodeLines(
  videos: readonly Video[],
  playingId: string,
  progressOf: (videoId: string) => ProgressEntry | undefined,
  watched: (videoId: string) => boolean,
  now: number,
): EpisodeLine[] {
  return videos.map((video, index) => {
    const here = video.id === playingId;
    const state = episodeState(video, progressOf(video.id), watched(video.id), now);
    const note: EpisodeNote = here
      ? { kind: 'playing' }
      : state.kind === 'upcoming'
        ? { kind: 'upcoming', released: video.released ?? '' }
        : state.kind === 'watched'
          ? { kind: 'watched' }
          : state.kind === 'started'
            ? { kind: 'started', minutesLeft: Math.max(1, Math.round(state.secondsLeft / 60)) }
            : { kind: 'none' };
    return {
      video,
      number: video.episode ?? index + 1,
      note,
      playable: here || state.kind !== 'upcoming',
    };
  });
}
