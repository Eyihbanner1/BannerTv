import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';

const KEY = 'releaseTimings';
export const MAX_RELEASE_TIMINGS = 300;
/** Further than this is another film's subtitles, not a timing to fix. */
const LIMIT_S = 600;

/**
 * The timing the viewer set on a subtitle file for one release of a title,
 * offered on the next episode of that release, where a file from the same
 * source in the same language plays. Never a link and never a line.
 */
export interface ReleaseTiming {
  /** The title: a series' id, which all its episodes share. */
  metaId: string;
  /** What names the release, as subtitleRelease makes it: 'group:' or 'binge:' only. */
  release: string;
  /** Where the file came from: the subtitle option's source. */
  source: string;
  /** The file's language, as the addon gave it. */
  lang: string;
  /** The subtitle group named in the file's own name, when it names one. */
  subGroup?: string;
  /** Seconds, in tenths; positive shows the subtitles later. */
  offset: number;
  /** A drift fix the viewer chose, if any. */
  drift?: 'ahead' | 'behind';
  /** The episode it was set on. */
  videoId: string;
  /** The episode whose offer of it was declined. */
  declined?: string;
}

/**
 * The timing kept for each release of a title, at most MAX_RELEASE_TIMINGS,
 * the least recently changed dropped first. Kept on this screen for the
 * profile; not part of the BannerTV account.
 */
export interface ReleaseTimingMemory {
  load(): Promise<void>;
  get(metaId: string, release: string): ReleaseTiming | undefined;
  /** Keeps the timing for its release, replacing the one before, and clears a decline. */
  remember(timing: ReleaseTiming): Promise<void>;
  forget(metaId: string, release: string): Promise<void>;
  /** The offer was declined on this episode: it is not offered there again. */
  decline(metaId: string, release: string, videoId: string): Promise<void>;
  /** Told of every change, and once when the saved timings have been read. */
  subscribe(listener: Listener): () => void;
}

/** A link, should one ever reach a timing: it is never kept. */
const LINK = /:\/\//;
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && !LINK.test(value);
const isRelease = (value: unknown): value is string =>
  isText(value) && (value.startsWith('group:') || value.startsWith('binge:'));
const sameRelease = (a: ReleaseTiming, metaId: string, release: string) =>
  a.metaId === metaId && a.release === release;
const tenths = (seconds: number) => Math.round(seconds * 10) / 10;

/** The timing as it is kept, or null when it can't be trusted. */
function checked(raw: unknown): ReleaseTiming | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { metaId, release, source, lang, subGroup, offset, drift, videoId, declined } =
    raw as Record<string, unknown>;
  if (!isText(metaId) || !isRelease(release) || !isText(source) || !isText(lang)) return null;
  if (!isText(videoId)) return null;
  if (subGroup !== undefined && !isText(subGroup)) return null;
  if (declined !== undefined && !isText(declined)) return null;
  if (drift !== undefined && drift !== 'ahead' && drift !== 'behind') return null;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  const value = Math.max(-LIMIT_S, Math.min(LIMIT_S, tenths(offset)));
  // Nothing to offer: no timing and no drift fix.
  if (value === 0 && drift === undefined) return null;
  const timing: ReleaseTiming = { metaId, release, source, lang, offset: value, videoId };
  if (subGroup !== undefined) timing.subGroup = subGroup;
  if (drift !== undefined) timing.drift = drift;
  if (declined !== undefined) timing.declined = declined;
  return timing;
}

function readTimings(saved: unknown): ReleaseTiming[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const timings: ReleaseTiming[] = [];
  // Saved least recently changed first; a later duplicate is the newer one.
  for (let i = saved.length - 1; i >= 0; i--) {
    const timing = checked(saved[i]);
    if (!timing) continue;
    const id = `${timing.metaId}\n${timing.release}`;
    if (seen.has(id)) continue;
    seen.add(id);
    timings.unshift(timing);
  }
  return timings.slice(-MAX_RELEASE_TIMINGS);
}

export function createReleaseTimingMemory(options: {
  storage: KeyValueStore;
}): ReleaseTimingMemory {
  const state = createPersisted<readonly ReleaseTiming[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readTimings,
    write: (timings) => timings.slice(),
  });

  return {
    load: state.load,
    get: (metaId, release) => state.get().find((timing) => sameRelease(timing, metaId, release)),
    remember(timing) {
      // A new timing clears any decline: it is offered again.
      const kept = checked({ ...timing, declined: undefined });
      if (!kept) return Promise.resolve();
      return state.update((current) =>
        current
          .filter((known) => !sameRelease(known, kept.metaId, kept.release))
          .concat(kept)
          .slice(-MAX_RELEASE_TIMINGS),
      );
    },
    forget(metaId, release) {
      return state.update((current) =>
        current.some((timing) => sameRelease(timing, metaId, release))
          ? current.filter((timing) => !sameRelease(timing, metaId, release))
          : current,
      );
    },
    decline(metaId, release, videoId) {
      if (!isText(videoId)) return Promise.resolve();
      return state.update((current) => {
        const at = current.findIndex((timing) => sameRelease(timing, metaId, release));
        if (at < 0 || current[at]!.declined === videoId) return current;
        const next = current.slice();
        next[at] = { ...current[at]!, declined: videoId };
        return next;
      });
    },
    subscribe: state.subscribe,
  };
}
