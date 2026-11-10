import { useEffect, useState } from 'react';

/**
 * The time, read again every `everyMs` while the caller is mounted: for words that follow the
 * clock while the video is paused and nothing else draws the panel again ("28 min left", "Ends
 * at 22:41").
 */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
