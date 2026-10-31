import { createScrobbler, traktTarget } from '@bannertv/core';
import type { ContentType } from '@bannertv/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { syncTraktSoon, traktAccount, traktAvailable } from '../../data/trakt';
import type { PlaybackSession, SessionState } from '../../player/session';
import {
  createScrobblePlace,
  onClose,
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
 * watched from 80% on. Nothing for the Lab, a live broadcast, a title Trakt
 * cannot name, or a profile not signed in. A clip of the video (one the
 * viewer picked in Sources) starts nothing, and a pause or close during one
 * sends the place the last real file reached, or nothing.
 */
export function useScrobble(
  session: PlaybackSession | null,
  state: SessionState,
  ids: { type: string; metaId: string; videoId: string; lab?: boolean },
  /** The title's running time, or a guess at it, in seconds. */
  runtimeSeconds: () => number,
  /** The running time the title's page gives, if it gives one. */
  knownRuntimeSeconds: () => number | undefined,
): void {
  const { type, metaId, videoId, lab } = ids;
  const runtime = useRef(runtimeSeconds);
  const knownRuntime = useRef(knownRuntimeSeconds);
  useEffect(() => {
    runtime.current = runtimeSeconds;
    knownRuntime.current = knownRuntimeSeconds;
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
  useEffect(() => {
    latest.current = state;
    place.see(state, runtimesOf(runtime, knownRuntime));
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
        if (next.call) void scrobbler.stop(next.call.percent);
      }
      if (played) syncTraktSoon();
    };
  }, [scrobbler, place, session]);
}
