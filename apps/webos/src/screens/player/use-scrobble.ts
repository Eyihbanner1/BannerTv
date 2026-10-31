import { createScrobbler, traktTarget } from '@bannertv/core';
import type { ContentType } from '@bannertv/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { syncTraktSoon, traktAccount, traktAvailable } from '../../data/trakt';
import type { PlaybackSession, SessionState } from '../../player/session';
import { isClip, percent } from './scrobble-progress';

/**
 * Tells Trakt what plays: start when the video plays, pause when it is
 * paused, and stop when it ends or the player closes, which Trakt counts as
 * watched from 80% on. Nothing for the Lab, a live broadcast, a title Trakt
 * cannot name, or a profile not signed in.
 */
/** How far through the play is, and whether the file is a clip of the title. */
function scrobbled(
  now: SessionState,
  runtimeSeconds: number,
  knownRuntimeSeconds: number | undefined,
  videoId: string,
): { clip: boolean; percent: number } {
  const clip = isClip(now, knownRuntimeSeconds, videoId);
  return { clip, percent: percent(now, runtimeSeconds, clip) };
}

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

  const sent = useRef<'none' | 'playing' | 'paused' | 'stopped'>('none');
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const { status, live } = state;
  useEffect(() => {
    if (!scrobbler || live || sent.current === 'stopped') return;
    const now = latest.current;
    if (status === 'playing' && sent.current !== 'playing') {
      sent.current = 'playing';
      void scrobbler.start(
        scrobbled(now, runtime.current(), knownRuntime.current(), videoId).percent,
      );
    } else if (status === 'paused' && sent.current === 'playing') {
      sent.current = 'paused';
      void scrobbler.pause(
        scrobbled(now, runtime.current(), knownRuntime.current(), videoId).percent,
      );
    } else if (status === 'ended' && sent.current !== 'none') {
      sent.current = 'stopped';
      const played = scrobbled(now, runtime.current(), knownRuntime.current(), videoId);
      void scrobbler.stop(played.clip ? played.percent : 100);
    }
  }, [scrobbler, status, live, videoId]);

  // Closing the player, or another episode replacing it, stops at where it got to.
  useEffect(() => {
    if (!scrobbler || !session) return;
    return () => {
      const played = sent.current !== 'none';
      if (played && sent.current !== 'stopped' && !latest.current.live) {
        sent.current = 'stopped';
        void scrobbler.stop(
          scrobbled(latest.current, runtime.current(), knownRuntime.current(), videoId).percent,
        );
      }
      if (played) syncTraktSoon();
    };
  }, [scrobbler, session, videoId]);
}
