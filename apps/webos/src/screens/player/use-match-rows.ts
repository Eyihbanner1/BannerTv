import { createCueIndex, type Cue } from '@bannertv/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type MatchRow, matchRows } from '../../player/timing';

/** The video's clock, read at a moment: seconds, the playback speed, and whether it is paused. */
export interface MatchClock {
  time: number;
  speed: number;
  paused: boolean;
}

/** Read no sooner than this, nor later, while playing (ms). */
const SOONEST_MS = 250;
const LATEST_MS = 1000;
/** This much after a line starts or ends, so the clock has surely reached it. */
const LATE_MS = 4;

const sameRows = (a: readonly MatchRow[], b: readonly MatchRow[]) =>
  a.length === b.length &&
  a.every(
    (row, i) =>
      row.key === b[i]!.key && row.index === b[i]!.index && row.onScreen === b[i]!.onScreen,
  );

/**
 * The lines to match now (`matchRows`), on the lines' own clock: the viewer's timing taken off
 * the video's. Read again once the next line starts or ends, never every frame: at least 250 ms
 * apart and at most 1 s, and each second while paused. Null cues read nothing. Shared by the TV
 * page, the phone and the TV app.
 */
export function useMatchRows(
  cues: readonly Cue[] | null,
  offset: number,
  read: () => MatchClock | null,
  pinnedKey: string | undefined,
): { rows: MatchRow[]; paused: boolean } {
  // Kept with the cues they were read for: rows of other cues are never handed out.
  const [state, setState] = useState<{
    cues: readonly Cue[] | null;
    rows: MatchRow[];
    paused: boolean;
  }>({ cues: null, rows: [], paused: false });
  // The screen hands a new reader each draw: the latest is read.
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  const index = useMemo(() => (cues ? createCueIndex(cues) : null), [cues]);

  useEffect(() => {
    if (!cues || !index) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const clock = reader.current();
      const paused = !clock || clock.paused;
      const rows = clock ? matchRows(cues, clock.time - offset, pinnedKey) : [];
      setState((old) =>
        old.cues === cues && old.paused === paused && sameRows(old.rows, rows)
          ? old
          : { cues, rows, paused },
      );
      let delay = LATEST_MS;
      if (clock && !clock.paused) {
        const now = clock.time - offset;
        const speed = clock.speed > 0 ? clock.speed : 1;
        const ms = ((index.nextChange(now) - now) / speed) * 1000 + LATE_MS;
        delay = Math.max(SOONEST_MS, Math.min(LATEST_MS, Number.isFinite(ms) ? ms : LATEST_MS));
      }
      timer = setTimeout(tick, delay);
    };
    // Read at once, though outside the effect itself.
    timer = setTimeout(tick, 0);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [cues, index, offset, pinnedKey]);

  if (!cues || state.cues !== cues) return NONE;
  return { rows: state.rows, paused: state.paused };
}

const NONE: { rows: MatchRow[]; paused: boolean } = { rows: [], paused: false };
