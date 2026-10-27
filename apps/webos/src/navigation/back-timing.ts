/**
 * How long Back takes to show its result on screen: from the key event to the
 * frame after the one that painted it. Diagnostics shows the last few, so the
 * delay can be measured on the TV without DevTools.
 */
const KEEP = 5;
const recent: number[] = [];

export function timeBack(event: Event): void {
  // Event times share performance.now()'s clock, so input queueing counts too.
  const start = event.timeStamp;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const ms = Math.round(performance.now() - start);
      recent.unshift(ms);
      recent.length = Math.min(recent.length, KEEP);
      console.info(`[BannerTV] Back shown after ${ms} ms`);
    }),
  );
}

/** Newest first, in milliseconds. */
export function recentBackTimes(): readonly number[] {
  return recent;
}
