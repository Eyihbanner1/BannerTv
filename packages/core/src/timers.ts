/**
 * Timers the app provides, since the core assumes no platform. Each returns
 * a function that cancels it.
 */
export interface Timers {
  /** Runs `run` once, `ms` from now. */
  after(ms: number, run: () => void): () => void;
  /** Runs `run` every `ms` until cancelled. */
  every(ms: number, run: () => void): () => void;
}
