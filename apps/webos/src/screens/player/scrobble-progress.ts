import type { SessionState } from '../../player/session';

type Played = Pick<SessionState, 'position' | 'duration'>;

/** A file this short, of a title running at least CLIP_OF_S, is a clip or a sample. */
export const CLIP_MAX_S = 5 * 60;
export const CLIP_OF_S = 20 * 60;

/** A special (season 0) can be a short extra of a long series, and plays whole. */
export function isSpecial(videoId: string): boolean {
  return /:0:\d+$/.test(videoId);
}

/**
 * Whether the file is a clip of the title rather than the title, which ends
 * long before it would: the rule auto-play uses to pass such streams over.
 * It goes by the running time the title's page gives, never by a guess, and
 * never for a special.
 */
export function isClip(
  state: Played,
  knownRuntimeSeconds: number | undefined,
  videoId: string,
): boolean {
  return (
    knownRuntimeSeconds !== undefined &&
    knownRuntimeSeconds >= CLIP_OF_S &&
    state.duration > 0 &&
    state.duration < CLIP_MAX_S &&
    !isSpecial(videoId)
  );
}

/**
 * How far through, in percent. A file that gives no length is measured
 * against the title's running time (or a guess at it), as its saved progress
 * is, and so is a clip: played to its end, it must not tell Trakt the title
 * was watched.
 */
export function percent(state: Played, runtimeSeconds: number, clip: boolean): number {
  const length = state.duration > 0 && !clip ? state.duration : runtimeSeconds;
  return length > 0 ? (state.position / length) * 100 : 0;
}
