import type { TvCapabilities } from '@bannertv/core';
import { KeyCode } from '../navigation/keys';
import { EXIT_EVENT } from './webos';

/**
 * The bridge to the Android app (apps/androidtv), which shows this same build
 * in a WebView and plays video in Android's own player underneath it. The
 * protocol is in docs/adr/0005-android-tv-app.md. On webOS and in a browser
 * none of it exists, and every call here does nothing.
 */
interface AndroidHost {
  protocol(): string;
  hostInfo(): string;
  capabilities(): string;
  exit(): void;
  openExternal(url: string): void;
  player(command: string): void;
  /** The stream helper for the LG. Missing from apps built before it. */
  helper?(command: string): void;
  helperState?(): string;
  /**
   * Added to version 1 later, so missing from an older app and from the
   * phone's stand-in: replaces BannerTV's cards on the system's Watch Next row.
   */
  watchNext?(cards: string): void;
  /** Added later too: the link the app was opened with, as JSON, once; "" when none. */
  takeLink?(): string;
}

/** The Android app, as it describes itself. */
export interface AndroidHostInfo {
  appVersion: string;
  versionCode: number;
  sdk: number;
  release: string;
  manufacturer: string;
  model: string;
  webView: string;
  tv: boolean;
  fireTv: boolean;
  lowRam: boolean;
}

/** An audio or subtitle track as Android's player lists it. */
export interface AndroidTrack {
  /** "<group>:<track>" in the player's own track list. */
  id: string;
  lang: string;
  label: string;
  active: boolean;
  supported: boolean;
  /** Audio: the channel count, when the file gives one. */
  channels?: number;
  mime?: string;
  codecs?: string;
  commentary?: boolean;
  forced?: boolean;
}

/** One line group of the subtitles inside the file, as Android's player hands it over. */
export interface AndroidCue {
  /** With <b>, <i> and <u>, and &, < and > escaped; \n between lines. */
  text: string;
  /** Placed at the top of the picture. */
  top?: boolean;
}

/**
 * News from Android's player. `load` is the id of the load command it is about, so news about a
 * stream the page has already moved on from can be told apart.
 */
export type AndroidPlayerEvent = { load?: number } & (
  | {
      type: 'player';
      event: 'state';
      playWhenReady: boolean;
      playing: boolean;
      buffering: boolean;
      ready: boolean;
      ended: boolean;
      position: number;
      /** Seconds; null while unknown, -1 for a live stream with no end. */
      duration: number | null;
      live: boolean;
    }
  | { type: 'player'; event: 'time'; position: number; duration: number | null }
  | { type: 'player'; event: 'seeked'; position: number }
  | { type: 'player'; event: 'tracks'; audio: AndroidTrack[]; text: AndroidTrack[] }
  /**
   * What shows from `at` (seconds on the player's clock) for subtitle track `track`, until the
   * next cues event: none when empty. Sent only after a text command with `cues: true`.
   */
  | { type: 'player'; event: 'cues'; track: string; at: number; cues: AndroidCue[] }
  | {
      type: 'player';
      event: 'error';
      kind: 'format' | 'network' | 'decode' | 'other';
      message: string;
      detail?: string;
    }
);

export type AndroidEvent =
  | { type: 'key'; key: string; repeat?: boolean }
  | { type: 'keyboard'; visible: boolean }
  | { type: 'relaunch' }
  /** Opened from a link while running, such as a Watch Next card: takeLink() hands it over. */
  | { type: 'open' }
  | AndroidPlayerEvent;

export type AndroidPlayerCommand =
  | {
      op: 'load';
      id: number;
      url: string;
      startAt: number;
      mime: string;
      /** Request headers the addon asks to be sent with the link, for every request of the stream. */
      headers?: Record<string, string>;
    }
  | { op: 'play' }
  | { op: 'pause' }
  | { op: 'seek'; position: number }
  | { op: 'audio'; id: string }
  /** cues: the page draws the file's own subtitles, so Android sends them rather than show them. */
  | { op: 'text'; id: string | null; cues?: true }
  | { op: 'release' };

declare global {
  interface Window {
    /** Set by the Android app before the page loads. */
    BannerAndroid?: AndroidHost;
    /** Where the Android app sends its events. */
    __bannerAndroid?: { event(event: AndroidEvent): void };
  }
}

function host(): AndroidHost | undefined {
  const bridge = window.BannerAndroid;
  return bridge && typeof bridge.protocol === 'function' ? bridge : undefined;
}

export function isAndroid(): boolean {
  return host() !== undefined;
}

function readJson<T>(read: () => string): T | null {
  try {
    return JSON.parse(read()) as T;
  } catch {
    return null;
  }
}

let info: AndroidHostInfo | null | undefined;

export function androidHostInfo(): AndroidHostInfo | null {
  const bridge = host();
  if (!bridge) return null;
  if (info === undefined) info = readJson<AndroidHostInfo>(() => bridge.hostInfo());
  return info;
}

/**
 * What the device can decode and pass to the TV or receiver. Nothing is known off Android.
 * Android's player always sends an addon's request headers (the build ships inside the app).
 */
export function androidCapabilities(): Omit<TvCapabilities, 'webOS'> | null {
  const bridge = host();
  if (!bridge) return null;
  const facts = readJson<Partial<Record<keyof TvCapabilities, unknown>>>(() =>
    bridge.capabilities(),
  );
  if (!facts) return null;
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
  return {
    uhd: flag(facts.uhd),
    hdr10: flag(facts.hdr10),
    dolbyVision: flag(facts.dolbyVision),
    hevc: flag(facts.hevc),
    av1: flag(facts.av1),
    dts: flag(facts.dts),
    truehd: flag(facts.truehd),
    requestHeaders: true,
  };
}

/** The stream helper this device runs for a TV on the home network (apps/androidtv helper/). */
export interface AndroidHelperState {
  on: boolean;
  /** The home-network address the TV types in; null while not on Wi-Fi or Ethernet. */
  address?: string | null;
  port?: number;
  /** Six digits, shown on the phone and typed on the TV once. */
  code?: string;
  /** How many TVs have paired. */
  paired: number;
}

/** The helper's state, or null off Android or in an app built before the helper. */
export function androidHelperState(): AndroidHelperState | null {
  const bridge = host();
  if (!bridge || typeof bridge.helperState !== 'function') return null;
  const read = bridge.helperState.bind(bridge);
  const state = readJson<Partial<AndroidHelperState>>(read);
  if (!state || typeof state.on !== 'boolean') return null;
  return {
    on: state.on,
    address: typeof state.address === 'string' ? state.address : null,
    port: typeof state.port === 'number' ? state.port : undefined,
    code: typeof state.code === 'string' ? state.code : undefined,
    paired: typeof state.paired === 'number' ? state.paired : 0,
  };
}

/** Turns the stream helper on or off, or unpairs every TV. */
export function sendHelperCommand(command: 'start' | 'stop' | 'forget'): void {
  host()?.helper?.(command);
}

export function sendPlayerCommand(command: AndroidPlayerCommand): void {
  host()?.player(JSON.stringify(command));
}

/** Opens an https address in another app on the device, such as YouTube for a trailer. */
export function openExternal(url: string): void {
  host()?.openExternal(url);
}

/**
 * Publishes to the system's own "Continue watching" row (Watch Next), or
 * null when this Android app cannot: an older build, or the phone's player.
 * Android itself does nothing on a phone, a Fire TV or before Android 8.
 * Each list replaces the last; an empty one empties the row.
 */
export function androidWatchNext(): ((cards: readonly object[]) => void) | null {
  const bridge = host();
  const watchNext = bridge?.watchNext;
  if (!bridge || typeof watchNext !== 'function') return null;
  return (cards) => watchNext.call(bridge, JSON.stringify({ cards }));
}

/**
 * The link Android was opened with and holds for the page, read once (the
 * next read gives nothing), or null when there is none. What it says is
 * checked by whoever opens it: another app can send one.
 */
export function takeAndroidLink(): unknown {
  const bridge = host();
  const takeLink = bridge?.takeLink;
  if (!bridge || typeof takeLink !== 'function') return null;
  // "" when nothing waits, which is no JSON.
  return readJson<unknown>(() => takeLink.call(bridge));
}

const playerListeners = new Set<(event: AndroidPlayerEvent) => void>();

/** Android's player events, until the returned function is called. */
export function onAndroidPlayer(listener: (event: AndroidPlayerEvent) => void): () => void {
  playerListeners.add(listener);
  return () => playerListeners.delete(listener);
}

/**
 * Android names for the remote keys the WebView never passes on, and the LG
 * codes the app already answers. MediaPlayPause is worked out from the player.
 */
const KEY_CODES: Record<string, number> = {
  Back: KeyCode.Back,
  MediaPlay: KeyCode.Play,
  MediaPause: KeyCode.Pause,
  MediaStop: KeyCode.Stop,
  MediaFastForward: KeyCode.FastForward,
  MediaRewind: KeyCode.Rewind,
  Red: KeyCode.Red,
  Green: KeyCode.Green,
  Yellow: KeyCode.Yellow,
  Blue: KeyCode.Blue,
};

/** The LG key code for an Android key name, or undefined for a key the app has no use for. */
export function keyCodeFor(key: string, videoPaused: boolean): number | undefined {
  // Most Fire TV and Google TV remotes have one Play/Pause button.
  if (key === 'MediaPlayPause') return videoPaused ? KeyCode.Play : KeyCode.Pause;
  return KEY_CODES[key];
}

/** Presses `keyCode` as the TV would: keydown then keyup, on whatever has focus. */
function pressKey(keyCode: number, key: string, repeat: boolean): void {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup'] as const) {
    if (type === 'keyup' && repeat) break;
    const event = new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
    // keyCode cannot be set through the constructor; the app reads it, as the TV sends it.
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    Object.defineProperty(event, 'which', { get: () => keyCode });
    target.dispatchEvent(event);
  }
}

function playerPaused(): boolean {
  // Not the link test's hidden element, which stays in the page once used.
  const video = document.querySelector<HTMLVideoElement>('video:not([aria-hidden])');
  return video ? video.paused : true;
}

export interface AndroidHooks {
  /** The app came back to the front, as webOSRelaunch does on the TV. */
  onRelaunch?: () => void;
  /** The app was opened from a link while running; takeAndroidLink() has it. */
  onOpen?: () => void;
}

/**
 * Connects the app to the Android host: its remote keys, keyboard and
 * lifecycle events, and leaving the app from the root screen. Does nothing
 * off Android.
 */
export function initAndroid(hooks: AndroidHooks = {}): void {
  const bridge = host();
  if (!bridge) return;
  window.__bannerAndroid = {
    event(event) {
      switch (event.type) {
        case 'key': {
          const keyCode = keyCodeFor(event.key, playerPaused());
          if (keyCode !== undefined) {
            pressKey(keyCode, event.key === 'Back' ? 'GoBack' : event.key, event.repeat === true);
          }
          return;
        }
        case 'keyboard':
          // Text fields listen for the event webOS sends when its keyboard opens or closes.
          document.dispatchEvent(
            new CustomEvent('keyboardStateChange', { detail: { visibility: event.visible } }),
          );
          return;
        case 'relaunch':
          hooks.onRelaunch?.();
          return;
        case 'open':
          hooks.onOpen?.();
          return;
        case 'player':
          playerListeners.forEach((listener) => listener(event));
          return;
      }
    },
  };
  // Back on the root screen asks to leave the app (platformBack off webOS).
  window.addEventListener(EXIT_EVENT, () => bridge.exit());
  // A page that reloads (a profile asked for again on relaunch) runs no cleanup, so Android's
  // player may still hold the last page's stream. Nothing plays at start.
  sendPlayerCommand({ op: 'release' });
  if (androidHostInfo()?.lowRam) document.documentElement.classList.add('low-power');
}
