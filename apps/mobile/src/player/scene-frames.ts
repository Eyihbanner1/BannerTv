/**
 * Scene previews: still frames of the video, taken while the viewer swipes or drags the bar,
 * so they see the scene they are about to jump to. Frames are asked for one at a time, the
 * newest wish first (a fast swipe skips the places it only passed), and kept for the stream
 * playing; while the frame for a place is on its way the nearest one already taken shows.
 *
 * Pure and generic over the frame type, so it is unit-tested; scene-preview.tsx gives it the
 * phone player's frame grabber.
 */

/** Frames are taken on this grid, in seconds: nearby places share one. */
export const FRAME_STEP_S = 5;
/** A frame this close to the place wanted stands in while the right one comes. */
export const FRAME_NEAR_S = 30;
/** Frames kept for the stream playing (small, about 230 kB each). */
export const FRAME_LIMIT = 36;
/** Failures in a row after which the stream is taken to give no frames, and none are asked. */
export const FRAME_FAILURES = 2;

export interface NearFrame<T> {
  frame: T;
  /** The second the frame was taken at. */
  at: number;
}

export interface FrameSource<T> {
  /** Starts over for another stream; null when nothing plays. Same key: nothing changes. */
  reset(key: string | null): void;
  /** Asks for the frame at `seconds`, unless it is there or on its way. */
  want(seconds: number): void;
  /** The frame at `seconds`, else the nearest within FRAME_NEAR_S. */
  near(seconds: number): NearFrame<T> | undefined;
  /** False once the stream has failed to give frames (a broadcast's HLS, a format without). */
  works(): boolean;
  /** Changes with every frame taken, for useSyncExternalStore. */
  version(): number;
  subscribe(listener: () => void): () => void;
}

/** The grid place for a second. */
export function frameSlot(seconds: number): number {
  return Math.max(0, Math.round(seconds / FRAME_STEP_S) * FRAME_STEP_S);
}

export function createFrameSource<T>(grab: (seconds: number) => Promise<T>): FrameSource<T> {
  let key: string | null = null;
  // Kept in the order last used, oldest first.
  const frames = new Map<number, T>();
  let busy: number | null = null;
  let queued: number | null = null;
  let failures = 0;
  let broken = false;
  let generation = 0;
  let version = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };

  const keep = (slot: number, frame: T) => {
    frames.delete(slot);
    frames.set(slot, frame);
    while (frames.size > FRAME_LIMIT) {
      const oldest = frames.keys().next().value as number;
      frames.delete(oldest);
    }
  };

  const take = (slot: number) => {
    const mine = generation;
    busy = slot;
    let result: Promise<T>;
    try {
      result = grab(slot);
    } catch (error) {
      result = Promise.reject(error);
    }
    result
      .then(
        (frame) => {
          if (mine !== generation) return;
          failures = 0;
          keep(slot, frame);
        },
        () => {
          if (mine !== generation) return;
          failures += 1;
          if (failures >= FRAME_FAILURES) broken = true;
        },
      )
      .then(() => {
        if (mine !== generation) return;
        busy = null;
        const next = queued;
        queued = null;
        if (next !== null && !broken && !frames.has(next)) take(next);
        emit();
      });
  };

  return {
    reset(next) {
      if (next === key) return;
      key = next;
      generation += 1;
      frames.clear();
      busy = null;
      queued = null;
      failures = 0;
      broken = false;
      emit();
    },
    want(seconds) {
      if (key === null || broken || !isFinite(seconds)) return;
      const slot = frameSlot(seconds);
      const kept = frames.get(slot);
      if (kept !== undefined) {
        keep(slot, kept);
        return;
      }
      if (busy === slot) return;
      if (busy !== null) {
        queued = slot;
        return;
      }
      take(slot);
    },
    near(seconds) {
      if (!isFinite(seconds)) return undefined;
      const slot = frameSlot(seconds);
      const exact = frames.get(slot);
      if (exact !== undefined) return { frame: exact, at: slot };
      let best: NearFrame<T> | undefined;
      for (const [at, frame] of frames) {
        const off = Math.abs(at - seconds);
        if (off <= FRAME_NEAR_S && (!best || off < Math.abs(best.at - seconds))) {
          best = { frame, at };
        }
      }
      return best;
    },
    works: () => !broken,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
