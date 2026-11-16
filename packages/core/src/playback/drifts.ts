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

/**
 * What the viewer chose for a file: a drift fix; 'none', kept only where the
 * player had fixed the file's drift by itself (its length gave it away) and
 * the viewer took the fix off, so it is never put back on that file; or
 * 'auto', the player's own fix, worked out from this stream's evidence, kept
 * with the viewer's timing. 'auto' is kept when the viewer moves the timing
 * of a file with no drift choice of theirs, the player's fix on or none to
 * make: the fix stays on as they see it, and is worked out again on every
 * stream, so another release of the video, which the file may fit as it is,
 * is not stretched, and one whose length shows a drift is still fixed. A fix
 * the viewer picks replaces it. 'aligned' is 'auto' for timing the viewer set
 * on lines the player had lined up against the video itself: the timing adds
 * to the player's move, worked out again on every stream, where the file is
 * lined up; where it is not, the timing and the fix are as for 'auto'.
 */
export type DriftChoice = SubtitleDrift | 'none' | 'auto' | 'aligned';

const KEY = 'subtitleDrift';
export const MAX_SUBTITLE_DRIFTS = 300;

export interface SavedDrift {
  /** Who the file is, as made by subtitleFileKey: never a link. */
  key: string;
  drift: DriftChoice;
}

/**
 * The drift fix the viewer chose for each subtitle file, kept like its timing:
 * at most MAX_SUBTITLE_DRIFTS files, the least recently changed dropped first.
 * No fix is not kept, except as 'none' where it takes off a fix the player
 * made by itself.
 */
export interface SubtitleDrifts {
  load(): Promise<void>;
  /**
   * The drift fix kept for the file: 'none' where the viewer took off the player's own,
   * 'auto' where the player's own is kept with the viewer's timing, 'aligned' where that
   * timing was set on lines the player lined up itself.
   */
  get(key: string): DriftChoice | undefined;
  /** Null forgets the choice: the file is as it was, and the player may fix it by itself. */
  remember(key: string, drift: DriftChoice | null): Promise<void>;
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

function isChoice(value: unknown): value is DriftChoice {
  return (
    value === 'ahead' ||
    value === 'behind' ||
    value === 'none' ||
    value === 'auto' ||
    value === 'aligned'
  );
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
    if (typeof key !== 'string' || key === '' || seen.has(key) || !isChoice(drift)) continue;
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
