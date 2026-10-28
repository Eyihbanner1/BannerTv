/**
 * Decides which media-clock readings are safe to save. On webOS a mediaOption
 * start reads currentTime 0 at the first `playing` event and the real
 * position about 55 ms later (docs/adr/0001), so readings only count once the
 * clock has reached the start point, or once the user has seeked.
 */
export interface ProgressTracker {
  /**
   * Feeds one clock reading (seconds) at `now` (milliseconds). Returns true
   * when a save is due: the first trusted reading, then every `saveEveryMs`.
   */
  update(position: number, now: number): boolean;
  /** The user (or the player) moved the clock: readings are trusted from here on. */
  seeked(position: number): void;
  /** The last trusted position, or undefined while the clock has not settled. */
  position(): number | undefined;
}

function isReading(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * A reading of 0 never settles the clock on its own, even when startAt is
 * within `tolerance` of the start: that 0 is exactly the false reading that
 * would overwrite a resume point.
 */
export function createProgressTracker(options: {
  /** Where playback was asked to start, in seconds. */
  startAt: number;
  saveEveryMs?: number;
  /** How far before startAt a reading still counts as having arrived, in seconds. */
  tolerance?: number;
}): ProgressTracker {
  const { startAt, saveEveryMs = 10000, tolerance = 15 } = options;
  const arrivedAt = isReading(startAt) && startAt > 0 ? startAt - tolerance : 0;
  let trusted: number | undefined;
  // When update() last asked for a save; undefined makes the next trusted reading ask.
  let savedAt: number | undefined;

  return {
    update(position, now) {
      if (!isReading(position)) return false;
      if (trusted === undefined && (position <= 0 || position < arrivedAt)) return false;
      trusted = position;
      // Due unless the last save was less than saveEveryMs ago. Date.now() jumps back
      // when the TV sets its clock from the network, and one time that is not a number
      // must not stop saves for the rest of the film: both count as due.
      const due = savedAt === undefined || !(now >= savedAt && now - savedAt < saveEveryMs);
      if (due) savedAt = now;
      return due;
    },
    seeked(position) {
      if (!isReading(position)) return;
      trusted = position;
      savedAt = undefined;
    },
    position: () => trusted,
  };
}
