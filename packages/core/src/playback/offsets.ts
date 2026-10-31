import { createPersisted } from '../persisted';
import type { Listener } from '../store';
import type { KeyValueStore } from '../storage';

const KEY = 'subtitleOffsets';
export const MAX_SUBTITLE_OFFSETS = 300;
/** Further than this is another film's subtitles, not a timing to fix. */
const LIMIT_S = 600;

export interface SavedOffset {
  /** Who the file is, as made by subtitleFileKey: never a link. */
  key: string;
  /** Seconds; positive shows the subtitles later. */
  offset: number;
}

/**
 * How much later or earlier the viewer moved each subtitle file, at most
 * MAX_SUBTITLE_OFFSETS files, the least recently changed dropped first. A
 * timing of 0 is not kept.
 */
export interface SubtitleOffsets {
  load(): Promise<void>;
  /** The timing kept for the file, if any. */
  get(key: string): number | undefined;
  remember(key: string, offset: number): Promise<void>;
  /** Every file's timing, the least recently changed first. */
  offsets(): readonly SavedOffset[];
  /**
   * Makes the timings match a change from the BannerTV account: timings in
   * `set` are kept as the most recently changed, in the order given, and
   * files in `remove` forget theirs. A timing of 0 is a removal.
   */
  adopt(change: OffsetAdoption): Promise<void>;
  subscribe(listener: Listener): () => void;
}

/** What the BannerTV account changes in the timings. */
export interface OffsetAdoption {
  set?: readonly SavedOffset[];
  remove?: readonly string[];
}

/** Tenths of a second, as the player moves them. */
function tenths(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

function readOffsets(saved: unknown): SavedOffset[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const offsets: SavedOffset[] = [];
  // Saved least recently changed first; a later duplicate is the newer one.
  for (let i = saved.length - 1; i >= 0; i--) {
    const raw = saved[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) continue;
    const { key, offset } = raw;
    if (typeof key !== 'string' || key === '' || seen.has(key)) continue;
    if (typeof offset !== 'number' || !Number.isFinite(offset)) continue;
    const value = tenths(offset);
    if (value === 0 || Math.abs(value) > LIMIT_S) continue;
    seen.add(key);
    offsets.unshift({ key, offset: value });
  }
  return offsets.slice(-MAX_SUBTITLE_OFFSETS);
}

export function createSubtitleOffsets(options: { storage: KeyValueStore }): SubtitleOffsets {
  const state = createPersisted<readonly SavedOffset[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readOffsets,
    write: (offsets) => offsets.slice(),
  });

  return {
    load: state.load,
    get: (key) => state.get().find((saved) => saved.key === key)?.offset,
    remember: (key, offset) =>
      state.update((current) => {
        const value = Math.max(-LIMIT_S, Math.min(LIMIT_S, tenths(offset)));
        const old = current.find((saved) => saved.key === key);
        if (old ? old.offset === value : value === 0) return current;
        const rest = current.filter((saved) => saved.key !== key);
        return (value === 0 ? rest : rest.concat({ key, offset: value })).slice(
          -MAX_SUBTITLE_OFFSETS,
        );
      }),
    offsets: () => state.get(),
    adopt: (adoption) =>
      state.update((current) => {
        const set = readOffsets(adoption.set ?? []);
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
          .slice(-MAX_SUBTITLE_OFFSETS);
      }),
    subscribe: state.subscribe,
  };
}

/**
 * The key a subtitle file's timing is kept under: a short hash of the video
 * and who the file is, so neither a link nor anything an addon sent is kept.
 */
export function subtitleFileKey(videoId: string, file: string): string {
  // FNV-1a, twice with different seeds for 64 bits: 300 keys never meet.
  const text = `${videoId}\n${file}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x01000193);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
