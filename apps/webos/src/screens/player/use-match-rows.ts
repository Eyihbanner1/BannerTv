import { createCueIndex, type Cue } from '@bannertv/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type MatchRow, matchRows } from '../../player/timing';

/** The video's clock, read at a moment: seconds, the playback speed, and whether it is paused. */
export interface MatchClock {
  time: number;
  speed: number;
  paused: boolean;
}

/** The lines to match, whether the video is paused, and whether they were read yet since opening. */
export interface MatchList {
  rows: MatchRow[];
  paused: boolean;
  read: boolean;
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
): MatchList {
  // Kept with the cues they were read for, and the moment on the lines' clock they were read at
  // (null with no clock to read).
  const [state, setState] = useState<{
    cues: readonly Cue[] | null;
    rows: MatchRow[];
    paused: boolean;
    at: number | null;
  }>(EMPTY);
  // The screen hands a new reader each draw: the latest is read.
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  const index = useMemo(() => (cues ? createCueIndex(cues) : null), [cues]);

  useEffect(() => {
    if (!cues || !index) {
      // Closed: the next opening starts afresh, with nothing kept from before.
      const timer = setTimeout(() => setState(EMPTY), 0);
      return () => clearTimeout(timer);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const clock = reader.current();
      const paused = !clock || clock.paused;
      const at = clock ? clock.time - offset : null;
      const rows = at !== null ? matchRows(cues, at, pinnedKey) : [];
      setState((old) =>
        old.cues === cues && old.paused === paused && sameRows(old.rows, rows)
          ? old
          : { cues, rows, paused, at },
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

  // New cues for the same list (a track handing over its lines again as each starts, a file's
  // window growing): the rows are read from them at once, at the moment last read, so the list
  // never empties and the row with focus stays drawn until the next read.
  const carried = useMemo(
    () =>
      cues && state.cues && state.cues !== cues
        ? state.at !== null
          ? matchRows(cues, state.at, pinnedKey)
          : []
        : null,
    [cues, state, pinnedKey],
  );
  if (!cues || !state.cues) return NONE;
  return { rows: carried ?? state.rows, paused: state.paused, read: true };
}

const EMPTY = { cues: null, rows: [], paused: false, at: null };
const NONE: MatchList = { rows: [], paused: false, read: false };
