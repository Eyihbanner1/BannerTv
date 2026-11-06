import { createPersisted } from '../persisted';
import type { Listener } from '../store';
import type { KeyValueStore } from '../storage';

/**
 * Subtitles that slide further out of step as the film goes on were timed
 * for a release at another frame rate. A drift fix stretches the file's clock
 * to the video's (the player's `stretchCues`).
 *
 * ahead: the lines come too early, and more so later on (PAL file, film video).
 * behind: the lines come too late, and more so later on (film file, PAL video).
 */
export type SubtitleDrift = 'ahead' | 'behind';

export const SUBTITLE_DRIFTS: readonly SubtitleDrift[] = ['ahead', 'behind'];

const KEY = 'subtitleDrift';
export const MAX_SUBTITLE_DRIFTS = 300;

export interface SavedDrift {
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
  /** The drift fix kept for the file, if any. */
  get(key: string): SubtitleDrift | undefined;
  remember(key: string, drift: SubtitleDrift | null): Promise<void>;
  /** Every file's drift fix, the least recently changed first. */
  drifts(): readonly SavedDrift[];
  /**
   * Makes the drift fixes match a change from elsewhere (the BannerTV account,
   * once it carries them): fixes in `set` are kept as the most recently
   * changed, in the order given, and files in `remove` forget theirs. An entry
   * in `set` with no fix it knows is a removal.
   */
  adopt(change: DriftAdoption): Promise<void>;
  subscribe(listener: Listener): () => void;
}

/** What a change from elsewhere does to the drift fixes. */
export interface DriftAdoption {
  set?: readonly SavedDrift[];
  remove?: readonly string[];
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
    drifts: () => state.get(),
    adopt: (adoption) =>
      state.updateNow((current) => {
        const set = readDrifts(adoption.set ?? []);
        const removing = new Set(adoption.remove ?? []);
        for (const saved of adoption.set ?? []) {
          if (saved && typeof saved.key === 'string') removing.add(saved.key);
        }
        if (set.length === 0 && !current.some((saved) => removing.has(saved.key))) {
          return current;
        }
        return current
          .filter((saved) => !removing.has(saved.key))
          .concat(set)
          .slice(-MAX_SUBTITLE_DRIFTS);
      }),
    subscribe: state.subscribe,
  };
}
