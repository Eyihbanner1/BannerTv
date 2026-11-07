import { createStore } from '@bannertv/core';
import type { AndroidEvent, AndroidPlayerCommand, AndroidTrack } from '@tv/platform/android';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import {
  type AudioTrack,
  type ContentType,
  createVideoPlayer,
  type PlayingChangeEventPayload,
  type StatusChangeEventPayload,
  type SubtitleTrack,
  type VideoPlayer,
  type VideoPlayerStatus,
} from 'expo-video';
import { AppState, BackHandler, Linking, Platform } from 'react-native';
import { window } from '../runtime/web-globals';
import { errorKind, errorMessage, httpStatus, mayBeHls } from './errors';

/**
 * The phone's side of the Android bridge (ADR 0005, protocol version 1), over expo-video's player
 * (Media3 ExoPlayer, as in the TV's Android app). The shared player code (apps/webos/src/player)
 * finds it as `window.BannerAndroid`, exactly as on an Android TV, so the playback session,
 * failover, stream choice, progress and subtitles all run unchanged. This file answers the same
 * commands the TV app's PlayerController.kt does, and sends back the same news.
 */

const PROTOCOL = '1';
/** Seconds between clock reports while playing; the engine runs its own clock in between. */
const TIME_INTERVAL_S = 0.5;
/** A resume point the player missed by more than this is asked for again once the stream opens. */
const START_SLACK_S = 2;

/**
 * What a phone can decode, as far as can be said without asking its decoders: no DTS or Dolby
 * TrueHD (Android has no decoder for either, and expo-video brings none), no Dolby Vision, and
 * no 4K (it costs data and a phone's screen gains nothing). The rest is left unknown, so no
 * stream is marked down for it.
 */
const PHONE_CAPABILITIES = {
  uhd: false,
  hdr10: null,
  dolbyVision: false,
  hevc: null,
  av1: null,
  dts: false,
  truehd: false,
};

/** Whether a stream is open, so the player screen draws Android's picture. */
export const pictureShown = createStore(false);

/** Whether the film plays in a small window over other apps (picture-in-picture). */
export const pictureInPicture = createStore(false);

/**
 * How long a move to the background waits before it pauses. Android may report the app going to
 * the background just before it says the film went to picture-in-picture, and that film must
 * keep playing.
 */
export const BACKGROUND_PAUSE_DELAY_MS = 600;

let player: VideoPlayer | null = null;
let loadId = 0;
let hasMedia = false;
/** What the page last asked for: Media3's playWhenReady, which expo-video does not report. */
let wantPlay = false;
let readyOnce = false;
/** The native player's status for the stream opened last; idle until it says otherwise. */
let nativeStatus: VideoPlayerStatus = 'idle';
let ended = false;
let openedUrl: string | null = null;
let openedStartAt = 0;
let openedType: ContentType = 'auto';
/** Whether the link's kind is known; an unknown one is tried as HLS once (as the TV app does). */
let typeSettled = false;
let firstError: string | undefined;
/** Whether the page has chosen subtitles for this stream; until then none show. */
let textChosen = false;
let startChecked = false;
let audioTracks: AudioTrack[] = [];
let textTracks: SubtitleTrack[] = [];

function emit(event: AndroidEvent): void {
  const sink = window.__bannerAndroid as { event(event: AndroidEvent): void } | undefined;
  sink?.event(event);
}

function durationValue(current: VideoPlayer): number | null {
  const duration = current.duration;
  if (isFinite(duration) && duration > 0) return duration;
  return current.isLive ? -1 : null;
}

function position(current: VideoPlayer): number {
  const time = current.currentTime;
  return isFinite(time) && time > 0 ? time : 0;
}

function emitState(): void {
  if (!player || !hasMedia) return;
  emit({
    type: 'player',
    event: 'state',
    load: loadId,
    playWhenReady: wantPlay,
    playing: player.playing,
    buffering: player.status === 'loading',
    ready: readyOnce,
    ended,
    position: position(player),
    duration: durationValue(player),
    live: player.isLive,
  });
}

function emitTime(): void {
  if (!player || !hasMedia) return;
  emit({
    type: 'player',
    event: 'time',
    load: loadId,
    position: position(player),
    duration: durationValue(player),
  });
}

function trackId(prefix: string, track: AudioTrack | SubtitleTrack, index: number): string {
  return `${prefix}:${track.id ?? index}`;
}

function sameTrack(
  track: AudioTrack | SubtitleTrack,
  active: AudioTrack | SubtitleTrack | null,
): boolean {
  if (!active) return false;
  if (track.id !== undefined || active.id !== undefined) return track.id === active.id;
  return track.language === active.language && track.label === active.label;
}

function toTrack(
  prefix: string,
  track: AudioTrack | SubtitleTrack,
  index: number,
  active: AudioTrack | SubtitleTrack | null,
): AndroidTrack {
  return {
    id: trackId(prefix, track, index),
    lang: track.language || 'und',
    label: track.label || track.name || '',
    active: sameTrack(track, active),
    supported: true,
  };
}

function emitTracks(): void {
  if (!player || !hasMedia) return;
  audioTracks = player.availableAudioTracks;
  textTracks = player.availableSubtitleTracks;
  const audio = player.audioTrack;
  const text = player.subtitleTrack;
  emit({
    type: 'player',
    event: 'tracks',
    load: loadId,
    audio: audioTracks.map((track, index) => toTrack('a', track, index, audio)),
    text: textTracks.map((track, index) => toTrack('t', track, index, text)),
  });
}

/** Error text without links: addon links can carry the viewer's keys. */
function withoutLinks(text: string | undefined): string | undefined {
  return text?.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<link>').slice(0, 300);
}

function reportError(message: string | undefined): void {
  const kind = errorKind(message);
  const detail = withoutLinks(message);
  emit({
    type: 'player',
    event: 'error',
    load: loadId,
    kind,
    message: errorMessage(kind, httpStatus(message)),
    ...(detail ? { detail } : {}),
  });
}

function onStatus({ status, error }: StatusChangeEventPayload): void {
  if (!player || !hasMedia) return;
  nativeStatus = status;
  if (status === 'error') {
    const message = error?.message;
    if (!typeSettled && openedUrl && mayBeHls(message)) {
      // Media3 knows HLS by ".m3u8" in the link; IPTV and proxy links often have none.
      typeSettled = true;
      firstError = message;
      open(openedUrl, openedStartAt, 'hls');
      return;
    }
    // If it was not HLS either, the first answer is the one that describes the link.
    reportError(firstError ?? message);
    return;
  }
  if (status === 'readyToPlay') {
    readyOnce = true;
    if (!startChecked) {
      startChecked = true;
      if (openedStartAt > 0 && Math.abs(position(player) - openedStartAt) > START_SLACK_S) {
        player.currentTime = openedStartAt;
      }
    }
  }
  emitState();
}

function onEnd(): void {
  // The empty player that release() leaves (and a new player's first prepare) also "ends", and
  // that news reaches JS after the next load: only a stream that opened can end.
  if (!hasMedia || !readyOnce) return;
  ended = true;
  emitState();
}

function onPlayingChange({ isPlaying }: PlayingChangeEventPayload): void {
  if (!hasMedia) return;
  if (isPlaying) {
    // A media button (Bluetooth headphones, a headset, the car) or the notification resumed the
    // player: Media3's playWhenReady is true again, so the page shows Pause, not Play.
    wantPlay = true;
  } else if (wantPlay && !ended && nativeStatus === 'readyToPlay') {
    // Android paused the player itself, its sound taken by a call, the assistant or another app.
    // Media3's playWhenReady is false now, so say so, as the TV app reports it: the page shows
    // Paused instead of a Pause button over a still picture.
    wantPlay = false;
  }
  emitState();
}

function onSourceLoad(): void {
  if (!player || !hasMedia) return;
  const video = player.availableVideoTracks;
  if (video.length > 0 && video.every((track) => !track.isSupported)) {
    // With no decoder for the picture Media3 plays the sound alone and calls it playing. Stop,
    // and report a format the phone cannot play, so the session moves on to another stream.
    wantPlay = false;
    player.pause();
    emit({
      type: 'player',
      event: 'error',
      load: loadId,
      kind: 'format',
      message: errorMessage('format', undefined),
      detail: `video unsupported: ${video[0]?.mimeType ?? 'unknown'}`,
    });
    return;
  }
  if (!textChosen) player.subtitleTrack = null;
  emitTracks();
}

function ensurePlayer(): VideoPlayer {
  if (player) return player;
  const created = createVideoPlayer(null);
  created.loop = false;
  created.timeUpdateEventInterval = TIME_INTERVAL_S;
  created.keepScreenOnWhilePlaying = true;
  created.staysActiveInBackground = false;
  created.showNowPlayingNotification = false;
  created.addListener('statusChange', onStatus);
  created.addListener('playingChange', onPlayingChange);
  created.addListener('playToEnd', onEnd);
  created.addListener('timeUpdate', emitTime);
  created.addListener('sourceLoad', onSourceLoad);
  created.addListener('availableAudioTracksChange', emitTracks);
  created.addListener('audioTrackChange', emitTracks);
  created.addListener('availableSubtitleTracksChange', emitTracks);
  created.addListener('subtitleTrackChange', emitTracks);
  player = created;
  return created;
}

/** The player the screen's VideoView shows. */
export function phonePlayer(): VideoPlayer {
  return ensurePlayer();
}

function open(url: string, startAt: number, type: ContentType): void {
  const current = ensurePlayer();
  openedType = type;
  readyOnce = false;
  nativeStatus = 'idle';
  startChecked = false;
  current.replace({ uri: url, contentType: type }, true);
  if (startAt > 0 && isFinite(startAt)) current.currentTime = startAt;
  if (wantPlay) current.play();
  else current.pause();
}

function contentTypeFor(mime: string): ContentType {
  if (mime === 'application/vnd.apple.mpegurl') return 'hls';
  if (mime === 'application/dash+xml') return 'dash';
  return 'auto';
}

function load(command: Extract<AndroidPlayerCommand, { op: 'load' }>): void {
  if (!command.url) return;
  hasMedia = true;
  loadId = command.id;
  openedUrl = command.url;
  openedStartAt = command.startAt;
  typeSettled = command.mime !== '';
  firstError = undefined;
  textChosen = false;
  ended = false;
  wantPlay = true;
  open(command.url, command.startAt, contentTypeFor(command.mime));
  pictureShown.set(true);
}

function release(): void {
  hasMedia = false;
  readyOnce = false;
  nativeStatus = 'idle';
  ended = false;
  wantPlay = false;
  openedUrl = null;
  audioTracks = [];
  textTracks = [];
  if (player) {
    player.pause();
    player.replace(null, true);
  }
  pictureShown.set(false);
}

function handle(json: string): void {
  let command: AndroidPlayerCommand;
  try {
    command = JSON.parse(json) as AndroidPlayerCommand;
  } catch {
    return;
  }
  if (command.op === 'load') {
    load(command);
    return;
  }
  if (!hasMedia || !player) return;
  const current = player;
  switch (command.op) {
    case 'play':
      wantPlay = true;
      if (current.status === 'error' && openedUrl) {
        // After an error the player has let the stream go and needs it again.
        open(openedUrl, position(current), openedType);
      } else {
        if (ended) {
          ended = false;
          current.currentTime = 0;
        }
        current.play();
      }
      emitState();
      return;
    case 'pause':
      wantPlay = false;
      current.pause();
      emitState();
      return;
    case 'seek': {
      if (!isFinite(command.position)) return;
      const target = Math.max(0, command.position);
      ended = false;
      current.currentTime = target;
      emit({ type: 'player', event: 'seeked', load: loadId, position: target });
      emitTime();
      return;
    }
    case 'audio': {
      const track = audioTracks.find((item, index) => trackId('a', item, index) === command.id);
      if (track) current.audioTrack = track;
      return;
    }
    case 'text': {
      textChosen = true;
      if (command.id === null) {
        current.subtitleTrack = null;
        return;
      }
      const track = textTracks.find((item, index) => trackId('t', item, index) === command.id);
      if (track) current.subtitleTrack = track;
      return;
    }
    case 'release':
      release();
      return;
  }
}

function hostInfo() {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const android = (Platform.constants ?? {}) as {
    Release?: string;
    Manufacturer?: string;
    Model?: string;
  };
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return {
    appVersion: version,
    versionCode: major * 1_000_000 + minor * 1_000 + patch,
    sdk: typeof Platform.Version === 'number' ? Platform.Version : 0,
    release: android.Release ?? '',
    manufacturer: android.Manufacturer ?? '',
    model: android.Model ?? '',
    webView: '',
    tv: false,
    fireTv: false,
    lowRam: false,
  };
}

const host = {
  protocol: () => PROTOCOL,
  hostInfo: () => JSON.stringify(hostInfo()),
  capabilities: () => JSON.stringify(PHONE_CAPABILITIES),
  exit: () => BackHandler.exitApp(),
  openExternal: (url: string) => {
    if (/^https:\/\//i.test(url)) Linking.openURL(url).catch(() => undefined);
  },
  player: (command: string) => handle(command),
};

let installed = false;

/** modules/banner-relaunch: BannerTV opened again from the launcher while running. */
interface RelaunchModule {
  addListener(event: 'relaunch', listener: () => void): { remove(): void };
}

/**
 * Makes the shared code see an Android host. Call before anything asks `isAndroid()`, and
 * before `initAndroid()`, which wires the host's news to the player.
 */
export function installPhoneHost(): void {
  if (installed) return;
  installed = true;
  window.BannerAndroid = host;
  // Not on every return to the front, which would ask "Who's watching?" after any app switch:
  // only a tap on the launcher icon, as on the Android TV app.
  requireOptionalNativeModule<RelaunchModule>('BannerRelaunch')?.addListener('relaunch', () =>
    emit({ type: 'relaunch' }),
  );
  AppState.addEventListener('change', (next) => {
    // Nothing plays in the background (the TV app does the same), except in picture-in-picture.
    // The player screen pauses the session too; the state news follows its pause command, so
    // the session knows the viewer paused. Sent from here first, it would leave a stream still
    // opening stuck as loading.
    if (next !== 'background') return;
    setTimeout(() => {
      if (AppState.currentState === 'active' || pictureInPicture.get()) return;
      if (hasMedia && player) {
        wantPlay = false;
        player.pause();
      }
    }, BACKGROUND_PAUSE_DELAY_MS);
  });
}
