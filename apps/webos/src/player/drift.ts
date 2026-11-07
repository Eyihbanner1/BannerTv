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
 * for it ('none' is no fix); the one the stream playing gives away when the
 * player's own fix was kept with their timing ('auto'); else the one its
 * length gives away (`evidence`), made by the player, unless the viewer set
 * a timing on the file before (theirs stands). None where a drift fix does
 * not apply (`canFix`).
 */
export function driftInUse(file: {
  canFix: boolean;
  evidence: SubtitleDrift | null;
  kept: DriftChoice | null;
  offset: number;
}): DriftInUse {
  if (!file.canFix) return { drift: null, auto: false };
  // Worked out from this stream: a drift belongs to the file and the release together.
  if (file.kept === 'auto') return { drift: file.evidence, auto: file.evidence !== null };
  if (file.kept !== null) return { drift: file.kept === 'none' ? null : file.kept, auto: false };
  if (file.evidence !== null && file.offset === 0) return { drift: file.evidence, auto: true };
  return { drift: null, auto: false };
}

/**
 * What to keep as the viewer moves the timing to `offset`: 'auto' while the
 * player's own fix is on, so the lines they move stay stretched as they see
 * them, now and next time, as this stream's evidence says. Not a fixed drift:
 * on another release of the video, which the file may fit as it is, it is
 * worked out again. Null when there is none to keep.
 */
export function driftKeptWithTiming(inUse: DriftInUse, offset: number): 'auto' | null {
  return inUse.auto && offset !== 0 ? 'auto' : null;
}
