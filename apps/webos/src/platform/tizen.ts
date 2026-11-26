import type { TvCapabilities } from '@bannertv/core';
import { KeyCode } from '../navigation/keys';
import { playerPaused, pressKey } from '../navigation/press';
import { EXIT_EVENT } from './webos';

/**
 * Samsung TVs. Tizen runs BannerTV as a packaged web app (apps/tizen, ADR
 * 0009): the same build as the LG's, in the TV's own Chromium, with the TV's
 * media pipeline behind a plain `<video>` as on webOS. What differs lives
 * here: the remote's codes for Back and Play/Pause, the keys an app must ask
 * for, leaving the app, the YouTube app, and what the TV can play.
 *
 * `tizen` exists only inside a packaged Tizen app, never in a browser, on the
 * LG or on Android. `webapis` comes from Samsung's own script, which the .wgt's
 * index.html loads (apps/tizen/package.mjs); a TV that refuses it leaves those
 * facts unknown. Off Samsung every call here does nothing.
 */

interface TizenApplication {
  exit(): void;
}

interface TizenError {
  message?: string;
}

interface TizenApi {
  application: {
    getCurrentApplication(): TizenApplication;
    launchAppControl(
      control: unknown,
      appId: string | null,
      onSuccess?: () => void,
      onError?: (error: TizenError) => void,
    ): void;
  };
  ApplicationControl: new (
    operation: string,
    uri?: string | null,
    mime?: string | null,
    category?: string | null,
    data?: unknown[] | null,
  ) => unknown;
  ApplicationControlData: new (key: string, value: string[]) => unknown;
  tvinputdevice?: { registerKey(name: string): void };
  systeminfo?: { getCapability(key: string): unknown };
}

interface SamsungWebApis {
  productinfo?: {
    getRealModel?(): string;
    getModel?(): string;
    getModelCode?(): string;
    getFirmware?(): string;
    isUdPanelSupported?(): boolean;
    is8KPanelSupported?(): boolean;
  };
  avinfo?: { isHdrTvSupport?(): boolean };
}

declare global {
  interface Window {
    /** Tizen's Web Device API, in a packaged app only. */
    tizen?: TizenApi;
    /** Samsung's product API, from $WEBAPIS/webapis/webapis.js. */
    webapis?: SamsungWebApis;
  }
}

/** Tizen 5.0, Samsung's 2019 TVs: the oldest release BannerTV runs on. index.html has the same check in ES5. */
export const MIN_TIZEN = 5;

/**
 * The Chromium each Tizen TV release's web engine is built on, newest first.
 * Tizen 5.0's 63 is older than webOS 5.0's 68, which the build is checked
 * against: platform/legacy.ts fills in the difference.
 *
 * Source: https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
 */
const CHROMIUM_BY_RELEASE: ReadonlyArray<readonly [tizen: number, chromium: number]> = [
  [9, 120],
  [8, 108],
  [7, 94],
  [6.5, 85],
  [6, 76],
  [5.5, 69],
  [5, 63],
  [4, 56],
  [3, 47],
];

function tizenApi(): TizenApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = window.tizen;
  return api && typeof api.application === 'object' && api.application ? api : undefined;
}

/** Whether the page runs as a packaged app on a Samsung TV. */
export function isTizen(): boolean {
  return tizenApi() !== undefined;
}

/** The Tizen release a user agent names ("Tizen 5.5" is 5.5), or null for anything else. */
export function parseTizenRelease(userAgent: string): number | null {
  const match = /\bTizen (\d+)\.(\d+)/.exec(userAgent);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 10;
}

/** The Chromium a Tizen TV release ships, or null for one older than 3.0. */
export function chromiumForTizen(release: number): number | null {
  for (const [tizen, chromium] of CHROMIUM_BY_RELEASE) {
    if (release >= tizen) return chromium;
  }
  return null;
}

/**
 * A Samsung TV's release and Chromium, from its user agent. TV apps leave
 * "Chrome/" out: from 2020 the engine's version stands alone before the
 * release ("… 69.0.3497.106.1/5.5 TV Safari"), and 2019 TVs give only
 * "Version/5.0", so the Chromium comes from the release there.
 */
export function tizenEngine(userAgent: string): {
  release: number | null;
  chromium: number | null;
} {
  const release = parseTizenRelease(userAgent);
  if (release === null) return { release: null, chromium: null };
  const named =
    /Chrome\/(\d+)\./.exec(userAgent) ??
    /\) (\d+)\.\d+\.\d+\.\d+(?:\.\d+)?\/\d+\.\d+ TV\b/.exec(userAgent);
  return { release, chromium: named ? Number(named[1]) : chromiumForTizen(release) };
}

function tizenRelease(): number | null {
  return typeof navigator === 'undefined' ? null : parseTizenRelease(navigator.userAgent);
}

/** Runs one call into Samsung's APIs, which throw on a TV or firmware without it. */
function ask<T>(read: () => T | undefined): T | null {
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/** The TV as Samsung's APIs describe it, each fact null where they do not say. */
export interface TizenFacts {
  release: number | null;
  model: string | null;
  modelCode: string | null;
  firmware: string | null;
  uhd: boolean | null;
  uhd8k: boolean | null;
  hdr: boolean | null;
}

export function tizenFacts(): TizenFacts | null {
  const api = tizenApi();
  if (!api) return null;
  const product = window.webapis?.productinfo;
  const systemModel = ask(() =>
    api.systeminfo?.getCapability('http://tizen.org/system/model_name'),
  );
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
  return {
    release: tizenRelease(),
    model:
      text(ask(() => product?.getRealModel?.())) ??
      text(ask(() => product?.getModel?.())) ??
      text(systemModel),
    modelCode: text(ask(() => product?.getModelCode?.())),
    firmware: text(ask(() => product?.getFirmware?.())),
    uhd: flag(ask(() => product?.isUdPanelSupported?.())),
    uhd8k: flag(ask(() => product?.is8KPanelSupported?.())),
    hdr: flag(ask(() => window.webapis?.avinfo?.isHdrTvSupport?.())),
  };
}

/**
 * Samsung dropped DTS from its 2018 TVs (Tizen 4.0) and left it out until its
 * 2023 sets (Tizen 7.0), which decode DTS:X on some models only.
 */
export function dtsForTizen(release: number | null): boolean | null {
  if (release === null) return null;
  return release >= 4 && release < 7 ? false : null;
}

/**
 * What a Samsung TV can play, as far as its APIs and Samsung's format tables
 * tell. HEVC and AV1 are asked of the decoder itself (platform/capabilities.ts).
 * No Samsung TV plays Dolby Vision (Samsung backs HDR10+) or decodes TrueHD.
 */
export function tizenCapabilities(): Omit<TvCapabilities, 'webOS' | 'hevc' | 'av1'> | null {
  const facts = tizenFacts();
  if (!facts) return null;
  return {
    uhd: facts.uhd8k === true ? true : facts.uhd,
    hdr10: facts.hdr,
    dolbyVision: false,
    dts: dtsForTizen(facts.release),
    truehd: false,
  };
}

/** Samsung's codes for the keys the app answers under LG codes (navigation/keys.ts). */
export const TizenKey = {
  Back: 10009,
  /** The single Play/Pause button on the Samsung remote. */
  PlayPause: 10252,
  /** Done on the TV's on-screen keyboard. */
  Done: 65376,
  /** Cancel on the TV's on-screen keyboard, also what its Back sends. */
  Cancel: 65385,
} as const;

const TRANSLATED: readonly number[] = [
  TizenKey.Back,
  TizenKey.PlayPause,
  TizenKey.Done,
  TizenKey.Cancel,
];

/**
 * The keys a Tizen app gets only once it asks for them. The arrows, OK and
 * Back always come. The rest arrive under the same codes as on the LG: Play
 * 415, Pause 19, Stop 413, Fast-forward 417, Rewind 412, the colours 403 to
 * 406 and the digits 48 to 57. The Smart Remote has none of the colours or
 * digits; its "123" button shows them on screen.
 */
export const REGISTERED_KEYS: readonly string[] = [
  'MediaPlayPause',
  'MediaPlay',
  'MediaPause',
  'MediaStop',
  'MediaFastForward',
  'MediaRewind',
  'ColorF0Red',
  'ColorF1Green',
  'ColorF2Yellow',
  'ColorF3Blue',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
];

/** The LG key a Samsung key presses, or undefined for a key that needs no translating. */
export function translateTizenKey(
  keyCode: number,
  videoPaused: boolean,
): { keyCode: number; key: string } | undefined {
  switch (keyCode) {
    case TizenKey.Back:
    case TizenKey.Cancel:
      return { keyCode: KeyCode.Back, key: 'GoBack' };
    case TizenKey.PlayPause:
      return videoPaused
        ? { keyCode: KeyCode.Play, key: 'MediaPlay' }
        : { keyCode: KeyCode.Pause, key: 'MediaPause' };
    case TizenKey.Done:
      // The text box takes OK as "finished typing" (components/TextField.tsx).
      return { keyCode: KeyCode.Ok, key: 'Enter' };
    default:
      return undefined;
  }
}

/**
 * How long after the keyboard's Cancel a Back is taken as the same press. The
 * keyboard's Back closes it and sends Cancel; a firmware that sends Back as
 * well would otherwise leave the screen too.
 */
const CANCEL_THEN_BACK_MS = 400;

export interface TizenHooks {
  /** Opened again from the TV's apps while running, as webOSRelaunch on the LG. */
  onRelaunch?: () => void;
}

/**
 * Connects the app to the Samsung TV: asks for the remote's media, colour
 * and digit keys, presses Samsung's Back, Play/Pause and keyboard keys as the
 * LG keys the app answers, leaves the app from the root screen and turns on
 * the low-power mode on 2019 and 2020 sets. Does nothing off Samsung.
 */
export function initTizen(hooks: TizenHooks = {}): void {
  const api = tizenApi();
  if (!api) return;

  for (const name of REGISTERED_KEYS) {
    // A key this TV's remotes do not have throws; the rest still register.
    try {
      api.tvinputdevice?.registerKey(name);
    } catch {
      // Nothing to do: that key never comes.
    }
  }

  let cancelledAt = -Infinity;
  const onKey = (event: KeyboardEvent) => {
    if (TRANSLATED.indexOf(event.keyCode) === -1) return;
    // Nothing else sees Samsung's code: the LG key pressed below stands in for it.
    event.preventDefault();
    event.stopImmediatePropagation();
    // Its keyup went out with the press, as Android's keys do.
    if (event.type !== 'keydown') return;
    const now = Date.now();
    if (event.keyCode === TizenKey.Cancel) cancelledAt = now;
    else if (event.keyCode === TizenKey.Back && now - cancelledAt < CANCEL_THEN_BACK_MS) return;
    const pressed = translateTizenKey(event.keyCode, playerPaused());
    if (pressed) pressKey(pressed.keyCode, pressed.key, event.repeat === true);
  };
  // Capturing on window comes before spatial navigation and every element's own handler.
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  // Back on Home's first row leaves the app (platformBack off webOS).
  window.addEventListener(EXIT_EVENT, () => {
    try {
      api.application.getCurrentApplication().exit();
    } catch {
      // A TV that refuses leaves the app where it is; Home still leaves it.
    }
  });

  // Opened again from the apps bar while it runs in the background.
  if (hooks.onRelaunch) window.addEventListener('appcontrol', () => hooks.onRelaunch?.());

  const release = tizenRelease();
  if (release !== null && release < 6) document.documentElement.classList.add('low-power');
}

/** Samsung's YouTube app, on every Tizen TV. */
export const TIZEN_YOUTUBE_APP_ID = '111299001912';

/**
 * Plays a trailer in the TV's own YouTube app, which reads the video from the
 * PAYLOAD it is launched with. The form is the one its deep links are thought
 * to take; no Samsung document confirms it, so the first TV round does (ADR
 * 0009). Back in YouTube returns to BannerTV.
 */
export function playTrailerOnTizen(youtubeId: string): Promise<void> {
  const api = tizenApi();
  if (!api) return Promise.reject(new Error('Not on a Samsung TV'));
  return new Promise((resolve, reject) => {
    try {
      const payload = new api.ApplicationControlData('PAYLOAD', [
        JSON.stringify({ values: `v=${youtubeId}` }),
      ]);
      const control = new api.ApplicationControl(
        'http://tizen.org/appcontrol/operation/view',
        null,
        null,
        null,
        [payload],
      );
      api.application.launchAppControl(
        control,
        TIZEN_YOUTUBE_APP_ID,
        () => resolve(),
        (error) => reject(new Error(error?.message || 'YouTube did not open')),
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error('YouTube did not open'));
    }
  });
}
