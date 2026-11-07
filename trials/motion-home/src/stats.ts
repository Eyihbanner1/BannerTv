/**
 * Frame timing, measured the same way in both modes: the gap between
 * consecutive animation frames while the walk runs. A 60 Hz TV shows a frame
 * every 16.7 ms; a gap over 33 ms is at least one frame missed, and one over
 * 100 ms is a stutter anyone sees.
 */

export interface FrameSummary {
  frames: number;
  /** Milliseconds. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Gaps over 33 ms: one or more frames missed. */
  missed: number;
  /** Gaps over 100 ms: a visible stutter. */
  stutters: number;
  /** Share of the time spent in gaps over 33 ms, 0 to 1. */
  jankShare: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}

export function summarize(gaps: readonly number[]): FrameSummary {
  const sorted = gaps.slice().sort((a, b) => a - b);
  let total = 0;
  let janky = 0;
  let missed = 0;
  let stutters = 0;
  for (const gap of gaps) {
    total += gap;
    if (gap > 33) {
      missed++;
      janky += gap;
    }
    if (gap > 100) stutters++;
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: gaps.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.length ? sorted[sorted.length - 1]! : 0),
    missed,
    stutters,
    jankShare: total > 0 ? Math.round((janky / total) * 1000) / 1000 : 0,
  };
}

/** Records frame gaps from start() to stop(). Keeps the page drawing frames so idle time counts. */
export class FrameRecorder {
  private gaps: number[] = [];
  private last = 0;
  private handle = 0;
  private running = false;

  start(): void {
    this.gaps = [];
    this.last = 0;
    this.running = true;
    const tick = (time: number) => {
      if (!this.running) return;
      if (this.last > 0) this.gaps.push(time - this.last);
      this.last = time;
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): FrameSummary {
    this.running = false;
    cancelAnimationFrame(this.handle);
    return summarize(this.gaps);
  }
}

/** The JavaScript heap in MB where the engine reports it (Chromium does), else null. */
export function heapMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
}
