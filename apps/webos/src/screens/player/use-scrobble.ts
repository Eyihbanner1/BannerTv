import { createScrobbler, traktTarget } from '@bannertv/core';
import type { ContentType } from '@bannertv/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { syncTraktSoon, traktAccount, traktAvailable } from '../../data/trakt';
import type { PlaybackSession, SessionState } from '../../player/session';
import { createScrobblePlace, type Runtimes } from './scrobble-progress';

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

  const sent = useRef<'none' | 'playing' | 'paused' | 'stopped'>('none');
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
    place.see(state, runtimesOf(runtime, knownRuntime));
  });

  const { status, live } = state;
  useEffect(() => {
    if (!scrobbler || live || sent.current === 'stopped') return;
    const now = latest.current;
    if (status === 'playing' && sent.current !== 'playing') {
      // A clip starts nothing: Trakt hears again from a real file.
      if (place.clip(now, runtimesOf(runtime, knownRuntime))) return;
      sent.current = 'playing';
      void scrobbler.start(place.now(now, runtimesOf(runtime, knownRuntime)) ?? 0);
    } else if (status === 'paused' && sent.current === 'playing') {
      const at = place.now(now, runtimesOf(runtime, knownRuntime));
      if (at === undefined) return;
      sent.current = 'paused';
      void scrobbler.pause(at);
    } else if (status === 'ended' && sent.current !== 'none') {
      sent.current = 'stopped';
      const at = place.end(now, runtimesOf(runtime, knownRuntime));
      if (at !== undefined) void scrobbler.stop(at);
    }
  }, [scrobbler, place, status, live]);

  // Closing the player, or another episode replacing it, stops at where it got to.
  useEffect(() => {
    if (!scrobbler || !session) return;
    return () => {
      const played = sent.current !== 'none';
      if (played && sent.current !== 'stopped' && !latest.current.live) {
        sent.current = 'stopped';
        const at = place.now(latest.current, runtimesOf(runtime, knownRuntime));
        if (at !== undefined) void scrobbler.stop(at);
      }
      if (played) syncTraktSoon();
    };
  }, [scrobbler, place, session]);
}
