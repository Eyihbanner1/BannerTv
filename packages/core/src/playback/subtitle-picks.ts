import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';
import type { StreamEntry } from '../streams/types';

const KEY = 'subtitlePicks';
export const MAX_SUBTITLE_PICKS = 300;

/**
 * The subtitle version the viewer picked by hand for one release of a
 * title, tried first the next time that release plays. Its timing and drift
 * fix are kept for the file already (`createSubtitleOffsets`,
 * `createSubtitleDrifts`). Never a link.
 */
export interface SubtitlePick {
  /** The title: a film's id, or a series' (all its episodes share it). */
  metaId: string;
  /** What names the release, as subtitleRelease makes it. */
  release: string;
  /** Who the file is, as subtitleFileKey makes it from the video and the file's source and id. */
  file: string;
  /**
   * The file was for the hard of hearing: picking one by hand asks for them,
   * so such files come first for this title from then on.
   */
  hearing?: boolean;
}

/**
 * The version picked by hand for each release of a title, at most
 * MAX_SUBTITLE_PICKS, the least recently picked dropped first (improvements
 * list PL9). Kept on this screen for the profile; not part of the BannerTV
 * account.
 */
export interface SubtitlePickMemory {
  load(): Promise<void>;
  get(metaId: string, release: string): SubtitlePick | undefined;
  /**
   * Whether files for the hard of hearing are wanted for this release: the
   * version picked for it was one, or, with none picked for it, the version
   * picked last for the title was.
   */
  wantsHearing(metaId: string, release: string): boolean;
  remember(pick: SubtitlePick): Promise<void>;
  /** Forgets the version picked for a release: the stream's own subtitles were picked over it. */
  forget(metaId: string, release: string): Promise<void>;
  /** Told of every change, and once when the saved picks have been read. */
  subscribe(listener: Listener): () => void;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const sameRelease = (a: SubtitlePick, metaId: string, release: string) =>
  a.metaId === metaId && a.release === release;
/** A link, should one ever reach a pick: it is never kept. */
const LINK = /:\/\//;

function readPicks(saved: unknown): SubtitlePick[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const picks: SubtitlePick[] = [];
  // Saved least recently picked first; a later duplicate is the newer one.
  for (let i = saved.length - 1; i >= 0; i--) {
    const raw = saved[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) continue;
    const { metaId, release, file, hearing } = raw;
    if (!isText(metaId) || !isText(release) || !isText(file)) continue;
    if (LINK.test(release) || LINK.test(file)) continue;
    const id = `${metaId}\n${release}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const pick: SubtitlePick = { metaId, release, file };
    if (hearing === true) pick.hearing = true;
    picks.unshift(pick);
  }
  return picks.slice(-MAX_SUBTITLE_PICKS);
}

/**
 * What names the release playing, for its subtitle pick: the release group
 * read from the stream's name ("group:flux"), else the addon's binge group,
 * else the video itself. Never the link.
 */
export function subtitleRelease(
  entry: Pick<StreamEntry, 'stream' | 'facts'>,
  videoId: string,
): string {
  const group = entry.facts.releaseGroup;
  if (group) return `group:${group}`;
  const binge = entry.stream.behaviorHints.bingeGroup;
  if (binge && !LINK.test(binge)) return `binge:${binge}`;
  return `video:${videoId}`;
}

export function createSubtitlePickMemory(options: { storage: KeyValueStore }): SubtitlePickMemory {
  const state = createPersisted<readonly SubtitlePick[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readPicks,
    write: (picks) => picks.slice(),
  });

  const get = (metaId: string, release: string) =>
    state.get().find((pick) => sameRelease(pick, metaId, release));

  return {
    load: state.load,
    get,
    wantsHearing(metaId, release) {
      const own = get(metaId, release);
      if (own) return own.hearing === true;
      const picks = state.get();
      for (let i = picks.length - 1; i >= 0; i--) {
        if (picks[i]!.metaId === metaId) return picks[i]!.hearing === true;
      }
      return false;
    },
    remember(pick) {
      if (!isText(pick.metaId) || !isText(pick.release) || !isText(pick.file)) {
        return Promise.resolve();
      }
      if (LINK.test(pick.release) || LINK.test(pick.file)) return Promise.resolve();
      const kept: SubtitlePick = { metaId: pick.metaId, release: pick.release, file: pick.file };
      if (pick.hearing) kept.hearing = true;
      return state.update((current) => {
        const last = current[current.length - 1];
        if (
          last &&
          sameRelease(last, kept.metaId, kept.release) &&
          last.file === kept.file &&
          last.hearing === kept.hearing
        ) {
          return current;
        }
        return current
          .filter((known) => !sameRelease(known, kept.metaId, kept.release))
          .concat(kept)
          .slice(-MAX_SUBTITLE_PICKS);
      });
    },
    forget(metaId, release) {
      return state.update((current) =>
        current.some((pick) => sameRelease(pick, metaId, release))
          ? current.filter((pick) => !sameRelease(pick, metaId, release))
          : current,
      );
    },
    subscribe: state.subscribe,
  };
}
