import { type Cue, profileSubtitles, type SubtitleProfile } from '@bannertv/core';
import { loadSubtitles, type SubtitleOption } from './subtitles';

/** What reading a file for its checks needs of it. */
export type CheckedFile = Pick<SubtitleOption, 'url' | 'lang' | 'label'>;

/**
 * The subtitle files read for one video, and what their lines say about
 * them (`profileSubtitles`), so the player can pick the one that fits best
 * and the sheet can say why. Kept by link, in memory only: never stored.
 */
export interface SubtitleChecks {
  /** What reading the file found, once it has been read. */
  profile(url: string): SubtitleProfile | undefined;
  /** Every file read so far, by link: a new map after each, for useSyncExternalStore. */
  profiles(): ReadonlyMap<string, SubtitleProfile>;
  /** Whether the file is being read now. */
  reading(url: string): boolean;
  /** Whether the file could not be read the last time it was tried. */
  failed(url: string): boolean;
  /**
   * Reads the file (from the parsed files kept, when it is one of them) and
   * keeps what its lines say. Listeners hear of the outcome before the
   * caller does, and nothing when the read starts.
   */
  read(file: CheckedFile): Promise<Cue[]>;
  /** Told when a read ends or fails. */
  subscribe(listener: () => void): () => void;
}

export function createSubtitleChecks(
  load: (file: CheckedFile) => Promise<Cue[]> = loadSubtitles,
): SubtitleChecks {
  let profiles: ReadonlyMap<string, SubtitleProfile> = new Map();
  const reading = new Map<string, Promise<Cue[]>>();
  const failed = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

  return {
    profile: (url) => profiles.get(url),
    profiles: () => profiles,
    reading: (url) => reading.has(url),
    failed: (url) => failed.has(url),
    read(file) {
      const already = reading.get(file.url);
      if (already) return already;
      const promise = load(file).then(
        (cues) => {
          reading.delete(file.url);
          failed.delete(file.url);
          if (!profiles.has(file.url)) {
            profiles = new Map(profiles).set(file.url, profileSubtitles(cues, file.label));
          }
          changed();
          return cues;
        },
        (error: unknown) => {
          reading.delete(file.url);
          failed.add(file.url);
          changed();
          throw error;
        },
      );
      reading.set(file.url, promise);
      return promise;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
