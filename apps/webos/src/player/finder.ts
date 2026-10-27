import {
  type AddonAnswer,
  assessStream,
  createStore,
  describeStream,
  type InstalledAddon,
  orderStreams,
  playableCandidates,
  type QueryState,
  type StreamEntry,
  type StreamOrder,
  type TvCapabilities,
} from '@bannertv/core';
import type { Stream } from '@bannertv/protocol';
import { addonClient } from '../data/addons';
import { preferences } from '../data/preferences';
import { sourceMemory } from '../data/playback';
import { knownCapabilities, tvCapabilities } from '../platform/capabilities';
import { cancelProbes, probeStream, type ProbeResult } from './probe';

/** Once one stream could play, slower addons get this much longer to offer a better one. */
export const SETTLE_AFTER_FIRST_MS = 2000;
/** Auto-play tests at most this many links before giving up and trusting the ranking. */
const PROBE_LIMIT = 3;
/** A finder is reused for this long, matching how long stream lists are cached. */
const FINDER_LIFETIME_MS = 5 * 60 * 1000;

export type ProbeState = 'testing' | ProbeResult;

export interface FinderState {
  /** Addons that have not answered yet. */
  pending: number;
  /** Addons that could not answer, in priority order. */
  failed: InstalledAddon[];
  /** Every stream so far, in the addons' own order. */
  entries: StreamEntry[];
  /** What auto-play would try, best first. */
  candidates: StreamEntry[];
  /** Results of testing links, by entryKey. */
  probes: Readonly<Record<string, ProbeState>>;
  /** Every addon has answered, or long enough has passed since the first playable stream. */
  settled: boolean;
}

export interface StreamFinder {
  get(): FinderState;
  subscribe(listener: () => void): () => void;
  /** Asks the addons, unless they already answered recently. */
  start(): void;
  /** Asks every addon again, for "Try again". */
  retry(): void;
  /** Tests the top candidates one at a time, in the background. Stops at the first that works. */
  probe(): void;
  /**
   * The stream auto-play should start: the best one known to work, else the
   * best ranked. Waits until the finder settles; undefined when nothing can
   * play.
   */
  choose(): Promise<StreamEntry | undefined>;
  /** The next candidate to fail over to, skipping links already tried or known to fail. */
  next(tried: ReadonlySet<string>): StreamEntry | undefined;
  /** A link that failed in the player, so it is not offered again for a while. */
  markFailed(entry: StreamEntry): void;
}

/** A stable key for a stream within its finder. Never contains the link, which can carry account keys. */
export function entryKey(entry: StreamEntry): string {
  return `${entry.addonId}#${entry.rank}`;
}

// Reading a stream's text is the costly part, and lists are rebuilt as each
// addon answers, so each stream object is read once.
const described = new WeakMap<
  Stream,
  { tv: TvCapabilities; entry: Omit<StreamEntry, 'addonRank'> }
>();

function buildEntries(
  answers: ReadonlyArray<AddonAnswer<Stream[]>>,
  tv: TvCapabilities,
): StreamEntry[] {
  const entries: StreamEntry[] = [];
  answers.forEach(({ addon, query }, addonRank) => {
    const streams = query.get().data ?? [];
    streams.forEach((stream, rank) => {
      let known = described.get(stream);
      if (!known || known.tv !== tv || known.entry.rank !== rank) {
        const facts = describeStream(stream);
        known = {
          tv,
          entry: {
            stream,
            addonId: addon.manifest.id,
            rank,
            facts,
            assessment: assessStream(stream, facts, tv),
          },
        };
        described.set(stream, known);
      }
      entries.push({ ...known.entry, addonRank });
    });
  });
  return entries;
}

function create(type: string, videoId: string): StreamFinder {
  let answers: ReadonlyArray<AddonAnswer<Stream[]>> = [];
  let started = false;
  let firstPlayableAt: number | null = null;
  let settleTimer: number | undefined;
  let probing = false;
  const failedLinks = new Set<string>();
  const probes: Record<string, ProbeState> = {};

  const state = createStore<FinderState>({
    pending: 0,
    failed: [],
    entries: [],
    candidates: [],
    probes: {},
    settled: false,
  });

  function rank(entries: readonly StreamEntry[]): StreamEntry[] {
    const memory = sourceMemory;
    return playableCandidates(entries, preferences.get().streamChoice, knownCapabilities(), {
      addonScore: (id) => memory.score(id),
    }).filter((entry) => !failedLinks.has(entryKey(entry)));
  }

  function refresh() {
    const states: Array<QueryState<Stream[]>> = answers.map((answer) => answer.query.get());
    const pending = states.filter((s) => s.status === 'idle' || s.status === 'loading').length;
    const failed = answers.filter((_, i) => states[i]!.status === 'error').map((a) => a.addon);
    const entries = buildEntries(answers, knownCapabilities());
    const candidates = rank(entries);
    if (candidates.length > 0 && firstPlayableAt === null) {
      firstPlayableAt = Date.now();
      settleTimer = window.setTimeout(refresh, SETTLE_AFTER_FIRST_MS);
    }
    const settled =
      started &&
      (pending === 0 ||
        (firstPlayableAt !== null && Date.now() - firstPlayableAt >= SETTLE_AFTER_FIRST_MS));
    if (settled && settleTimer !== undefined) {
      clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    state.set({ pending, failed, entries, candidates, probes: { ...probes }, settled });
  }

  async function runProbes() {
    if (probing) return;
    probing = true;
    try {
      for (let tested = 0; tested < PROBE_LIMIT;) {
        const candidate = state
          .get()
          .candidates.find((entry) => probes[entryKey(entry)] === undefined);
        if (!candidate || candidate.stream.source.kind !== 'url') return;
        if (state.get().candidates.some((entry) => probes[entryKey(entry)] === 'works')) return;
        const key = entryKey(candidate);
        probes[key] = 'testing';
        refresh();
        const result = await probeStream(candidate.stream.source.url);
        if (result === 'cancelled') {
          delete probes[key];
          refresh();
          return;
        }
        probes[key] = result;
        tested++;
        refresh();
      }
    } finally {
      probing = false;
    }
  }

  const finder: StreamFinder = {
    get: state.get,
    subscribe: state.subscribe,

    start() {
      if (started) {
        answers.forEach((answer) => answer.query.load());
        return;
      }
      started = true;
      answers = addonClient.streams(type, videoId);
      answers.forEach((answer) => {
        answer.query.subscribe(refresh);
        answer.query.load();
      });
      // Capabilities change the ranking, and arrive from the TV a moment after launch.
      void tvCapabilities().then(refresh);
      refresh();
    },

    retry() {
      if (!started) {
        finder.start();
        return;
      }
      failedLinks.clear();
      answers.forEach((answer) => answer.query.retry());
    },

    probe() {
      void runProbes();
    },

    choose() {
      finder.start();
      return new Promise((resolve) => {
        const decide = () => {
          const current = state.get();
          if (!current.settled) return false;
          const works = current.candidates.find((e) => probes[entryKey(e)] === 'works');
          const untried = current.candidates.find((e) => probes[entryKey(e)] !== 'failed');
          resolve(works ?? untried ?? current.candidates[0]);
          return true;
        };
        if (decide()) return;
        const unsubscribe = state.subscribe(() => {
          if (decide()) unsubscribe();
        });
      });
    },

    next(tried) {
      return state
        .get()
        .candidates.find(
          (entry) => !tried.has(entryKey(entry)) && probes[entryKey(entry)] !== 'failed',
        );
    },

    markFailed(entry) {
      failedLinks.add(entryKey(entry));
      refresh();
    },
  };
  return finder;
}

const finders = new Map<string, { finder: StreamFinder; createdAt: number }>();

/** The finder for one video, shared by Details (prefetch), the player and All streams. */
export function streamFinder(type: string, videoId: string): StreamFinder {
  const key = `${type}:${videoId}`;
  const now = Date.now();
  const existing = finders.get(key);
  if (existing && now - existing.createdAt < FINDER_LIFETIME_MS) return existing.finder;
  const finder = create(type, videoId);
  finders.set(key, { finder, createdAt: now });
  // Only a few videos are ever in play at once; drop the oldest.
  if (finders.size > 8) finders.delete(finders.keys().next().value!);
  return finder;
}

/** Stops any link test, before the player takes the TV's video decoder. */
export function stopProbing(): void {
  cancelProbes();
}

/** All streams, in the order the viewer picked for that list. */
export function listOrder(entries: readonly StreamEntry[], order: StreamOrder): StreamEntry[] {
  return orderStreams(entries, order, knownCapabilities(), {
    addonScore: (id) => sourceMemory.score(id),
  });
}
