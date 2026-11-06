import type { Cue, SubtitleDrift } from '@bannertv/core';

/*
 * Subtitles that slide further out of step as the film goes on were timed
 * for a release at another frame rate: a PAL (25 fps) file on a film-speed
 * (23.976 fps) video runs about 4% fast, so by the end of a two-hour film it
 * is nearly five minutes ahead. A fixed timing cannot fix that; a drift fix
 * stretches the file's clock to the video's.
 *
 * The fixes chosen are kept per file by the core's `createSubtitleDrifts`.
 */
export {
  createSubtitleDrifts,
  MAX_SUBTITLE_DRIFTS,
  SUBTITLE_DRIFTS,
  type SubtitleDrift,
  type SubtitleDrifts,
} from '@bannertv/core';

const FILM_FPS = 24000 / 1001;
const PAL_FPS = 25;

/** The file's seconds for one second of the video. */
export const DRIFT_RATES: Readonly<Record<SubtitleDrift, number>> = {
  ahead: FILM_FPS / PAL_FPS,
  behind: PAL_FPS / FILM_FPS,
};

/**
 * The cues moved onto the video's clock: a line the file times at t shows at
 * t / rate. The same array when there is no drift fix, so nothing redraws.
 */
export function stretchCues(cues: readonly Cue[], drift: SubtitleDrift | null): readonly Cue[] {
  if (drift === null) return cues;
  const rate = DRIFT_RATES[drift];
  return cues.map((cue) => ({ ...cue, start: cue.start / rate, end: cue.end / rate }));
}
