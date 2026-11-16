import { useEffect, useRef, useState } from 'react';
import type { TimingOffer } from './use-subtitles';

/** How long the note of last episode's timing shows (ms). */
const NOTICE_MS = 8000;

/**
 * Whether to show the note that last episode's timing is offered: for 8 s from the moment it is
 * first offered for the video, once a video. Timers only, never a read each frame. Shared by the
 * TV page, the phone and the TV app.
 */
export function useOfferNotice(offer: TimingOffer | null, videoId: string): boolean {
  const seen = useRef(new Set<string>());
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [showing, setShowing] = useState<string | null>(null);
  const offering = offer !== null;
  useEffect(() => {
    if (!offering || seen.current.has(videoId)) return;
    seen.current.add(videoId);
    timers.current.push(
      setTimeout(() => setShowing(videoId), 0),
      setTimeout(() => setShowing((now) => (now === videoId ? null : now)), NOTICE_MS),
    );
  }, [offering, videoId]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  return offering && showing === videoId;
}
