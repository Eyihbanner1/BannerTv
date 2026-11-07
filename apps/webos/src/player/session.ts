import {
  clampToWindow,
  createProgressTracker,
  createStore,
  type Cue,
  estimateBitrate,
  isMuchShorter,
  judgeLive,
  type LiveWindow,
  type ProgressTracker,
  type ProgressUpdate,
  type QualityReference,
  type StreamEntry,
} from '@bannertv/core';
import { bandwidth, progress, sourceMemory } from '../data/playback';
import { tuning } from '../platform/tuning';
import { chooseEngine, createEngine, type EngineName, fallbackEngine } from './engines/choose';
import { type Engine, type EngineTrack, PlaybackError } from './engines/types';
import { entryKey, type StreamFinder } from './finder';
import {
  createLandingWatch,
  LANDING_SETTLE_MS,
  type LandingBounds,
  landingStream,
  readLandingMode,
  showLandings,
} from './landing';
import { rewindWindow, shouldReturnToLive } from './live';
import { playMark } from './play-marks';

/** Waiting longer than this mid-play counts as a stall, and auto-play moves on. */
export const STALL_MS = 20000;
/** A stream that has not started after this long is given up on. */
export const START_TIMEOUT_MS = 30000;
/** Auto-play moves to another stream at most this many times before asking the user. */
export const MAX_FAILOVERS = 3;
/** HTMLMediaElement.HAVE_METADATA: the element knows the stream's length and size. */
const HAVE_METADATA = 1;
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
/** How often a broadcast is judged against live, so it falls behind while paused too. */
export const LIVE_TICK_MS = 1000;

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
  /** On a broadcast, what it still keeps and where it plays live, when the engine can tell. */
  liveWindow: LiveWindow | null;
  /** Seconds behind live on a broadcast: 0 while it counts as live, or when nobody can tell. */
  behind: number;
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
  /** The playback speed; every stream starts at 1. */
  rate: number;
  /**
   * The stream turned out a short clip of the video (a sample, a trailer, a
   * debrid service's "not ready yet"), played only because the viewer picked
   * it: nothing it plays counts as watching the video.
   */
  clip: boolean;
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
  /**
   * Whether the progress kept may put the video on Continue Watching. False
   * for a sports event: its place is kept, but the row would ask addons that
   * never listed it for its page and streams.
   */
  continueRow?: boolean;
}

export interface PlaybackSession {
  get(): SessionState;
  subscribe(listener: () => void): () => void;
  /**
   * Opens a stream at `startAt` seconds. `chosen`: the viewer picked this
   * stream, so it is not swapped for a lighter one when it buffers. `paused`:
   * the viewer had paused the one it replaces (Quality), so it opens paused.
   * `handPicked`: the viewer picked it from a list (Sources), so it does not
   * fail over to another either; the problem box says it won't play.
   */
  play(
    entry: StreamEntry,
    startAt: number,
    options?: { chosen?: boolean; paused?: boolean; handPicked?: boolean },
  ): void;
  /** Moves to the best stream not tried yet, where playback is now. False when none is left. */
  playNext(): boolean;
  /** Whether playNext has somewhere to go. */
  hasNext(): boolean;
  togglePlay(): void;
  pause(): void;
  resume(): void;
  /** Seconds. Clamped to the video, and on a broadcast to what it keeps, up to live. */
  seek(position: number): void;
  /** On a broadcast, back to where the engine plays live. */
  goToLive(): void;
  /** Plays at this speed, until another stream opens at normal speed. */
  setRate(rate: number): void;
  selectAudio(id: string): void;
  selectText(id: string | null): void;
  /** Saves where playback is now, for leaving or hiding the app. */
  saveProgress(): void;
  /** The trusted position: never the 0 that webOS reads right after a resume. */
  trustedPosition(): number | undefined;
  /**
   * On a broadcast, what it keeps and where live is now, read from the engine
   * at the moment. The state's liveWindow is only refreshed as the time behind
   * live changes, so it can be minutes old while that stays steady.
   */
  liveWindow(): LiveWindow | null;
  /**
   * Where another stream of this video starts (Quality, Other streams, Try
   * again): where playback is now, or the live edge (0) of a live stream,
   * whose clock means nothing on another source's.
   */
  carryOn(): number;
  /** Saves progress, stops the stream and frees the decoder. */
  destroy(): void;
}

/** The bar moves on at least every thousandth of its length, however short the video. */
const BAR_STEPS = 1000;

type ClockReading = Pick<SessionState, 'position' | 'duration' | 'liveWindow' | 'behind'>;

function sameWindow(a: LiveWindow | null, b: LiveWindow | null): boolean {
  if (!a || !b) return a === b;
  return a.start === b.start && a.live === b.live && a.slack === b.slack;
}

/**
 * Whether a reading of the media clock changes what the player shows, so it
 * is worth a render. The times show whole seconds, and on a film the bar
 * moves less than a pixel a second, so a reading within the same second is
 * left out, unless a thousandth of the bar is less than a second (a short
 * video). The length, a broadcast's window and how far behind live it is
 * always count.
 */
export function clockShows(before: ClockReading, next: ClockReading): boolean {
  if (next.duration !== before.duration || next.behind !== before.behind) return true;
  if (!sameWindow(before.liveWindow, next.liveWindow)) return true;
  if (Math.floor(next.position) !== Math.floor(before.position)) return true;
  const kept = next.liveWindow;
  const span = kept ? kept.live - kept.start : next.duration;
  return span > 0 && Math.abs(next.position - before.position) >= span / BAR_STEPS;
}

export const INITIAL_SESSION_STATE: SessionState = {
  status: 'idle',
  entry: null,
  engine: null,
  position: 0,
  duration: 0,
  live: false,
  liveWindow: null,
  behind: 0,
  error: null,
  failedOver: false,
  steppedDown: false,
  struggling: false,
  audio: [],
  text: [],
  streamCues: {},
  rate: 1,
  clip: false,
};

export function createPlaybackSession(options: SessionOptions): PlaybackSession {
  const { video, type, metaId, videoId, finder } = options;
  const keep = options.remember !== false;
  const offRow = options.continueRow === false;
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
  // Picked from the list of streams (Sources), so a failure stops at the problem box.
  let handPicked = false;
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
  // Whether the viewer moved to a place in this stream before its first picture,
  // once its length was known (a stream opened paused can be).
  let seekedToPlace = false;
  let reportedWorked = false;
  // This attempt is a short clip of the video, not the video: a sample, a
  // trailer, or a debrid service's "not ready yet". Nothing it plays is kept
  // as the video's place, so it never marks the video watched.
  let clip = false;
  // An episode of season 0 ("tt0386676:0:3"): a special, as long as it likes.
  const special = options.type === 'series' && /:0:\d+$/.test(options.videoId);
  let stallTimer: number | undefined;
  let startTimer: number | undefined;
  // Gives up on a stream auto-play chose that says nothing of itself (tuning metadataTimeoutMs).
  let metadataTimer: number | undefined;
  // Judges a wait still going on, once it alone would make the stream count as struggling.
  let judgeTimer: number | undefined;
  let destroyed = false;
  // Whether this attempt's stream is live, once the engine can tell; and where its clock started.
  let live = false;
  // Whether the broadcast was last judged behind live, so a wobble at the boundary does not flicker.
  let wasBehind = false;
  // The viewer moved back in the broadcast or paused it, so a stall does not take them to live.
  let viewerBehind = false;
  // When a stall last took the broadcast back to live by itself.
  let autoLiveAt = -Infinity;
  let liveTimer: number | undefined;
  let firstTrusted: number | undefined;
  // The viewer's tracks for this stream, chosen again when another engine opens it (Try again).
  let wantedAudio: string | null = null;
  let wantedText: string | null = null;
  // Shaka lets go of the video element asynchronously; the next engine waits for it.
  let releasing: Promise<void> = Promise.resolve();
  // The status when the clock was last read into the state.
  let tickStatus: SessionStatus | undefined;
  // Where the viewer's jumps really land, by the tester's switch read now (landing.ts).
  const landings = createLandingWatch(readLandingMode());
  showLandings();
  // Reads a paused jump's landing, once the TV has had a moment to say where it is.
  let landingTimer: number | undefined;

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
    clearTimeout(metadataTimer);
    stallTimer = undefined;
    startTimer = undefined;
    judgeTimer = undefined;
    metadataTimer = undefined;
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
    // Paused, the clock stands still while live moves on: no timeupdate says so.
    clearInterval(liveTimer);
    liveTimer = window.setInterval(() => {
      const before = state.get();
      const now = judge(video.currentTime);
      if (
        Math.round(now.behind) !== Math.round(before.behind) ||
        !now.liveWindow !== !before.liveWindow
      ) {
        patch(now);
      }
    }, LIVE_TICK_MS);
    if (!keep) return;
    // An older build saved broadcasts like films, with a place to resume.
    progress.clear(videoId);
    // Opened at that place: start again at the live edge, once.
    if (lastStartAt > 0) {
      const current = attempt;
      const entry = state.get().entry;
      const chosen = viewerChose;
      window.setTimeout(() => {
        if (current === attempt && !destroyed && entry) {
          session.play(entry, 0, { chosen, paused: pausedByViewer });
        }
      }, 0);
    }
  }

  const durationNow = () => (live || !isFinite(video.duration) ? 0 : video.duration);
  const liveWindow = () => (live ? (engine?.liveWindow() ?? null) : null);

  /**
   * Whether `position` is no place in the broadcast: an engine recovering
   * the media reads 0 for a moment. A broadcast that keeps everything from
   * its start has a real 0.
   */
  function noPlace(kept: LiveWindow, position: number): boolean {
    return !(position >= 0) || video.readyState < 1 || (position === 0 && kept.start > 0);
  }

  /** How far behind live a broadcast is, at `position`. */
  function judge(position: number): Pick<SessionState, 'liveWindow' | 'behind'> {
    const kept = liveWindow();
    if (!kept) {
      wasBehind = false;
      return { liveWindow: null, behind: 0 };
    }
    if (noPlace(kept, position)) return { liveWindow: kept, behind: state.get().behind };
    const { behind, atLive } = judgeLive(kept, position, wasBehind);
    wasBehind = !atLive;
    return { liveWindow: kept, behind };
  }

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
   * made before the first picture is not a place yet while the stream's
   * length is unknown: it may still turn out to be live, or never start.
   */
  function carryOn(): number {
    if (live) return 0;
    // A clip's clock says nothing about the video: the next stream starts where this one was opened.
    if (clip) return lastStartAt;
    return startedPlaying || seekedToPlace ? (tracker?.position() ?? lastStartAt) : lastStartAt;
  }

  /** Saves where playback is; a sports event's place is marked to stay off Continue Watching. */
  function record(position: number, duration: number) {
    if (!keep || clip) return;
    const update: ProgressUpdate = { metaId, type, videoId, position, duration };
    if (offRow) update.continueRow = false;
    progress.record(update);
  }

  function save() {
    checkLive();
    // A live broadcast has nothing to come back to. Nor has a stream whose
    // length is not known yet, or one let go of: its element reads 0.
    if (live || !engine) return;
    const position = tracker?.position();
    const duration = savedLength();
    if (position === undefined || !(duration > 0)) return;
    record(position, duration);
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
    const next =
      options.autoFailover && !handPicked && failovers < MAX_FAILOVERS
        ? finder.next(tried)
        : undefined;
    if (next) {
      failovers++;
      // A film the viewer paused stays paused on the stream that takes over.
      session.play(next, resumeAt, { paused: pausedByViewer });
      patch({ failedOver: true });
      return;
    }
    release();
    patch({ status: 'failed', error });
  }

  let lastStartAt = 0;

  const clipError = () => new PlaybackError('clip', 'The stream is a short clip, not the video');

  /**
   * Once its length is known: a stream far shorter than the title's running
   * time is a clip. Auto-play moves on from it as from a stream that failed,
   * at the same place; one the viewer picked plays on, kept nowhere, and fails
   * as a clip at its end. Not a special (season 0), which the series' running
   * time says nothing about.
   */
  function judgeLength(current: number) {
    if (clip || live || current !== attempt || destroyed || !engine || special) return;
    const runtime = finder.knownRuntimeSeconds();
    if (runtime === undefined || !isMuchShorter(durationNow(), runtime)) return;
    clip = true;
    if (options.autoFailover && !handPicked) {
      fail(clipError(), current);
    } else patch({ clip: true });
  }

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
        ? finder.lighter(entry, tried, reference(entry))
        : undefined;
    if (!lighter) {
      patch({ struggling: true });
      return;
    }
    stepDowns++;
    session.play(lighter, carryOn());
    patch({ steppedDown: true });
  }

  /** What plays, as a lighter stream should match it: the language heard, the length. */
  function reference(entry: StreamEntry): QualityReference {
    const length = durationNow();
    return {
      entry,
      audioLanguage: engine?.audioTracks().find((track) => track.active)?.lang || undefined,
      lengthSeconds: length > 0 ? length : undefined,
    };
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
    armMetadata(current);
  }

  /**
   * With the `metadataTimeoutMs` tuning switch set, a stream auto-play chose
   * that has not said how long it is by then gives way to the next, as one
   * that failed would: a server that takes the connection and sends nothing
   * would otherwise hold the first picture up for the whole start time. Only
   * when there is a next to go to, so the start time still has the last word,
   * and never on a stream the viewer picked. Its clock stops, as the start's
   * does, while the viewer has the stream paused before its first picture.
   */
  function armMetadata(current: number) {
    clearTimeout(metadataTimer);
    metadataTimer = undefined;
    const limit = tuning.metadataTimeoutMs;
    if (!(limit > 0) || !options.autoFailover || handPicked || viewerChose) return;
    metadataTimer = window.setTimeout(() => {
      metadataTimer = undefined;
      if (current !== attempt || destroyed || startedPlaying) return;
      // Read from the element too: Android's player says so without the event.
      if (video.readyState >= HAVE_METADATA) return;
      if (failovers >= MAX_FAILOVERS || !finder.next(tried)) return;
      fail(new PlaybackError('network', 'The stream sent nothing'), current);
    }, limit);
  }

  /** Where a jump may go: the video, and on a broadcast the part a rewind may land in. */
  function jumpBounds(): LandingBounds {
    const kept = liveWindow();
    return {
      duration: isFinite(video.duration) ? video.duration : Infinity,
      window: kept ? rewindWindow(kept) : null,
    };
  }

  function stopLandingTimer() {
    clearTimeout(landingTimer);
    landingTimer = undefined;
  }

  /**
   * Reads where the watched jump landed. In 'again' a miss is jumped once
   * more, and that second jump is not the viewer's: the engine, the tracker
   * and the bar are not told, nothing is saved or offered, and the clock
   * takes the bar there as it plays.
   */
  function readLanding(final: boolean) {
    if (!engine) return;
    const second = landings.read(video.currentTime, final, jumpBounds());
    if (second === undefined) return;
    stopLandingTimer();
    video.currentTime = second;
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
      'loadedmetadata',
      () => {
        if (!engine) return;
        clearTimeout(metadataTimer);
        metadataTimer = undefined;
        playMark(finder, 'metadata');
      },
    ],
    [
      'playing',
      () => {
        // From a stream let go of (its engine can still be telling, as Android's
        // bridge does in one go), nothing. A clip not found by its length
        // before is moved on from where it was opened.
        if (!engine) return;
        const current = attempt;
        checkLive();
        judgeLength(current);
        if (current !== attempt || !engine) return;
        clearTimers();
        if (!startedPlaying) playMark(finder, 'first-frame');
        startedPlaying = true;
        const buffered = endBuffering();
        patch({ status: 'playing', failedOver: false, steppedDown: false, error: null });
        if (buffered) judgeBuffering(attempt);
        // A stall left the broadcast well behind: back to live, as a TV channel would be.
        const kept = buffered && current === attempt ? liveWindow() : null;
        if (
          kept &&
          shouldReturnToLive(kept, video.currentTime, {
            viewerBehind,
            lastAt: autoLiveAt,
            now: Date.now(),
          })
        ) {
          autoLiveAt = Date.now();
          session.goToLive();
        }
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
      'seeked',
      () => {
        if (!landings.seeked()) return;
        // Playing, the next reading as the clock moves on says where it landed.
        // Paused, no clock moves on: it is read once the TV has had a moment.
        stopLandingTimer();
        landingTimer = window.setTimeout(() => {
          landingTimer = undefined;
          if (video.paused) readLanding(true);
        }, LANDING_SETTLE_MS);
      },
    ],
    [
      'timeupdate',
      () => {
        // A stream let go of resets the element to 0, which is no place in the video.
        if (!engine) return;
        checkLive();
        const position = video.currentTime;
        // Nor is a broadcast's 0 while the engine recovers: the bar stays where it was.
        const kept = liveWindow();
        if (kept && noPlace(kept, position)) return;
        const duration = durationNow();
        // Until a jump lands, the element can read back where it was sent,
        // which 'learn' and 'again' put past where the viewer asked: the bar
        // and the place saved stay where they asked.
        const place = landings.placeOf(position);
        if (tracker?.update(place, Date.now())) save();
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
        const reading = { position: trusted ?? lastStartAt, duration, ...judge(place) };
        // About four readings a second: only those that change what shows, or the first since
        // the status changed, render the player again.
        const shown = state.get();
        if (shown.status !== tickStatus || clockShows(shown, reading)) {
          tickStatus = shown.status;
          patch(reading);
        }
        // Every reading, shown or not, can say where a jump landed.
        readLanding(false);
      },
    ],
    [
      'durationchange',
      () => {
        checkLive();
        patch({ duration: durationNow() });
        judgeLength(attempt);
      },
    ],
    [
      'ended',
      () => {
        // From a stream let go of, nothing.
        if (!engine) return;
        clearTimers();
        if (live) {
          patch({ status: 'ended' });
          return;
        }
        // A clip the viewer picked: its end is not the video's. It says it was
        // only a clip, with the ways out, instead of ending the video.
        if (clip) {
          fail(clipError(), attempt);
          return;
        }
        const duration = savedLength();
        record(duration, duration);
        patch({ status: 'ended', position: duration });
      },
    ],
    [
      'ratechange',
      () => {
        // Whatever set it: the viewer, the Lab's speed test, or the TV putting
        // it back. Shaka sets 0 while it buffers, which is no speed.
        const rate = video.playbackRate;
        if (rate > 0 && isFinite(rate)) patch({ rate });
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
      seekedToPlace = false;
      pausedByViewer = playOptions?.paused === true;
      reportedWorked = false;
      clip = false;
      viewerChose = playOptions?.chosen === true;
      handPicked = playOptions?.handPicked === true;
      rebuffers = [];
      bufferingSince = undefined;
      judgedStruggling = false;
      smoothFor = 0;
      lastPosition = undefined;
      judgedSmooth = false;
      limitBefore = undefined;
      live = false;
      wasBehind = false;
      viewerBehind = false;
      autoLiveAt = -Infinity;
      clearInterval(liveTimer);
      firstTrusted = undefined;
      // Another file lands its jumps its own way: nothing learnt carries over.
      landings.reset();
      stopLandingTimer();
      patch({
        status: 'loading',
        entry,
        engine: null,
        position: startAt,
        live: false,
        liveWindow: null,
        behind: 0,
        error: null,
        failedOver: false,
        steppedDown: false,
        struggling: false,
        audio: [],
        text: [],
        streamCues: {},
        rate: 1,
        clip: false,
      });
      // A new load would put it back too, but not before the old stream lets go.
      video.playbackRate = 1;
      // Like a pause before the first picture: no start clock until the viewer plays.
      if (!pausedByViewer) armStart(current);

      const engines = new Set<EngineName>();
      const seenCues: Record<string, Record<string, true>> = {};
      const open = async (name: EngineName) => {
        if (current !== attempt || destroyed) return;
        engines.add(name);
        // A fallback engine opens where the viewer moved a stream opened paused:
        // read before the first engine's element is reset.
        const takingOver = engines.size > 1;
        const at = takingOver ? carryOn() : startAt;
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
          if (takingOver) {
            // It trusts no reading from the element the first engine reset.
            tracker = createProgressTracker({ startAt: at });
            lastStartAt = at;
            seekedToPlace = false;
            firstTrusted = undefined;
            lastPosition = undefined;
          }
          playMark(finder, 'load', created.name);
          await created.load(url, at);
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
        clearTimeout(metadataTimer);
        startTimer = undefined;
        metadataTimer = undefined;
      }
      pausedByViewer = true;
      if (live) viewerBehind = true;
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
      const kept = liveWindow();
      const wanted = kept ? clampToWindow(rewindWindow(kept), position) : position;
      // A jump forward never lands behind where it started, as one past a
      // live point read a moment late would.
      if (kept && wanted < video.currentTime && position > video.currentTime) return;
      const target = Math.max(0, Math.min(wanted, duration - 1));
      // Back in a broadcast on purpose; forward to live again, not.
      if (kept) viewerBehind = target < kept.live - kept.slack;
      endBuffering();
      clearTimeout(judgeTimer);
      judgeTimer = undefined;
      lastSeekAt = Date.now();
      // In 'learn' the element is sent as much past the target as this stream's
      // jumps usually fall short. The viewer's place stays the target.
      const from = video.currentTime;
      const aimed = landings.aim(target, from, jumpBounds());
      stopLandingTimer();
      video.currentTime = aimed;
      // Before the first picture the engine is still finding its start, which it checks itself.
      if (startedPlaying) {
        landings.jumped({
          wanted: target,
          aimed,
          from,
          paused: video.paused,
          stream: landingStream(engine?.name ?? null, state.get().entry?.facts),
        });
      }
      engine?.seeked?.();
      tracker?.seeked(target);
      // Back from the end it is paused there, not ended: Play goes on from it.
      if (state.get().status === 'ended' && target < duration - 1) {
        patch({ status: 'paused', position: target });
      } else patch({ position: target, ...judge(target) });
      save();
      if (!live && savedLength() > 0) seekedToPlace = true;
    },

    setRate(rate) {
      if (!(rate > 0) || !isFinite(rate)) return;
      video.playbackRate = rate;
      patch({ rate });
    },

    goToLive() {
      const kept = liveWindow();
      if (!kept) return;
      // Live again at once, whatever the boundary the last reading was judged by.
      wasBehind = false;
      // Already past a live point read a moment late: live is here, not back there.
      if (kept.live <= video.currentTime) {
        patch(judge(video.currentTime));
        return;
      }
      session.seek(kept.live);
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

    liveWindow,

    carryOn,

    destroy() {
      if (destroyed) return;
      save();
      destroyed = true;
      clearTimers();
      clearInterval(liveTimer);
      landings.reset();
      stopLandingTimer();
      handlers.forEach(([event, handler]) => video.removeEventListener(event, handler));
      release();
    },
  };
  return session;
}
