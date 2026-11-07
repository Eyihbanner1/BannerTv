import { explainProblem, type PlayAttempt, type ProblemExplained } from '@bannertv/core';
import { streamAddons } from '../data/addons';
import { entryKey, type FinderState } from './finder';
import type { SessionState } from './session';

/**
 * Why Play stopped, for the problem box on the TV and the phone. `nothing`:
 * no stream could even start. Otherwise the streams the session tried since
 * anything last played, and why each stopped.
 */
export function playProblem(
  nothing: boolean,
  finder: FinderState,
  session: Pick<SessionState, 'attempts' | 'entry' | 'error'>,
): ProblemExplained {
  let attempts: readonly PlayAttempt[] = session.attempts;
  // A failure the session did not list (it always should): the stream playing and its error.
  if (!nothing && attempts.length === 0 && session.entry && session.error) {
    attempts = [{ key: entryKey(session.entry), entry: session.entry, kind: session.error.kind }];
  }
  return explainProblem({
    nothing,
    asked: finder.asked,
    failedAddons: finder.failed.length,
    entries: finder.entries,
    candidates: finder.candidates,
    attempts,
    streamAddons: streamAddons(),
  });
}
