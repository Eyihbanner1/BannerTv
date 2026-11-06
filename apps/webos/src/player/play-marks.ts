import { mark } from '../platform/marks';
import { tuning } from '../platform/tuning';

/**
 * The stages from Play to the first picture, in order, each marked as
 * `play:<stage>` when the `marks` tuning switch is on. The subtitles' own
 * choice is marked apart, as `sub:chosen:track|file|off`.
 */
export const PLAY_STAGES = [
  /** Play was pressed, or the player replaced for the next episode. */
  'press',
  /** The player screen has opened, with the video's finder. */
  'open',
  /** The finder first asked the addons: on Details, often before the press. */
  'finder-start',
  /** The first stream that could play arrived. */
  'first-stream',
  /** Every addon had answered, or the wait for slower ones after the first was over. */
  'settled',
  /** Auto-play chose a stream, or the viewer's pick arrived. */
  'chosen',
  /** An engine was asked to load a stream. */
  'load',
  /** The stream said how long it is (loadedmetadata; Android's player sends none). */
  'metadata',
  /** The first 'playing', which on webOS can come a little before the picture shows. */
  'first-frame',
] as const;

export type PlayStage = (typeof PLAY_STAGES)[number];

type Times = Partial<Record<PlayStage, number>>;

/** The latest Play, as window.__bannertvPlay() reads it. */
export interface PlayMarks {
  /** Milliseconds after the press; a lookup that began before it (Details) reads negative. */
  stages: Times;
  /** How many streams were opened: more than one after failing over or stepping down. */
  streams: number;
}

declare global {
  interface Window {
    /** The stages of the latest Play, with the `marks` tuning switch on. */
    __bannertvPlay?: () => PlayMarks | null;
  }
}

const FINDER_STAGES: readonly PlayStage[] = ['finder-start', 'first-stream', 'settled'];

// When each finder first reached its own stages, which can come before the press.
const finderTimes = new WeakMap<object, Times>();
let pressedAt: number | undefined;
// The latest Play: its finder, when it was pressed, and the stages after that.
let latest: { finder: object; at: number; times: Times; streams: number } | null = null;

/** Marks Play being pressed, before the player screen opens. */
export function markPlayPress(): void {
  if (!tuning.marks) return;
  mark('play:press');
  pressedAt = performance.now();
}

/**
 * Marks a stage of starting a video. `finder` names the video: the stages
 * of one Play are those its finder and its player reach. `label` goes on the
 * mark's name only, as in `play:chosen:waited`. Names never carry an address.
 */
export function playMark(finder: object, stage: Exclude<PlayStage, 'press'>, label?: string): void {
  if (!tuning.marks) return;
  mark(label ? `play:${stage}:${label}` : `play:${stage}`);
  const now = performance.now();
  if (stage === 'open') {
    const at = pressedAt ?? now;
    pressedAt = undefined;
    latest = { finder, at, times: { press: at, open: now }, streams: 0 };
    return;
  }
  if (FINDER_STAGES.indexOf(stage) >= 0) {
    const times = finderTimes.get(finder) ?? {};
    if (times[stage] === undefined) times[stage] = now;
    finderTimes.set(finder, times);
  }
  if (!latest || latest.finder !== finder) return;
  if (stage === 'load') latest.streams++;
  if (latest.times[stage] === undefined) latest.times[stage] = now;
}

/** The latest Play's stages, the first time each was reached; null before any Play. */
export function readPlayMarks(): PlayMarks | null {
  if (!latest) return null;
  const before = finderTimes.get(latest.finder) ?? {};
  const stages: Times = {};
  for (const stage of PLAY_STAGES) {
    const at = latest.times[stage] ?? before[stage];
    if (at !== undefined) stages[stage] = Math.round(at - latest.at);
  }
  return { stages, streams: latest.streams };
}
