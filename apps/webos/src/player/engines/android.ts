import { type Cue, isForcedName, parseCueMarkup } from '@bannertv/core';
import {
  type AndroidCue,
  type AndroidPlayerEvent,
  type AndroidTrack,
  onAndroidPlayer,
  sendPlayerCommand,
} from '../../platform/android';
import { channelName, formatName } from '../audio';
import { guessMimeType } from '../media';
import { requestHeadersFor } from '../request-headers';
import { type Engine, type EngineFactory, type EngineTrack, PlaybackError } from './types';

/** Shown while Android's player draws the picture under the page. */
export const ANDROID_VIDEO_CLASS = 'android-video';

/** How long a play or pause the viewer asked for outranks older news from Android. */
const INTENT_MS = 2000;
/** A seek Android never confirms stops holding the clock after this long. */
const SEEK_MS = 5000;

/** Numbers each load command, across players, so Android's news names the stream it is about. */
let loads = 0;

/** The lines of the file's own subtitles kept for drawing: plenty for any timing offset. */
export const MAX_CUES = 50;

/** Android's audio MIME types as the codec names the track list already reads. */
const AUDIO_CODECS: Record<string, string> = {
  'audio/eac3': 'ec-3',
  'audio/eac3-joc': 'ec-3',
  'audio/ac3': 'ac-3',
  'audio/ac4': 'ac-4',
  'audio/true-hd': 'mlpa',
  'audio/vnd.dts': 'dtsc',
  'audio/vnd.dts.hd': 'dtsh',
  'audio/vnd.dts.uhd': 'dtsx',
  'audio/mp4a-latm': 'mp4a.40.2',
  'audio/mpeg': 'mp3',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
};

/** A track as the player's menus list it. */
export function toEngineTrack(track: AndroidTrack, audio: boolean): EngineTrack {
  const listed: EngineTrack = {
    id: track.id,
    lang: track.lang === 'und' ? '' : track.lang,
    label: track.label,
    active: track.active,
  };
  if (audio) {
    const channels = channelName(track.channels);
    if (channels) listed.channels = channels;
    const mime = (track.mime ?? '').toLowerCase();
    const format = formatName(AUDIO_CODECS[mime] ?? track.codecs, mime === 'audio/eac3-joc');
    if (format) listed.format = format;
    if (track.commentary) listed.commentary = true;
  } else {
    if (track.forced || isForcedName(track.label)) listed.forced = true;
    const picture = subtitleKind(track);
    if (picture !== undefined) listed.picture = picture;
  }
  return listed;
}

/** Subtitle formats Android's player draws as pictures, by their type. */
const PICTURE_SUBTITLES = ['application/pgs', 'application/vobsub', 'application/dvbsubs'];
/** Subtitle formats of text lines, which Android hands over for the page to draw. */
const TEXT_SUBTITLES = [
  'application/x-subrip',
  'text/vtt',
  'text/x-ssa',
  'application/ttml+xml',
  'application/x-quicktime-tx3g',
  'application/x-mp4-vtt',
];

/**
 * Whether a subtitle track is pictures (true) or text (false), by its type, or by
 * the type it had before Android's player read it into its own (`codecs`, beside
 * the media3 cues type); undefined where neither says.
 */
function subtitleKind(track: AndroidTrack): boolean | undefined {
  const types = [track.mime, track.codecs].map((type) => (type ?? '').toLowerCase());
  if (types.some((type) => PICTURE_SUBTITLES.indexOf(type) !== -1)) return true;
  if (types.some((type) => TEXT_SUBTITLES.indexOf(type) !== -1)) return false;
  return undefined;
}

/** When the last group Android handed over began: the latest start or end in the record. */
function lastGroupAt(history: readonly Cue[]): number {
  let at = -Infinity;
  for (const cue of history) at = Math.max(at, cue.start, isFinite(cue.end) ? cue.end : cue.start);
  return at;
}

/**
 * The record of a subtitle track's lines after Android hands over the group that shows from
 * `at`. Android only says what shows from when, so each line stays open (ends at Infinity)
 * until the next group, which closes it; an empty group just closes. A group from before the
 * last one means the clock jumped back, and the record starts again. Earlier lines are kept so
 * that subtitles moved later by their timing still show.
 */
export function followCues(
  history: readonly Cue[],
  at: number,
  group: readonly AndroidCue[],
): Cue[] {
  const kept =
    at < lastGroupAt(history)
      ? []
      : history
          .map((cue) => (cue.end === Infinity ? { ...cue, end: at } : cue))
          .filter((cue) => cue.end > cue.start);
  for (const line of group) {
    if (!line || typeof line.text !== 'string') continue;
    const lines = parseCueMarkup(line.text);
    if (lines.length === 0) continue;
    kept.push({ start: at, end: Infinity, lines, ...(line.top === true ? { top: true } : {}) });
  }
  return kept.length > MAX_CUES ? kept.slice(kept.length - MAX_CUES) : kept;
}

/** Tracks the device cannot play are left out, unless none of them can be played. */
function playable(tracks: AndroidTrack[]): AndroidTrack[] {
  const supported = tracks.filter((track) => track.supported);
  return supported.length > 0 ? supported : tracks;
}

/**
 * Android's own player (Media3 ExoPlayer in apps/androidtv), drawn under the
 * page. It plays Matroska, HEVC, HDR and Dolby or DTS sound that the WebView's
 * `<video>` cannot. The session, the subtitles and the controls all read the
 * one `<video>` element, so this engine makes that element tell Android's
 * clock, pause state and events, and takes them back off when it is done.
 * Subtitles inside the file come to the page line by line and are drawn in the
 * viewer's style, as files from addons are; Android draws only picture
 * subtitles (PGS, VobSub, DVB) itself, under the page.
 */
export const createAndroidEngine: EngineFactory = (video, listener) => {
  let position = 0;
  /** performance.now() when `position` was read. */
  let positionAt = 0;
  let duration: number | null = null;
  let live = false;
  let paused = true;
  let playing = false;
  let buffering = false;
  let ready = false;
  let ended = false;
  let seeking = false;
  let audio: EngineTrack[] = [];
  let text: EngineTrack[] = [];
  /** The subtitle track chosen last: Android's lines for any other are old news. */
  let textId: string | null = null;
  /** Its lines so far, as Android handed them over (followCues). */
  let cueHistory: Cue[] = [];
  let loaded = false;
  /** The id of the current load command. */
  let loadId = 0;
  /** What the viewer last asked for, until Android agrees or INTENT_MS passes. */
  let intent: { paused: boolean; at: number } | null = null;
  let seekTimer: number | undefined;
  let unsubscribe: (() => void) | undefined;

  const now = () => performance.now();

  // Events the page causes are queued, as the browser does for a real element:
  // a handler that pauses inside 'play' then sees its own 'pause' afterwards.
  const queue = (type: string) => window.setTimeout(() => fire(type), 0);
  const fire = (type: string) => {
    if (loaded) video.dispatchEvent(new Event(type));
  };

  function clock(): number {
    if (!playing || seeking) return position;
    const moved = position + (now() - positionAt) / 1000;
    return duration !== null && duration > 0 ? Math.min(moved, duration) : moved;
  }

  function place(seconds: number) {
    position = seconds;
    positionAt = now();
  }

  function setDuration(value: number | null) {
    if (value === duration) return;
    duration = value;
    fire('durationchange');
  }

  function setPaused(value: boolean, queued: boolean) {
    if (value === paused) return;
    paused = value;
    if (queued) queue(value ? 'pause' : 'play');
    else fire(value ? 'pause' : 'play');
  }

  /** Lines from before a jump, or of another track, never show again. */
  function forgetCues() {
    if (cueHistory.length === 0) return;
    cueHistory = [];
    if (textId !== null) listener.cues(textId, [], true);
  }

  function seekTo(target: number) {
    if (!loaded || !isFinite(target)) return;
    const end = duration !== null && duration > 0 ? duration : Infinity;
    const at = Math.max(0, Math.min(target, end));
    forgetCues();
    place(at);
    seeking = true;
    ended = false;
    clearTimeout(seekTimer);
    seekTimer = window.setTimeout(() => (seeking = false), SEEK_MS);
    sendPlayerCommand({ op: 'seek', position: at });
    queue('seeking');
  }

  // The parts of HTMLMediaElement the session, subtitles and controls read.
  const element: PropertyDescriptorMap = {
    currentTime: {
      configurable: true,
      get: clock,
      set: (value: number) => seekTo(Number(value)),
    },
    duration: {
      configurable: true,
      // A file whose length Android cannot read is Infinity once it plays, as the TV's own
      // player reports it, so the session keeps progress against the film's running time.
      get: () =>
        duration === null ? (ready && !live ? Infinity : NaN) : duration < 0 ? Infinity : duration,
    },
    paused: { configurable: true, get: () => paused },
    ended: { configurable: true, get: () => ended },
    seeking: { configurable: true, get: () => seeking },
    readyState: {
      configurable: true,
      get: () =>
        !ready && duration === null
          ? HTMLMediaElement.HAVE_NOTHING
          : buffering
            ? HTMLMediaElement.HAVE_METADATA
            : HTMLMediaElement.HAVE_ENOUGH_DATA,
    },
    play: {
      configurable: true,
      writable: true,
      value: () => {
        if (loaded) {
          intent = { paused: false, at: now() };
          if (ended) seekTo(0);
          setPaused(false, true);
          // As a real element does when it resumes without enough data: the session shows
          // that it is buffering and watches for a stall.
          if (buffering) queue('waiting');
          sendPlayerCommand({ op: 'play' });
        }
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      writable: true,
      value: () => {
        if (!loaded) return;
        intent = { paused: true, at: now() };
        // The clock stops where it is, not where Android last said it was.
        place(clock());
        playing = false;
        setPaused(true, true);
        sendPlayerCommand({ op: 'pause' });
      },
    },
  };

  function attach() {
    Object.defineProperties(video, element);
    document.documentElement.classList.add(ANDROID_VIDEO_CLASS);
    // The element stays empty and on top of Android's picture: it must not hide it.
    video.style.background = 'transparent';
  }

  function detach() {
    for (const key of Object.keys(element)) {
      delete (video as unknown as Record<string, unknown>)[key];
    }
    document.documentElement.classList.remove(ANDROID_VIDEO_CLASS);
    video.style.background = '';
  }

  function onState(event: Extract<AndroidPlayerEvent, { event: 'state' }>) {
    const wasPlaying = playing;
    const wasBuffering = buffering;
    ready = ready || event.ready;
    // Only once Android has read the stream: the session clears a film's resume point for a
    // broadcast, so a wrong "live" while it opens would cost the viewer their place.
    if (event.ready && event.live) live = true;
    if (!seeking) place(event.position);
    setDuration(event.duration);
    // Android's word on play or pause, unless the viewer has just asked for the other.
    const androidPaused = !event.playWhenReady || event.ended;
    if (intent && (intent.paused === androidPaused || now() - intent.at > INTENT_MS)) {
      intent = null;
    }
    if (!intent) setPaused(androidPaused, false);
    playing = event.playing && !paused;
    buffering = event.buffering;
    if (event.ended && !ended) {
      ended = true;
      fire('ended');
    } else if (!event.ended) {
      ended = false;
    }
    if (buffering && !wasBuffering && !paused) fire('waiting');
    if (playing && !wasPlaying) fire('playing');
  }

  function onCues(event: Extract<AndroidPlayerEvent, { event: 'cues' }>) {
    if (textId === null || event.track !== textId) return;
    if (typeof event.at !== 'number' || !isFinite(event.at) || !Array.isArray(event.cues)) return;
    cueHistory = followCues(cueHistory, event.at, event.cues);
    listener.cues(textId, cueHistory, true);
  }

  function onEvent(event: AndroidPlayerEvent) {
    // News sent before Android had the latest load is about the stream before it.
    if (!loaded || (event.load !== undefined && event.load !== loadId)) return;
    switch (event.event) {
      case 'state':
        onState(event);
        return;
      case 'time':
        if (!seeking) place(event.position);
        setDuration(event.duration);
        fire('timeupdate');
        return;
      case 'seeked':
        clearTimeout(seekTimer);
        seeking = false;
        forgetCues();
        place(event.position);
        fire('seeked');
        fire('timeupdate');
        return;
      case 'tracks':
        audio = playable(event.audio).map((track) => toEngineTrack(track, true));
        text = playable(event.text).map((track) => toEngineTrack(track, false));
        listener.tracks();
        return;
      case 'cues':
        onCues(event);
        return;
      case 'error':
        listener.fatal(new PlaybackError(event.kind, event.message, event.detail));
        return;
    }
  }

  const engine: Engine = {
    name: 'android',

    load(url, startAt) {
      unsubscribe?.();
      unsubscribe = onAndroidPlayer(onEvent);
      position = startAt;
      positionAt = now();
      duration = null;
      live = false;
      paused = true;
      playing = false;
      buffering = false;
      ready = false;
      ended = false;
      seeking = false;
      clearTimeout(seekTimer);
      intent = null;
      audio = [];
      text = [];
      // Android shows no subtitles for a new stream until the page chooses again.
      textId = null;
      cueHistory = [];
      if (!loaded) attach();
      loaded = true;
      const mime = guessMimeType(url);
      const headers = requestHeadersFor(url);
      loadId = ++loads;
      sendPlayerCommand({
        op: 'load',
        id: loadId,
        url,
        startAt,
        // Android works out files itself; adaptive streams without an extension need saying.
        mime:
          mime === 'application/vnd.apple.mpegurl' || mime === 'application/dash+xml' ? mime : '',
        // A Referer, Origin or User-Agent some addons' links (often sport) only open with.
        ...(headers ? { headers } : {}),
      });
      return Promise.resolve();
    },

    isLive: () => live,

    // Android's news gives no live point yet: a broadcast reads as live, and Go to live as unknown.
    liveWindow: () => null,

    audioTracks: () => audio,

    selectAudio(id) {
      sendPlayerCommand({ op: 'audio', id });
      audio = audio.map((track) => ({ ...track, active: track.id === id }));
      listener.tracks();
    },

    // Android hands over each track's lines as they show (the cues event), for the page to draw.
    textTracks: () => text,

    selectText(id) {
      if (id !== textId) {
        forgetCues();
        textId = id;
      }
      // cues: an Android app from before this asks nothing more, and draws them itself.
      sendPlayerCommand({ op: 'text', id, cues: true });
      text = text.map((track) => ({ ...track, active: track.id === id }));
      listener.tracks();
    },

    destroy() {
      unsubscribe?.();
      unsubscribe = undefined;
      clearTimeout(seekTimer);
      textId = null;
      cueHistory = [];
      if (!loaded) return;
      loaded = false;
      sendPlayerCommand({ op: 'release' });
      detach();
    },
  };
  return engine;
};
