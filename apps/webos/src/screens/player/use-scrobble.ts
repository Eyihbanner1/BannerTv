import { createScrobbler, traktTarget } from '@bannertv/core';
import type { ContentType } from '@bannertv/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { syncTraktSoon, traktAccount, traktAvailable } from '../../data/trakt';
import type { PlaybackSession, SessionState } from '../../player/session';
import {
  createScrobblePlace,
  onClose,
  onSeen,
  onStatus,
  type Runtimes,
  type Sent,
} from './scrobble-progress';

/** The title's running times as they are now, read from inside an effect. */
function runtimesOf(
  runtime: { readonly current: () => number },
  knownRuntime: { readonly current: () => number | undefined },
): Runtimes {
  return { runtimeSeconds: runtime.current(), knownRuntimeSeconds: knownRuntime.current() };
}

/**
 * Tells Trakt what plays: start when the video plays, pause when it is
 * paused, and stop when it ends or the player closes, which Trakt counts as
 * watched from 80% on. Closed in the end credits (`creditsAt`), it stops at
 * 100%: the episode was seen, as its saved progress says. Nothing for the
 * Lab, a live broadcast, a title Trakt cannot name, or a profile not signed
 * in. A clip of the video (one the viewer picked in Sources) starts nothing,
 * and a pause or close during one sends the place the last real file
 * reached, or nothing.
 */
export function useScrobble(
  session: PlaybackSession | null,
  state: SessionState,
  ids: { type: string; metaId: string; videoId: string; lab?: boolean },
  /** The title's running time, or a guess at it, in seconds. */
  runtimeSeconds: () => number,
  /** The running time the title's page gives, if it gives one. */
  knownRuntimeSeconds: () => number | undefined,
  /** Where the end credits start in the file playing, when IntroDB's mark fits it. */
  creditsAt?: number,
): void {
  const { type, metaId, videoId, lab } = ids;
  const runtime = useRef(runtimeSeconds);
  const knownRuntime = useRef(knownRuntimeSeconds);
  const credits = useRef(creditsAt);
  useEffect(() => {
    runtime.current = runtimeSeconds;
    knownRuntime.current = knownRuntimeSeconds;
    credits.current = creditsAt;
  });
  const scrobbler = useMemo(() => {
    if (lab || !traktAvailable()) return null;
    const target = traktTarget(type as ContentType, metaId, videoId);
    return target ? createScrobbler({ account: traktAccount, target }) : null;
  }, [lab, type, metaId, videoId]);
  // One per video, like the scrobbler: another episode starts with no place.
  const place = useMemo(() => createScrobblePlace(videoId), [videoId]);

  const sent = useRef<Sent>('none');
  const latest = useRef(state);
  /** Whether the file was taken for a clip when last seen. */
  const wasClip = useRef(false);
  // Where the player would open the next file, and the moves it has taken,
  // as they were when this state rendered: an effect may run later (after a
  // slow render, a move can come first), and must not pair this state with a
  // move made after it.
  const carryOn = session?.carryOn();
  const moves = session?.moves();
  useEffect(() => {
    latest.current = state;
    const runtimes = runtimesOf(runtime, knownRuntime);
    place.see(state, runtimes, carryOn, moves);
    // A file found to be the title as it plays starts now, its status unchanged.
    const seen = onSeen(sent.current, wasClip.current, state, place, runtimes);
    wasClip.current = seen.clip;
    if (!scrobbler) return;
    sent.current = seen.sent;
    if (seen.call) void scrobbler[seen.call.action](seen.call.percent);
  });

  const { status, live } = state;
  useEffect(() => {
    if (!scrobbler || live) return;
    const next = onStatus(sent.current, latest.current, place, runtimesOf(runtime, knownRuntime));
    sent.current = next.sent;
    if (next.call) void scrobbler[next.call.action](next.call.percent);
  }, [scrobbler, place, status, live]);

  // Closing the player, or another episode replacing it, stops at where it got to.
  useEffect(() => {
    if (!scrobbler || !session) return;
    return () => {
      const played = sent.current !== 'none';
      if (!latest.current.live) {
        const next = onClose(
          sent.current,
          latest.current,
          place,
          runtimesOf(runtime, knownRuntime),
        );
        sent.current = next.sent;
        // In the end credits of the file itself (never a clip): seen, as its saved progress says.
        const at = credits.current;
        const inCredits = at !== undefined && !latest.current.clip && latest.current.position >= at;
        if (next.call) void scrobbler.stop(inCredits ? 100 : next.call.percent);
      }
      if (played) syncTraktSoon();
    };
  }, [scrobbler, place, session]);
}
