import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';
import type { StreamEntry } from '../streams/types';
import type { BingeHint } from './next';

const KEY = 'releaseChoices';
export const MAX_RELEASE_TITLES = 300;

/**
 * The release last played for one title: the addon that sent it, and the
 * names it goes by. Never a link, which can carry a debrid key.
 */
export interface ReleaseChoice {
  /** The title: a film's id, or a series' (all its episodes share it). */
  metaId: string;
  /** The addon's manifest id. */
  addonId: string;
  /** The addon's name for the release, such as "torrentio|1080p|WEB-DL". */
  bingeGroup?: string;
  /** The release group read from the stream's name, as facts give it ("flux"). */
  releaseGroup?: string;
}

/**
 * The release last played for each title, at most MAX_RELEASE_TITLES titles,
 * the least recently played dropped first, so Details, Continue Watching and
 * resume start the same release from the same addon (improvements list PL2).
 * Kept on this TV for the profile; not part of the BannerTV account.
 */
export interface ReleaseMemory {
  load(): Promise<void>;
  get(metaId: string): ReleaseChoice | undefined;
  /** Keeps the release of a stream that played, when it has a name to find it again by. */
  remember(metaId: string, entry: StreamEntry): Promise<void>;
  /** Told of every change, and once when the saved releases have been read. */
  subscribe(listener: Listener): () => void;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function readChoices(saved: unknown): ReleaseChoice[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const choices: ReleaseChoice[] = [];
  // Saved least recently played first; a later duplicate is the newer one.
  for (let i = saved.length - 1; i >= 0; i--) {
    const raw = saved[i] as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) continue;
    if (!isText(raw.metaId) || !isText(raw.addonId) || seen.has(raw.metaId)) continue;
    const choice: ReleaseChoice = { metaId: raw.metaId, addonId: raw.addonId };
    if (isText(raw.bingeGroup)) choice.bingeGroup = raw.bingeGroup;
    if (isText(raw.releaseGroup)) choice.releaseGroup = raw.releaseGroup;
    if (choice.bingeGroup === undefined && choice.releaseGroup === undefined) continue;
    seen.add(raw.metaId);
    choices.unshift(choice);
  }
  return choices.slice(-MAX_RELEASE_TITLES);
}

/** What a stream's release is known by, for the title; undefined when it names none. */
export function releaseChoice(metaId: string, entry: StreamEntry): ReleaseChoice | undefined {
  const bingeGroup = entry.stream.behaviorHints.bingeGroup;
  const releaseGroup = entry.facts.releaseGroup;
  if (!bingeGroup && !releaseGroup) return undefined;
  const choice: ReleaseChoice = { metaId, addonId: entry.addonId };
  if (bingeGroup) choice.bingeGroup = bingeGroup;
  if (releaseGroup) choice.releaseGroup = releaseGroup;
  return choice;
}

/** The release to try first when the title starts again, as the player's binge rule takes it. */
export function releaseHint(choice: ReleaseChoice | undefined): BingeHint | undefined {
  if (!choice) return undefined;
  const hint: BingeHint = { addonId: choice.addonId };
  if (choice.bingeGroup) hint.bingeGroup = choice.bingeGroup;
  if (choice.releaseGroup) hint.releaseGroup = choice.releaseGroup;
  return hint;
}

const same = (a: ReleaseChoice | undefined, b: ReleaseChoice) =>
  a !== undefined &&
  a.addonId === b.addonId &&
  a.bingeGroup === b.bingeGroup &&
  a.releaseGroup === b.releaseGroup;

export function createReleaseMemory(options: { storage: KeyValueStore }): ReleaseMemory {
  const state = createPersisted<readonly ReleaseChoice[]>({
    storage: options.storage,
    key: KEY,
    initial: [],
    read: readChoices,
    write: (choices) => choices.slice(),
  });

  return {
    load: state.load,
    get: (metaId) => state.get().find((choice) => choice.metaId === metaId),
    remember: (metaId, entry) => {
      const choice = releaseChoice(metaId, entry);
      if (!choice) return Promise.resolve();
      return state.update((current) => {
        const last = current[current.length - 1];
        if (last && last.metaId === metaId && same(last, choice)) return current;
        return current
          .filter((known) => known.metaId !== metaId)
          .concat(choice)
          .slice(-MAX_RELEASE_TITLES);
      });
    },
    subscribe: state.subscribe,
  };
}
