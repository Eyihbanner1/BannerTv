import { createPersisted, type Cue, type KeyValueStore, type Listener } from '@bannertv/core';

/**
 * Subtitles that slide further out of step as the film goes on were timed
 * for a release at another frame rate: a PAL (25 fps) file on a film-speed
 * (23.976 fps) video runs about 4% fast, so by the end of a two-hour film it
 * is nearly five minutes ahead. A fixed timing cannot fix that; a drift fix
 * stretches the file's clock to the video's.
 *
 * ahead: the lines come too early, and more so later on (PAL file, film video).
 * behind: the lines come too late, and more so later on (film file, PAL video).
 */
export type SubtitleDrift = 'ahead' | 'behind';

export const SUBTITLE_DRIFTS: readonly SubtitleDrift[] = ['ahead', 'behind'];

const FILM_FPS = 24000 / 1001;
const PAL_FPS = 25;

/** The file's seconds for one second of the video. */
export const DRIFT_RATES: Readonly<Record<SubtitleDrift, number>> = {
  ahead: FILM_FPS / PAL_FPS,
  behind: PAL_FPS / FILM_FPS,
};

/**
 * The cues moved onto the video's clock: a line the file times at t shows at
 * t / rate. The same array when there is no drift fix, so nothing redraws.
 */
export function stretchCues(cues: readonly Cue[], drift: SubtitleDrift | null): readonly Cue[] {
  if (drift === null) return cues;
  const rate = DRIFT_RATES[drift];
  return cues.map((cue) => ({ ...cue, start: cue.start / rate, end: cue.end / rate }));
}

const KEY = 'subtitleDrift';
export const MAX_SUBTITLE_DRIFTS = 300;

interface SavedDrift {
  /** Who the file is, as made by subtitleFileKey: never a link. */
  key: string;
  drift: SubtitleDrift;
}

/**
 * The drift fix the viewer chose for each subtitle file, kept like its timing:
 * at most MAX_SUBTITLE_DRIFTS files, the least recently changed dropped first.
 * No fix is not kept.
 */
export interface SubtitleDrifts {
  load(): Promise<void>;
  get(key: string): SubtitleDrift | undefined;
  remember(key: string, drift: SubtitleDrift | null): Promise<void>;
  subscribe(listener: Listener): () => void;
}

function isDrift(value: unknown): value is SubtitleDrift {
  return value === 'ahead' || value === 'behind';
}

function readDrifts(saved: unknown): SavedDrift[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const drifts: SavedDrift[] = [];
  // Saved least recently changed first; a later duplicate is the newer one.
  for (let i = saved.length - 1; i >= 0; i--) {
    const raw = saved[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) continue;
    const { key, drift } = raw;
    if (typeof key !== 'string' || key === '' || seen.has(key) || !isDrift(drift)) continue;
    seen.add(key);
    drifts.unshift({ key, drift });
  }
  return drifts.slice(-MAX_SUBTITLE_DRIFTS);
}

export function createSubtitleDrifts(options: { storage: KeyValueStore }): SubtitleDrifts {
  const state = createPersisted<readonly SavedDrift[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readDrifts,
    write: (drifts) => drifts.slice(),
  });

  return {
    load: state.load,
    get: (key) => state.get().find((saved) => saved.key === key)?.drift,
    remember: (key, drift) =>
      state.update((current) => {
        const old = current.find((saved) => saved.key === key);
        if (old ? old.drift === drift : drift === null) return current;
        const rest = current.filter((saved) => saved.key !== key);
        return (drift === null ? rest : rest.concat({ key, drift })).slice(-MAX_SUBTITLE_DRIFTS);
      }),
    subscribe: state.subscribe,
  };
}
