import { useEffect, useState } from 'react';

/** The time now, refreshed every `every` ms, so render stays pure while clocks still move. */
export function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
