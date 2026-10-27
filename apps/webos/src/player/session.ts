import {
  createProgressTracker,
  createStore,
  type Cue,
  type ProgressTracker,
  type StreamEntry,
} from '@bannertv/core';
import { progress, sourceMemory } from '../data/playback';
import { chooseEngine, createEngine, type EngineName, fallbackEngine } from './engines/choose';
import { type Engine, type EngineTrack, PlaybackError } from './engines/types';
import { entryKey, type StreamFinder } from './finder';

/** Waiting longer than this mid-play counts as a stall, and auto-play moves on. */
export const STALL_MS = 20000;
/** A stream that has not started after this long is given up on. */
export const START_TIMEOUT_MS = 30000;
/** Auto-play moves to another stream at most this many times before asking the user. */
export const MAX_FAILOVERS = 3;
/** After this much playback a source counts as having worked. */
const WORKED_AFTER_S = 30;

export type SessionStatus =
  /** Nothing loaded: still choosing a stream, or asking where to start. */
  | 'idle'
  /** A stream is opening; nothing has played yet. */
  | 'loading'
  | 'playing'
  | 'paused'
  /** Waiting for data after playback had started. */
  | 'buffering'
  | 'ended'
  /** Nothing more to try: the user decides. */
  | 'failed';

export interface SessionState {
  status: SessionStatus;
  entry: StreamEntry | null;
  engine: Engine['name'] | null;
  /** Seconds, refreshed with the media clock. */
  position: number;
  duration: number;
  error: PlaybackError | null;
  /** Set when auto-play moved to another stream after a failure, until playback resumes. */
  failedOver: boolean;
  audio: EngineTrack[];
  text: EngineTrack[];
  /** Cues from the stream's own subtitle tracks, by track id. */
  streamCues: Readonly<Record<string, Cue[]>>;
}

export interface SessionOptions {
  video: HTMLVideoElement;
  type: string;
  metaId: string;
  videoId: string;
  /** Where failover finds the next stream. */
  finder: StreamFinder;
  /** Whether the session may move to another stream by itself. False when the user chose one. */
  autoFailover: boolean;
  /** Whether progress and the addon's record are kept. False for the Lab's test streams. */
  remember?: boolean;
}

export interface PlaybackSession {
  get(): SessionState;
  subscribe(listener: () => void): () => void;
  /** Opens a stream at `startAt` seconds. */
  play(entry: StreamEntry, startAt: number): void;
  /** Moves to the best stream not tried yet, where playback is now. False when none is left. */
  playNext(): boolean;
  /** Whether playNext has somewhere to go. */
  hasNext(): boolean;
  togglePlay(): void;
  pause(): void;
  resume(): void;
  /** Seconds. Clamped to the video. */
  seek(position: number): void;
  selectAudio(id: string): void;
  selectText(id: string | null): void;
  /** Saves where playback is now, for leaving or hiding the app. */
  saveProgress(): void;
  /** The trusted position: never the 0 that webOS reads right after a resume. */
  trustedPosition(): number | undefined;
  /** Saves progress, stops the stream and frees the decoder. */
  destroy(): void;
}

export const INITIAL_SESSION_STATE: SessionState = {
  status: 'idle',
  entry: null,
  engine: null,
  position: 0,
  duration: 0,
  error: null,
  failedOver: false,
  audio: [],
  text: [],
  streamCues: {},
};

export function createPlaybackSession(options: SessionOptions): PlaybackSession {
  const { video, type, metaId, videoId, finder } = options;
  const keep = options.remember !== false;
  const state = createStore<SessionState>(INITIAL_SESSION_STATE);
  const tried = new Set<string>();
  let engine: Engine | null = null;
  let tracker: ProgressTracker | null = null;
  // Each play() is one attempt; events from an older attempt are ignored.
  let attempt = 0;
  let failovers = 0;
  let startedPlaying = false;
  let reportedWorked = false;
  let stallTimer: number | undefined;
  let startTimer: number | undefined;
  let destroyed = false;
  // The viewer's tracks for this stream, chosen again when another engine opens it (Try again).
  let wantedAudio: string | null = null;
  let wantedText: string | null = null;
  // Shaka lets go of the video element asynchronously; the next engine waits for it.
  let releasing: Promise<void> = Promise.resolve();

  function release() {
    const old = engine;
    engine = null;
    if (!old) return;
    releasing = releasing.then(() => old.destroy()).catch(() => undefined);
  }

  const patch = (next: Partial<SessionState>) => state.set((s) => ({ ...s, ...next }));

  function clearTimers() {
    clearTimeout(stallTimer);
    clearTimeout(startTimer);
    stallTimer = undefined;
    startTimer = undefined;
  }

  function save() {
    const position = tracker?.position();
    if (position === undefined) return;
    const duration = isFinite(video.duration) ? video.duration : 0;
    if (keep) progress.record({ metaId, type, videoId, position, duration });
  }

  function fail(error: PlaybackError, current: number) {
    if (current !== attempt || destroyed) return;
    clearTimers();
    const entry = state.get().entry;
    if (entry) {
      if (keep) sourceMemory.record(entry.addonId, false);
      finder.markFailed(entry);
    }
    const resumeAt = tracker?.position() ?? lastStartAt;
    const next = options.autoFailover && failovers < MAX_FAILOVERS ? finder.next(tried) : undefined;
    if (next) {
      failovers++;
      session.play(next, resumeAt);
      patch({ failedOver: true });
      return;
    }
    release();
    patch({ status: 'failed', error });
  }

  let lastStartAt = 0;

  function armStall(current: number) {
    clearTimeout(stallTimer);
    stallTimer = window.setTimeout(
      () => fail(new PlaybackError('network', 'The stream stopped loading'), current),
      STALL_MS,
    );
  }

  function armStart(current: number) {
    clearTimeout(startTimer);
    startTimer = window.setTimeout(
      () => fail(new PlaybackError('network', 'The stream did not start'), current),
      START_TIMEOUT_MS,
    );
  }

  const handlers: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
    [
      'play',
      () => {
        // The start clock stopped while the viewer paused before the first picture.
        if (!startedPlaying && startTimer === undefined && state.get().status === 'loading') {
          armStart(attempt);
        }
      },
    ],
    [
      'playing',
      () => {
        clearTimers();
        startedPlaying = true;
        patch({ status: 'playing', failedOver: false, error: null });
      },
    ],
    [
      'pause',
      () => {
        if (state.get().status === 'ended') return;
        save();
        if (startedPlaying) patch({ status: 'paused' });
      },
    ],
    [
      'waiting',
      () => {
        if (!startedPlaying) return;
        patch({ status: 'buffering' });
        armStall(attempt);
      },
    ],
    [
      'timeupdate',
      () => {
        const position = video.currentTime;
        const duration = isFinite(video.duration) ? video.duration : 0;
        if (tracker?.update(position, Date.now())) save();
        const trusted = tracker?.position();
        if (!reportedWorked && trusted !== undefined && trusted - lastStartAt >= WORKED_AFTER_S) {
          reportedWorked = true;
          const entry = state.get().entry;
          if (entry && keep) sourceMemory.record(entry.addonId, true);
        }
        // Until the clock settles (webOS reads 0 right after a resume), show the start point.
        patch({ position: trusted ?? lastStartAt, duration });
      },
    ],
    ['durationchange', () => patch({ duration: isFinite(video.duration) ? video.duration : 0 })],
    [
      'ended',
      () => {
        clearTimers();
        const duration = isFinite(video.duration) ? video.duration : 0;
        if (keep) progress.record({ metaId, type, videoId, position: duration, duration });
        patch({ status: 'ended', position: duration });
      },
    ],
  ];
  handlers.forEach(([event, handler]) => video.addEventListener(event, handler));

  function refreshTracks() {
    if (!engine) return;
    patch({ audio: engine.audioTracks(), text: engine.textTracks() });
  }

  /** A new engine starts on the stream's default tracks, so the viewer's are chosen again. */
  function reapplyTracks() {
    const text = wantedText;
    const audio = wantedAudio;
    if (!engine) return;
    if (text !== null && engine.textTracks().some((t) => t.id === text && !t.active)) {
      engine.selectText(text);
    }
    if (audio !== null && engine.audioTracks().some((t) => t.id === audio && !t.active)) {
      engine.selectAudio(audio);
    }
  }

  const session: PlaybackSession = {
    get: state.get,
    subscribe: state.subscribe,

    play(entry, startAt) {
      if (destroyed || entry.stream.source.kind !== 'url') return;
      // By key: the finder rebuilds its entries as addons answer, so Try again may get a new object.
      const previous = state.get().entry;
      if (!previous || entryKey(previous) !== entryKey(entry)) {
        wantedAudio = null;
        wantedText = null;
      }
      const current = ++attempt;
      const url = entry.stream.source.url;
      tried.add(entryKey(entry));
      clearTimers();
      release();
      tracker = createProgressTracker({ startAt });
      lastStartAt = startAt;
      startedPlaying = false;
      reportedWorked = false;
      patch({
        status: 'loading',
        entry,
        engine: null,
        position: startAt,
        error: null,
        audio: [],
        text: [],
        streamCues: {},
      });
      armStart(current);

      const engines = new Set<EngineName>();
      const seenCues: Record<string, Record<string, true>> = {};
      const open = async (name: EngineName) => {
        if (current !== attempt || destroyed) return;
        engines.add(name);
        const listener = {
          tracks: () => {
            if (current !== attempt) return;
            reapplyTracks();
            refreshTracks();
          },
          cues: (trackId: string, cues: Cue[]) => {
            if (current !== attempt) return;
            // hls.js sends a track's cues again after an audio switch; Shaka can overlap.
            const seen = (seenCues[trackId] = seenCues[trackId] ?? {});
            const fresh = cues.filter((cue) => {
              const key = `${cue.start}|${cue.end}|${cue.lines.map((l) => l.map((s) => s.text).join('')).join('\n')}`;
              if (seen[key]) return false;
              seen[key] = true;
              return true;
            });
            if (fresh.length === 0) return;
            const known = state.get().streamCues[trackId] ?? [];
            patch({ streamCues: { ...state.get().streamCues, [trackId]: known.concat(fresh) } });
          },
          fatal: (error: PlaybackError) => {
            if (current !== attempt) return;
            // One HLS engine refused the stream before it played: the other may still open it.
            const fallback = startedPlaying ? undefined : fallbackEngine(name, url, engines);
            if (fallback) {
              release();
              void open(fallback);
            } else {
              fail(error, current);
            }
          },
        };
        try {
          release();
          await releasing;
          if (current !== attempt || destroyed) return;
          const created = createEngine(name, video, listener);
          if (current !== attempt || destroyed) {
            await created.destroy();
            return;
          }
          engine = created;
          patch({ engine: created.name });
          await created.load(url, startAt);
        } catch (error) {
          listener.fatal(
            error instanceof PlaybackError ? error : new PlaybackError('other', String(error)),
          );
        }
      };
      void chooseEngine(url).then(open);
    },

    playNext() {
      const next = finder.next(tried);
      if (!next) return false;
      session.play(next, tracker?.position() ?? lastStartAt);
      return true;
    },

    hasNext: () => finder.next(tried) !== undefined,

    togglePlay() {
      if (video.paused) session.resume();
      else session.pause();
    },

    pause() {
      // Neither clock runs while the viewer pauses: a paused stream is not a stalled one.
      clearTimeout(stallTimer);
      stallTimer = undefined;
      if (!startedPlaying) {
        clearTimeout(startTimer);
        startTimer = undefined;
      }
      video.pause();
    },

    resume() {
      const { status, entry } = state.get();
      if (status === 'ended' && entry) {
        session.seek(0);
      }
      video.play().catch(() => undefined);
    },

    seek(position) {
      const duration = isFinite(video.duration) ? video.duration : Infinity;
      const target = Math.max(0, Math.min(position, duration - 1));
      video.currentTime = target;
      tracker?.seeked(target);
      patch({ position: target });
      save();
    },

    selectAudio(id) {
      wantedAudio = id;
      engine?.selectAudio(id);
      refreshTracks();
    },

    selectText(id) {
      wantedText = id;
      engine?.selectText(id);
      refreshTracks();
    },

    saveProgress: save,

    trustedPosition: () => tracker?.position(),

    destroy() {
      if (destroyed) return;
      save();
      destroyed = true;
      clearTimers();
      handlers.forEach(([event, handler]) => video.removeEventListener(event, handler));
      release();
    },
  };
  return session;
}
