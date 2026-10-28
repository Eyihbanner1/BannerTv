import { createScrobbler, traktTarget } from '@bannertv/core';
import type { ContentType } from '@bannertv/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { syncTraktSoon, traktAccount, traktAvailable } from '../../data/trakt';
import type { PlaybackSession, SessionState } from '../../player/session';

function percent(state: SessionState): number {
  return state.duration > 0 ? (state.position / state.duration) * 100 : NaN;
}

/**
 * Tells Trakt what plays: start when the video plays, pause when it is
 * paused, and stop when it ends or the player closes, which Trakt counts as
 * watched from 80% on. Nothing for the Lab, a live broadcast, a title Trakt
 * cannot name, or a profile not signed in.
 */
export function useScrobble(
  session: PlaybackSession | null,
  state: SessionState,
  ids: { type: string; metaId: string; videoId: string; lab?: boolean },
): void {
  const { type, metaId, videoId, lab } = ids;
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
      void scrobbler.start(percent(now));
    } else if (status === 'paused' && sent.current === 'playing') {
      sent.current = 'paused';
      void scrobbler.pause(percent(now));
    } else if (status === 'ended' && sent.current !== 'none') {
      sent.current = 'stopped';
      void scrobbler.stop(100);
    }
  }, [scrobbler, status, live]);

  // Closing the player, or another episode replacing it, stops at where it got to.
  useEffect(() => {
    if (!scrobbler || !session) return;
    return () => {
      const played = sent.current !== 'none';
      if (played && sent.current !== 'stopped' && !latest.current.live) {
        sent.current = 'stopped';
        void scrobbler.stop(percent(latest.current));
      }
      if (played) syncTraktSoon();
    };
  }, [scrobbler, session]);
}
