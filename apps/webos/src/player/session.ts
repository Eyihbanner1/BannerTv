import {
  createProgressTracker,
  createStore,
  type Cue,
  estimateBitrate,
  type ProgressTracker,
  type StreamEntry,
} from '@bannertv/core';
import { bandwidth, progress, sourceMemory } from '../data/playback';
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
/**
 * Buffering this many times, or for this long in all, within the window means
 * the stream needs more data than the connection gives. Auto-play then steps
 * down to a lighter stream at the same place. Only pauses of a second or more
 * are counted towards the limit.
 */
export const REBUFFER_LIMIT = 3;
export const REBUFFER_TOTAL_MS = 15000;
export const REBUFFER_WINDOW_MS = 120000;
const COUNTED_REBUFFER_MS = 1000;
/** Buffering this soon after a jump is the jump's doing, not the connection's. */
export const SEEK_GRACE_MS = 10000;
/** Auto-play steps down to a lighter stream at most this many times. */
const MAX_STEP_DOWNS = 2;
/** This much playback in a row without buffering shows the connection keeps up with the stream. */
export const SMOOTH_AFTER_S = 600;

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
  /** Seconds; 0 while unknown, and for a live stream. */
  duration: number;
  /**
   * A live broadcast: nothing is saved to resume or continue, Up Next is off,
   * and another stream of it starts at the live edge.
   */
  live: boolean;
  error: PlaybackError | null;
  /** Set when auto-play moved to another stream after a failure, until playback resumes. */
  failedOver: boolean;
  /** Set when auto-play moved to a lighter stream because this one kept buffering, until playback resumes. */
  steppedDown: boolean;
  /**
   * The stream keeps buffering and the session will not leave it by itself:
   * the viewer chose it, or nothing lighter is left. Until another stream plays.
   */
  struggling: boolean;
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
  /**
   * Opens a stream at `startAt` seconds. `chosen`: the viewer picked this
   * stream, so it is not swapped for a lighter one when it buffers.
   */
  play(entry: StreamEntry, startAt: number, options?: { chosen?: boolean }): void;
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
  /**
   * Where another stream of this video starts (Quality, Other streams, Try
   * again): where playback is now, or the live edge (0) of a live stream,
   * whose clock means nothing on another source's.
   */
  carryOn(): number;
  /** Saves progress, stops the stream and frees the decoder. */
  destroy(): void;
}

export const INITIAL_SESSION_STATE: SessionState = {
  status: 'idle',
  entry: null,
  engine: null,
  position: 0,
  duration: 0,
  live: false,
  error: null,
  failedOver: false,
  steppedDown: false,
  struggling: false,
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
  let stepDowns = 0;
  let startedPlaying = false;
  // The viewer picked the stream playing now (the Quality menu), so buffering does not replace it.
  let viewerChose = false;
  // Buffering of this attempt that the connection caused: when each began and how long it lasted.
  let rebuffers: Array<{ at: number; ms: number }> = [];
  let bufferingSince: number | undefined;
  let lastSeekAt = -Infinity;
  let judgedStruggling = false;
  // Seconds played since the last buffering, and whether this attempt has been judged smooth.
  let smoothFor = 0;
  let lastPosition: number | undefined;
  let judgedSmooth = false;
  // The limit before this attempt's smooth play raised it, so a later struggle undoes the raise.
  let limitBefore: number | undefined;
  // Set from pause() until resume(), so an engine starting the stream does not undo it.
  let pausedByViewer = false;
  let reportedWorked = false;
  let stallTimer: number | undefined;
  let startTimer: number | undefined;
  // Judges a wait still going on, once it alone would make the stream count as struggling.
  let judgeTimer: number | undefined;
  let destroyed = false;
  // Whether this attempt's stream is live, once the engine can tell; and where its clock started.
  let live = false;
  let firstTrusted: number | undefined;
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
    clearTimeout(judgeTimer);
    stallTimer = undefined;
    startTimer = undefined;
    judgeTimer = undefined;
  }

  /**
   * Once the engine says the stream is live, it stays live for this attempt.
   * Only the engine can tell: a film whose file leaves its length out has
   * none either.
   */
  function checkLive() {
    if (live || engine?.isLive() !== true) return;
    live = true;
    patch({ live: true, duration: 0 });
    if (!keep) return;
    // An older build saved broadcasts like films, with a place to resume.
    progress.clear(videoId);
    // Opened at that place: start again at the live edge, once.
    if (lastStartAt > 0) {
      const current = attempt;
      const entry = state.get().entry;
      const chosen = viewerChose;
      window.setTimeout(() => {
        if (current === attempt && !destroyed && entry) session.play(entry, 0, { chosen });
      }, 0);
    }
  }

  const durationNow = () => (live || !isFinite(video.duration) ? 0 : video.duration);

  /**
   * The length saved with the position. A film whose file gives no length
   * is saved against the title's running time, so it can still resume.
   */
  function savedLength(): number {
    if (live) return 0;
    if (video.duration === Infinity) return finder.runtimeSeconds();
    return durationNow();
  }

  /**
   * Where another stream starts: here, or the live edge of a live one. A jump
   * made before the first picture is not a place yet: the stream may still
   * turn out to be live, or never start.
   */
  function carryOn(): number {
    if (live) return 0;
    return startedPlaying ? (tracker?.position() ?? lastStartAt) : lastStartAt;
  }

  function save() {
    checkLive();
    // A live broadcast has nothing to come back to. Nor has a stream whose
    // length is not known yet, or one let go of: its element reads 0.
    if (live || !engine) return;
    const position = tracker?.position();
    const duration = savedLength();
    if (position === undefined || !(duration > 0)) return;
    if (keep) progress.record({ metaId, type, videoId, position, duration });
  }

  function fail(error: PlaybackError, current: number) {
    if (current !== attempt || destroyed) return;
    clearTimers();
    // While the stream still has its length: letting it go resets the element.
    save();
    const entry = state.get().entry;
    if (entry) {
      if (keep) sourceMemory.record(entry.addonId, false);
      finder.markFailed(entry);
    }
    const resumeAt = carryOn();
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

  /**
   * The stream's average bitrate: its size over the video's length, or over
   * the title's running time when that gives less. Auto-play ranks by the
   * running time, so a limit learnt from a higher figure could still leave
   * the stream that struggled ranked within it.
   */
  function bitrateOf(entry: StreamEntry): number | undefined {
    const byRuntime = estimateBitrate(entry.facts, finder.runtimeSeconds());
    const duration = durationNow() > 0 ? durationNow() : undefined;
    const byDuration = estimateBitrate(entry.facts, duration);
    if (byRuntime === undefined || byDuration === undefined) return byRuntime ?? byDuration;
    return Math.min(byRuntime, byDuration);
  }

  /** Closes the buffering in progress, if the connection caused it. True when there was one. */
  function endBuffering(): boolean {
    if (bufferingSince === undefined) return false;
    const last = rebuffers[rebuffers.length - 1];
    if (last) last.ms = Date.now() - bufferingSince;
    bufferingSince = undefined;
    return true;
  }

  /**
   * Called as each buffering ends. A stream that keeps buffering is too heavy
   * for the connection: the limit is lowered for next time, and auto-play
   * moves to a lighter stream at the same place.
   */
  function judgeBuffering(current: number) {
    if (current !== attempt || destroyed || judgedStruggling) return;
    const now = Date.now();
    const recent = rebuffers.filter((r) => now - r.at <= REBUFFER_WINDOW_MS);
    const counted = recent.filter((r) => r.ms >= COUNTED_REBUFFER_MS).length;
    const total = recent.reduce((sum, r) => sum + r.ms, 0);
    if (counted < REBUFFER_LIMIT && total < REBUFFER_TOTAL_MS) return;
    judgedStruggling = true;
    clearTimeout(judgeTimer);
    judgeTimer = undefined;
    const entry = state.get().entry;
    if (!entry) return;
    const bitrate = bitrateOf(entry);
    // Never above the limit this stream started with, even if its first minutes played smoothly.
    if (bitrate !== undefined && keep) bandwidth.struggled(bitrate, limitBefore);
    const lighter =
      options.autoFailover && !viewerChose && stepDowns < MAX_STEP_DOWNS
        ? finder.lighter(entry, tried)
        : undefined;
    if (!lighter) {
      patch({ struggling: true });
      return;
    }
    stepDowns++;
    session.play(lighter, carryOn());
    patch({ steppedDown: true });
  }

  function armStall(current: number) {
    clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      // A wait this long on a stream that has been buffering is the connection's: step down first.
      if (endBuffering()) judgeBuffering(current);
      if (current !== attempt || destroyed) return;
      fail(new PlaybackError('network', 'The stream stopped loading'), current);
    }, STALL_MS);
  }

  /**
   * Arms the judgement of a wait that has just begun, for the moment it would
   * tip the stream into struggling: when it reaches a second as the third
   * counted wait, or when it brings the window's buffering to the limit.
   */
  function armJudge(current: number, now: number) {
    const earlier = rebuffers.filter(
      (r) => r !== rebuffers[rebuffers.length - 1] && now - r.at <= REBUFFER_WINDOW_MS,
    );
    const counted = earlier.filter((r) => r.ms >= COUNTED_REBUFFER_MS).length;
    const total = earlier.reduce((sum, r) => sum + r.ms, 0);
    const delay =
      counted >= REBUFFER_LIMIT - 1
        ? COUNTED_REBUFFER_MS
        : Math.max(COUNTED_REBUFFER_MS, REBUFFER_TOTAL_MS - total);
    clearTimeout(judgeTimer);
    judgeTimer = window.setTimeout(() => {
      judgeTimer = undefined;
      if (current !== attempt || bufferingSince === undefined) return;
      // The wait stays open: 'playing' closes it with its full length.
      const last = rebuffers[rebuffers.length - 1];
      if (last) last.ms = Date.now() - bufferingSince;
      judgeBuffering(current);
    }, delay);
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
        if (startedPlaying) return;
        // hls.js, Shaka and the TV's player call play() once ready: the viewer's pause stands.
        if (pausedByViewer) {
          video.pause();
          return;
        }
        // The start clock stopped while the viewer paused before the first picture.
        const { status } = state.get();
        if (startTimer === undefined && (status === 'loading' || status === 'paused')) {
          if (status === 'paused') patch({ status: 'loading' });
          armStart(attempt);
        }
      },
    ],
    [
      'playing',
      () => {
        clearTimers();
        startedPlaying = true;
        const buffered = endBuffering();
        patch({ status: 'playing', failedOver: false, steppedDown: false, error: null });
        if (buffered) judgeBuffering(attempt);
      },
    ],
    [
      'pause',
      () => {
        if (state.get().status === 'ended') return;
        clearTimeout(stallTimer);
        clearTimeout(judgeTimer);
        stallTimer = undefined;
        judgeTimer = undefined;
        endBuffering();
        save();
        // Before the first picture too, so the loading screen gives way to Play.
        if (startedPlaying || pausedByViewer) patch({ status: 'paused' });
      },
    ],
    [
      'waiting',
      () => {
        // A starved stream's 'waiting' can arrive just after the viewer paused it.
        if (!startedPlaying || video.paused) return;
        patch({ status: 'buffering' });
        armStall(attempt);
        const now = Date.now();
        if (bufferingSince !== undefined || video.seeking || now - lastSeekAt < SEEK_GRACE_MS) {
          return;
        }
        bufferingSince = now;
        rebuffers.push({ at: now, ms: 0 });
        smoothFor = 0;
        armJudge(attempt, now);
      },
    ],
    [
      'seeking',
      () => {
        // A wait under way ends here: what follows is the jump's.
        endBuffering();
        clearTimeout(judgeTimer);
        judgeTimer = undefined;
        lastSeekAt = Date.now();
      },
    ],
    [
      'timeupdate',
      () => {
        // A stream let go of resets the element to 0, which is no place in the video.
        if (!engine) return;
        checkLive();
        const position = video.currentTime;
        const duration = durationNow();
        if (tracker?.update(position, Date.now())) save();
        const trusted = tracker?.position();
        if (trusted !== undefined && firstTrusted === undefined) firstTrusted = trusted;
        // A live stream's clock starts wherever the broadcast is.
        const playedFrom = live ? (firstTrusted ?? lastStartAt) : lastStartAt;
        if (!reportedWorked && trusted !== undefined && trusted - playedFrom >= WORKED_AFTER_S) {
          reportedWorked = true;
          const entry = state.get().entry;
          if (entry && keep) sourceMemory.record(entry.addonId, true);
        }
        // Ten minutes in a row without buffering: the connection keeps up with this stream.
        if (trusted !== undefined && lastPosition !== undefined) {
          const step = trusted - lastPosition;
          if (step > 0 && step < 5) smoothFor += step;
        }
        lastPosition = trusted;
        // A stream already judged struggling says nothing good about the connection.
        if (!judgedSmooth && !judgedStruggling && smoothFor >= SMOOTH_AFTER_S) {
          judgedSmooth = true;
          const entry = state.get().entry;
          const bitrate = entry && bitrateOf(entry);
          if (bitrate && keep) {
            limitBefore = bandwidth.maxBitrate();
            bandwidth.smooth(bitrate);
          }
        }
        // Until the clock settles (webOS reads 0 right after a resume), show the start point.
        patch({ position: trusted ?? lastStartAt, duration });
      },
    ],
    [
      'durationchange',
      () => {
        checkLive();
        patch({ duration: durationNow() });
      },
    ],
    [
      'ended',
      () => {
        clearTimers();
        if (live) {
          patch({ status: 'ended' });
          return;
        }
        const duration = savedLength();
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

    play(entry, startAt, playOptions) {
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
      pausedByViewer = false;
      reportedWorked = false;
      viewerChose = playOptions?.chosen === true;
      rebuffers = [];
      bufferingSince = undefined;
      judgedStruggling = false;
      smoothFor = 0;
      lastPosition = undefined;
      judgedSmooth = false;
      limitBefore = undefined;
      live = false;
      firstTrusted = undefined;
      patch({
        status: 'loading',
        entry,
        engine: null,
        position: startAt,
        live: false,
        error: null,
        failedOver: false,
        steppedDown: false,
        struggling: false,
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
      session.play(next, carryOn());
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
      pausedByViewer = true;
      video.pause();
    },

    resume() {
      const { status, entry } = state.get();
      if (status === 'ended' && entry) {
        session.seek(0);
      }
      pausedByViewer = false;
      video.play().catch(() => undefined);
    },

    seek(position) {
      const duration = isFinite(video.duration) ? video.duration : Infinity;
      const target = Math.max(0, Math.min(position, duration - 1));
      endBuffering();
      clearTimeout(judgeTimer);
      judgeTimer = undefined;
      lastSeekAt = Date.now();
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

    carryOn,

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
