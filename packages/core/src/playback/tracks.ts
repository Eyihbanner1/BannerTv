import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';

const KEY = 'trackChoices';
export const MAX_TRACK_TITLES = 300;

/** The audio and subtitle languages chosen for one title. */
export interface TrackChoice {
  /** The title: a film's id, or a series' (all its episodes share it). */
  metaId: string;
  /** Undefined: never chosen for this title. */
  audio?: string;
  /** Undefined: never chosen; null: subtitles turned off. */
  subtitle?: string | null;
}

/**
 * The languages last chosen in the player for each title, at most
 * MAX_TRACK_TITLES titles, the least recently changed dropped first. A
 * series counts as one title, so the next episode starts the same way.
 */
export interface TrackMemory {
  load(): Promise<void>;
  /** What was chosen for the title, if anything. */
  get(metaId: string): TrackChoice | undefined;
  rememberAudio(metaId: string, language: string): Promise<void>;
  rememberSubtitle(metaId: string, language: string | null): Promise<void>;
  /** Every title's choice, the least recently changed first. */
  choices(): readonly TrackChoice[];
  /**
   * Makes the choices match a change from the BannerTV account: choices in
   * `set` are kept as given, as the most recently changed in the order given,
   * and titles in `remove` forget theirs.
   */
  adopt(change: TrackAdoption): Promise<void>;
  /** Told of every change, and once when the saved choices have been read. */
  subscribe(listener: Listener): () => void;
}

/** What the BannerTV account changes in the choices. */
export interface TrackAdoption {
  set?: readonly TrackChoice[];
  remove?: readonly string[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function readChoices(saved: unknown): TrackChoice[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const choices: TrackChoice[] = [];
  // Saved least recently changed first; a later duplicate is the newer one.
  for (let i = saved.length - 1; i >= 0; i--) {
    const raw = saved[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null || !isText(raw.metaId)) continue;
    if (seen.has(raw.metaId)) continue;
    const choice: TrackChoice = { metaId: raw.metaId };
    if (isText(raw.audio)) choice.audio = raw.audio;
    if (raw.subtitle === null || isText(raw.subtitle)) choice.subtitle = raw.subtitle;
    if (choice.audio === undefined && choice.subtitle === undefined) continue;
    seen.add(raw.metaId);
    choices.unshift(choice);
  }
  return choices.slice(-MAX_TRACK_TITLES);
}

export function createTrackMemory(options: { storage: KeyValueStore }): TrackMemory {
  const state = createPersisted<readonly TrackChoice[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readChoices,
    write: (choices) => choices.slice(),
  });

  function change(metaId: string, patch: Partial<TrackChoice>) {
    return state.update((current) => {
      const old = current.find((choice) => choice.metaId === metaId);
      const next: TrackChoice = { ...old, ...patch, metaId };
      if (old && old.audio === next.audio && old.subtitle === next.subtitle) return current;
      return current
        .filter((choice) => choice.metaId !== metaId)
        .concat(next)
        .slice(-MAX_TRACK_TITLES);
    });
  }

  return {
    load: state.load,
    get: (metaId) => state.get().find((choice) => choice.metaId === metaId),
    rememberAudio: (metaId, language) => change(metaId, { audio: language }),
    rememberSubtitle: (metaId, language) => change(metaId, { subtitle: language }),
    choices: () => state.get(),
    adopt: (adoption) =>
      state.update((current) => {
        const set = readChoices(adoption.set ?? []);
        const removing = new Set(adoption.remove ?? []);
        set.forEach((choice) => removing.add(choice.metaId));
        if (set.length === 0 && !current.some((choice) => removing.has(choice.metaId))) {
          return current;
        }
        return current
          .filter((choice) => !removing.has(choice.metaId))
          .concat(set)
          .slice(-MAX_TRACK_TITLES);
      }),
    subscribe: state.subscribe,
  };
}
