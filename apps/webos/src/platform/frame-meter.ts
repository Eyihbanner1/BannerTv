import { topRoute } from '../app/router';
import { sinceActivity } from '../navigation/activity';
import { tuning } from './tuning';

/** One frame at 60 Hz. A gap this long or less is smooth. */
const FRAME_MS = 1000 / 60;
/** A gap this long or more is a stutter the eye catches. */
const STUTTER_MS = 100;
/** Frames count only this soon after a key press: an idle screen draws nothing worth counting. */
const IN_USE_MS = 1000;
/** Gaps kept per screen, newest last, so a long round cannot fill the TV's memory. */
const MAX_GAPS = 6000;
/** A gap past this is the page being hidden or the TV asleep, not a slow frame. */
const PAUSED_MS = 5000;

export interface FrameSummary {
  frames: number;
  p50: number;
  p95: number;
  worst: number;
  /** Frames that should have been drawn in the gaps and were not. */
  missed: number;
  /** Gaps of `STUTTER_MS` or more. */
  stutters: number;
  /** Share of gaps longer than one frame, 0 to 100. */
  jankyPercent: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The figures a TV round compares, for one screen's frame gaps in ms. */
export function summarise(gaps: readonly number[]): FrameSummary {
  if (gaps.length === 0) {
    return { frames: 0, p50: 0, p95: 0, worst: 0, missed: 0, stutters: 0, jankyPercent: 0 };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
  let missed = 0;
  let stutters = 0;
  let janky = 0;
  for (const gap of gaps) {
    // A little over one frame is timer noise, not a dropped frame.
    const frames = Math.round(gap / FRAME_MS);
    if (frames > 1) {
      missed += frames - 1;
      janky++;
    }
    if (gap >= STUTTER_MS) stutters++;
  }
  return {
    frames: gaps.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    worst: round(sorted[sorted.length - 1]!),
    missed,
    stutters,
    jankyPercent: Math.round((janky / gaps.length) * 100),
  };
}

const byScreen = new Map<string, number[]>();
let last = 0;

function tick(time: number): void {
  const gap = last > 0 ? time - last : 0;
  last = time;
  if (gap > 0 && gap < PAUSED_MS && sinceActivity() < IN_USE_MS) {
    const screen = topRoute().name;
    let gaps = byScreen.get(screen);
    if (!gaps) byScreen.set(screen, (gaps = []));
    gaps.push(gap);
    if (gaps.length > MAX_GAPS) gaps.shift();
  }
  requestAnimationFrame(tick);
}

/** Each screen's figures so far; `reset` starts every count again after reading. */
export function readFrames(reset = false): Record<string, FrameSummary> {
  const result: Record<string, FrameSummary> = {};
  byScreen.forEach((gaps, screen) => {
    result[screen] = summarise(gaps);
  });
  if (reset) byScreen.clear();
  return result;
}

declare global {
  interface Window {
    __bannertvFrames?: (reset?: boolean) => Record<string, FrameSummary>;
  }
}

/**
 * With the `meter` switch, measures every frame while the remote is in use
 * and files it under the screen on top. Off, as it ships, it costs nothing:
 * not even a frame callback is asked for.
 */
export function startFrameMeter(): void {
  if (!tuning.meter) return;
  window.__bannertvFrames = readFrames;
  requestAnimationFrame(tick);
}
