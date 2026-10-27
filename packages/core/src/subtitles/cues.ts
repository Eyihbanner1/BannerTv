import type { Cue } from './types';

export interface CueIndex {
  /** The cues showing at `time` seconds, in start order. */
  at(time: number): Cue[];
}

/**
 * Cues by start time, ties kept in the order given. Chromium 68 ships V8 6.8,
 * whose Array.prototype.sort is not stable (that came in V8 7.0), so the
 * original position breaks ties.
 */
export function sortByStart<T extends { start: number }>(cues: readonly T[]): T[] {
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.start - b.cue.start || a.index - b.index)
    .map((entry) => entry.cue);
}

/**
 * Finds the cues for a moment quickly: the subtitle layer asks ten times a
 * second, and files have thousands of cues, some overlapping.
 *
 * Cues are sorted by start, and each position also records the latest end of
 * any cue up to it. A binary search finds the last cue that has started; the
 * walk back stops as soon as nothing earlier can still be showing.
 *
 * Between two changes (a cue starting or ending) the answer stays the same,
 * so while playback moves forward inside that window the same array comes
 * back without a search. The player can compare it by reference to skip a
 * redraw.
 */
export function createCueIndex(cues: readonly Cue[]): CueIndex {
  const sorted = sortByStart(cues.filter((cue) => cue.end > cue.start));
  const starts = sorted.map((cue) => cue.start);
  const latestEnds: number[] = [];
  let latest = -Infinity;
  for (const cue of sorted) {
    latest = Math.max(latest, cue.end);
    latestEnds.push(latest);
  }

  let validFrom = Infinity;
  let validUntil = -Infinity;
  let showing: Cue[] = [];

  /** Position of the last cue that starts at or before `time`, or -1. */
  function lastStarted(time: number): number {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= time) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  return {
    at(time) {
      if (time >= validFrom && time < validUntil) return showing;
      const last = lastStarted(time);
      let nextChange = last + 1 < sorted.length ? starts[last + 1]! : Infinity;
      const found: Cue[] = [];
      for (let i = last; i >= 0 && latestEnds[i]! > time; i--) {
        const cue = sorted[i]!;
        if (cue.end > time) {
          found.push(cue);
          nextChange = Math.min(nextChange, cue.end);
        }
      }
      found.reverse();
      validFrom = time;
      validUntil = nextChange;
      showing = found;
      return found;
    },
  };
}
