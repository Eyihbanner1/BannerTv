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

/**
 * A move the player makes on a file's lines once it has lined them up
 * against the video itself: a line the file times at t shows at
 * t / rate + offset.
 */
export interface LineMove {
  offset: number;
  rate: number;
}

/** The drift fix a move's rate is, where it is one of the two the Timing tab offers. */
export function driftOfRate(rate: number): SubtitleDrift | null {
  for (const drift of SUBTITLE_DRIFT_NAMES) {
    if (Math.abs(DRIFT_RATES[drift] - rate) < 1e-9) return drift;
  }
  return null;
}

const SUBTITLE_DRIFT_NAMES: readonly SubtitleDrift[] = ['ahead', 'behind'];

/** The drift fix in use on the file showing, and whether the player made it by itself. */
export interface DriftInUse {
  drift: SubtitleDrift | null;
  /** Made by the player, from the file's length or by lining it up: the viewer chose none. */
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
  /** The move the player made on its lines on this stream, having lined them up, if any. */
  aligned?: LineMove | null;
}

/**
 * Whether the viewer chose the file's drift fix themselves: a fix, or none
 * where the player had made one. Then nothing moves its lines by itself.
 */
export function viewersDrift(kept: DriftChoice | null): boolean {
  return kept === 'ahead' || kept === 'behind' || kept === 'none';
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
  if (file.kept === 'auto' || file.kept === 'aligned') {
    return { drift: file.evidence, auto: file.evidence !== null };
  }
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
 * gets the player's fix. Not a fixed drift. 'aligned' instead where the
 * player lined the file up on this stream: the timing is then set on its
 * move, and adds to the move on every stream where it is lined up. Null when
 * there is nothing to keep: a drift choice of their own stands, and so do
 * lines an older build's timing left unstretched.
 */
export function driftKeptWithTiming(file: DriftFile, offset: number): 'auto' | 'aligned' | null {
  if (!file.canFix || offset === 0 || viewersDrift(file.kept)) return null;
  // Set on lines the player lined up: it adds to the player's move, wherever the file is lined up.
  if (file.aligned) return 'aligned';
  // Set on the file's own lines now: no longer on top of a move.
  if (file.kept === 'aligned') return 'auto';
  if (file.kept !== null) return null;
  return driftInUse(file).auto || file.evidence === null ? 'auto' : null;
}

/** The timing in use on the file showing: the player's move, its drift fix, and the viewer's timing. */
export interface TimingInUse extends DriftInUse {
  /** The move the player made on the lines, having lined them up; the viewer's timing adds to it. */
  move: LineMove | null;
  /** The viewer's timing in use, in seconds: on top of the move, if any. */
  offset: number;
}

/**
 * The timing of the file showing. Lined up by the player on this stream
 * (`aligned`), its lines are moved and stretched as that found, unless the
 * viewer chose a drift fix for the file themselves: theirs stands, and so
 * does their timing. On a moved file the viewer's timing adds to the move
 * when it was set on lines the player had lined up ('aligned' kept beside
 * it); timing kept with no such mark was set on the file's own lines, on
 * another release or before the player lined it up, and is set aside rather
 * than added: the move already puts the lines where this video has them.
 * Not lined up, it is as `driftInUse` has it, with the timing kept.
 */
export function timingInUse(file: DriftFile): TimingInUse {
  if (file.canFix && file.aligned && !viewersDrift(file.kept)) {
    const drift = driftOfRate(file.aligned.rate);
    return {
      drift,
      auto: drift !== null,
      move: file.aligned,
      offset: file.kept === 'aligned' ? file.offset : 0,
    };
  }
  return { ...driftInUse(file), move: null, offset: file.offset };
}
