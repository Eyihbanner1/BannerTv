import type { Cue, DriftChoice, SubtitleDrift } from '@bannertv/core';

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

/** The drift fix in use on the file showing, and whether the player made it by itself. */
export interface DriftInUse {
  drift: SubtitleDrift | null;
  /** Made by the player, from the file's length: the viewer chose none. */
  auto: boolean;
}

/**
 * The drift fix for the file showing: the viewer's own when they chose one
 * for it ('none' is no fix); else the one its length gives away (`evidence`),
 * made by the player, unless the viewer set a timing on the file before
 * (theirs stands). None where a drift fix does not apply (`canFix`).
 */
export function driftInUse(file: {
  canFix: boolean;
  evidence: SubtitleDrift | null;
  kept: DriftChoice | null;
  offset: number;
}): DriftInUse {
  if (!file.canFix) return { drift: null, auto: false };
  if (file.kept !== null) return { drift: file.kept === 'none' ? null : file.kept, auto: false };
  if (file.evidence !== null && file.offset === 0) return { drift: file.evidence, auto: true };
  return { drift: null, auto: false };
}

/**
 * The drift fix to keep as the viewer's own as they move the timing to
 * `offset`: the one the player made, so the lines they move stay stretched
 * as they see them, now and next time. Null when there is none to keep.
 */
export function driftKeptWithTiming(inUse: DriftInUse, offset: number): SubtitleDrift | null {
  return inUse.auto && offset !== 0 ? inUse.drift : null;
}
