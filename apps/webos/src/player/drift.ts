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

/** What the drift fix of the file showing is worked out from. */
export interface DriftFile {
  /** Whether a drift fix applies to it. */
  canFix: boolean;
  /** The drift its length gives away on the stream playing, if any. */
  evidence: SubtitleDrift | null;
  /** The drift choice kept for the file, if any. */
  kept: DriftChoice | null;
  /** The timing kept for the file, in seconds. */
  offset: number;
}

/**
 * The drift fix for the file showing: the viewer's own when they chose one
 * for it ('none' is no fix); the one the stream playing gives away when the
 * player's own fix was kept with their timing ('auto'); else the one its
 * length gives away (`evidence`), made by the player, unless a timing was set
 * on the file with no drift choice kept beside it (an older build's, set
 * against lines it did not stretch: theirs stands). None where a drift fix
 * does not apply (`canFix`).
 */
export function driftInUse(file: DriftFile): DriftInUse {
  if (!file.canFix) return { drift: null, auto: false };
  // Worked out from this stream: a drift belongs to the file and the release together.
  if (file.kept === 'auto') return { drift: file.evidence, auto: file.evidence !== null };
  if (file.kept !== null) return { drift: file.kept === 'none' ? null : file.kept, auto: false };
  if (file.evidence !== null && file.offset === 0) return { drift: file.evidence, auto: true };
  return { drift: null, auto: false };
}

/**
 * What to keep as the viewer moves the timing of the file to `offset`:
 * 'auto' where they have made no drift choice for it and its lines show as
 * the stream's own evidence has them (the player's fix on, or no fix to
 * make). The fix is then worked out again on every stream with their timing:
 * the lines they move stay stretched as they see them, a release the file
 * fits as it is gets no stretch, and one whose length shows a drift still
 * gets the player's fix. Not a fixed drift. Null when there is nothing to
 * keep: a drift choice of their own stands, and so do lines an older build's
 * timing left unstretched.
 */
export function driftKeptWithTiming(file: DriftFile, offset: number): 'auto' | null {
  if (!file.canFix || offset === 0 || file.kept !== null) return null;
  return driftInUse(file).auto || file.evidence === null ? 'auto' : null;
}
