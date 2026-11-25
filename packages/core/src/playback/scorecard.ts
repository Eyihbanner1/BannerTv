/**
 * The playback scorecard: for each video played on this screen, how long the
 * picture took, how often and how long it stopped to load, what auto-play
 * had to do (fail over, step down, open the same stream again) and whether
 * the viewer changed the audio or the subtitles soon after it started, a
 * sign that the automatic choice was wrong. Diagnostics shows the last plays
 * and their averages against BannerTV's own targets. Numbers only: never a
 * link, a title or a file name.
 */
import type { KeyValueStore } from '../storage';
import { createStore, type Listener } from '../store';

/** A picture this soon after the player opens counts as a quick start. */
export const TARGET_START_MS = 2000;
/** The viewer changing the audio or the subtitles within this much playback counts as a wrong pick. */
export const EARLY_CHANGE_S = 120;
/** The plays kept, newest first. */
export const MAX_PLAYS = 50;

const STORAGE_KEY = 'playback-scorecard';
const STORED_VERSION = 1;

/** What was played: a film, an episode, a live broadcast, or anything else (a replay, a clip). */
export type PlayKind = 'film' | 'episode' | 'live' | 'other';

/**
 * played: the picture came. failed: nothing more to try, the problem box
 * showed. left: the viewer went back before the first picture.
 */
export type PlayOutcome = 'played' | 'failed' | 'left';

export interface PlayRecord {
  /** When the player opened, in milliseconds since 1970. */
  at: number;
  kind: PlayKind;
  outcome: PlayOutcome;
  /** From the player opening to the first picture, in milliseconds; none when no picture came. */
  startMs?: number;
  /** Seconds of video played, on every stream of the play. */
  playedS: number;
  /** Waits for data during playback (not those a jump caused) of a second or more. */
  waits: number;
  /** How long playback waited for data in all, in milliseconds. */
  waitMs: number;
  /** Streams auto-play moved on from because they failed. */
  failovers: number;
  /** Streams auto-play moved on from because they kept buffering. */
  stepDowns: number;
  /** Times the same stream was opened again after it stopped, or after the connection came back. */
  retries: number;
  /** The viewer chose another audio track within EARLY_CHANGE_S of playback. */
  audioChanged: boolean;
  /** The viewer chose other subtitles, or moved their timing, within EARLY_CHANGE_S of playback. */
  subtitlesChanged: boolean;
}

export interface ScorecardSummary {
  /** Plays counted: those with a picture or that failed, not those left before the picture. */
  plays: number;
  /** Plays left before the first picture. */
  left: number;
  failed: number;
  /** Middle start time of the plays with a picture, in milliseconds; none when there are none. */
  medianStartMs?: number;
  /** Share of the plays with a picture that started within TARGET_START_MS, 0 to 1. */
  quickStarts?: number;
  /** Hours of video played. */
  hours: number;
  /** Waits of a second or more per hour played; none under six minutes played. */
  waitsPerHour?: number;
  /** Seconds of waiting per hour played; none under six minutes played. */
  waitSecondsPerHour?: number;
  failovers: number;
  stepDowns: number;
  retries: number;
  /** Plays where the viewer changed the audio soon after the start. */
  audioChanged: number;
  /** Plays where the viewer changed the subtitles or their timing soon after the start. */
  subtitlesChanged: number;
}

export interface PlayScorecard {
  /** Reads the plays kept on this screen. Plays recorded meanwhile stay, newest first. */
  load(): Promise<void>;
  /** The plays kept, newest first. */
  plays(): readonly PlayRecord[];
  /** Keeps one play, as its player closes. False when it was not a play worth keeping. */
  record(play: PlayRecord): boolean;
  subscribe(listener: Listener): () => void;
}

const KINDS: readonly PlayKind[] = ['film', 'episode', 'live', 'other'];
const OUTCOMES: readonly PlayOutcome[] = ['played', 'failed', 'left'];

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && isFinite(value) && value >= 0 ? value : undefined;

/** A play as stored, or undefined when anything about it is not what a play holds. */
function readPlay(value: unknown): PlayRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const at = count(raw.at);
  const kind = KINDS.find((k) => k === raw.kind);
  const outcome = OUTCOMES.find((o) => o === raw.outcome);
  const playedS = count(raw.playedS);
  const waits = count(raw.waits);
  const waitMs = count(raw.waitMs);
  const failovers = count(raw.failovers);
  const stepDowns = count(raw.stepDowns);
  const retries = count(raw.retries);
  if (
    at === undefined ||
    !kind ||
    !outcome ||
    playedS === undefined ||
    waits === undefined ||
    waitMs === undefined ||
    failovers === undefined ||
    stepDowns === undefined ||
    retries === undefined
  ) {
    return undefined;
  }
  const play: PlayRecord = {
    at,
    kind,
    outcome,
    playedS,
    waits,
    waitMs,
    failovers,
    stepDowns,
    retries,
    audioChanged: raw.audioChanged === true,
    subtitlesChanged: raw.subtitlesChanged === true,
  };
  const startMs = count(raw.startMs);
  if (startMs !== undefined && outcome !== 'left') play.startMs = startMs;
  return play;
}

function readStored(stored: unknown): PlayRecord[] {
  if (typeof stored !== 'object' || stored === null) return [];
  const { v, plays } = stored as { v?: unknown; plays?: unknown };
  if (v !== STORED_VERSION || !Array.isArray(plays)) return [];
  const read: PlayRecord[] = [];
  for (const play of plays) {
    const kept = readPlay(play);
    if (kept) read.push(kept);
  }
  return read.slice(0, MAX_PLAYS);
}

/** The middle value, the mean of the two middle ones for an even count. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Under this much playback, waits per hour say more about chance than the connection. */
const MIN_HOURS_FOR_RATES = 0.1;

/** The plays' averages, as Diagnostics shows them against the targets. */
export function summarisePlays(plays: readonly PlayRecord[]): ScorecardSummary {
  const counted = plays.filter((play) => play.outcome !== 'left');
  const starts = counted.map((play) => play.startMs).filter((ms): ms is number => ms !== undefined);
  const seconds = counted.reduce((sum, play) => sum + play.playedS, 0);
  const hours = seconds / 3600;
  const sum = (pick: (play: PlayRecord) => number) =>
    counted.reduce((total, play) => total + pick(play), 0);
  const summary: ScorecardSummary = {
    plays: counted.length,
    left: plays.length - counted.length,
    failed: counted.filter((play) => play.outcome === 'failed').length,
    hours,
    failovers: sum((play) => play.failovers),
    stepDowns: sum((play) => play.stepDowns),
    retries: sum((play) => play.retries),
    audioChanged: counted.filter((play) => play.audioChanged).length,
    subtitlesChanged: counted.filter((play) => play.subtitlesChanged).length,
  };
  const middle = median(starts);
  if (middle !== undefined) {
    summary.medianStartMs = middle;
    summary.quickStarts = starts.filter((ms) => ms <= TARGET_START_MS).length / starts.length;
  }
  if (hours >= MIN_HOURS_FOR_RATES) {
    summary.waitsPerHour = sum((play) => play.waits) / hours;
    summary.waitSecondsPerHour = sum((play) => play.waitMs) / 1000 / hours;
  }
  return summary;
}

/**
 * The plays of this screen, shared by its profiles and kept on it only: what
 * a screen's connection and decoder do is the screen's, not the account's.
 */
export function createPlayScorecard(options: { storage: KeyValueStore }): PlayScorecard {
  const { storage } = options;
  const state = createStore<readonly PlayRecord[]>([]);
  let loading: Promise<void> | undefined;
  let writing = false;
  let dirty = false;

  function load(): Promise<void> {
    if (!loading) {
      loading = Promise.resolve()
        .then(() => storage.get(STORAGE_KEY))
        .then((stored) => {
          // Plays recorded while loading are newer than the stored ones.
          state.set([...state.get(), ...readStored(stored)].slice(0, MAX_PLAYS));
        })
        .catch(() => undefined);
    }
    return loading;
  }

  // Writes wait for the stored plays to be merged in, or a play recorded early
  // would replace every play kept from earlier launches.
  function write() {
    if (writing) {
      dirty = true;
      return;
    }
    writing = true;
    dirty = false;
    void load()
      .then(() => storage.set(STORAGE_KEY, { v: STORED_VERSION, plays: state.get() }))
      .catch(() => undefined)
      .then(() => {
        writing = false;
        if (dirty) write();
      });
  }

  return {
    load,
    plays: state.get,
    record(play) {
      const kept = readPlay(play);
      if (!kept) return false;
      state.set([kept, ...state.get()].slice(0, MAX_PLAYS));
      write();
      return true;
    },
    subscribe: state.subscribe,
  };
}
