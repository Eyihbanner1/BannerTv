/**
 * Thin wrappers over the globals the webOS web engine provides. They do what
 * LG's webOSTV.js does for the few calls BannerTV needs, without bundling it.
 * Off the TV (a laptop browser, Playwright) every call degrades to a no-op.
 */

interface WebOSSystem {
  /** JSON string: modelName, platformVersion, screenWidth, screenHeight and more. */
  deviceInfo?: string;
  identifier?: string;
  launchParams?: string;
  platformBack?: () => void;
  activate?: () => void;
  stageReady?: () => void;
}

interface ServiceBridge {
  onservicecallback: ((message: string) => void) | null;
  call(uri: string, payload: string): void;
  cancel(): void;
}

declare global {
  interface Window {
    /** webOS 22 and newer. */
    webOSSystem?: WebOSSystem;
    /** Older name, still present on newer TVs. */
    PalmSystem?: WebOSSystem;
    PalmServiceBridge?: new () => ServiceBridge;
    __BANNERTV_UNSUPPORTED__?: boolean;
  }
}

/** Fired off the TV instead of exiting, so tests and the dev build can see it. */
export const EXIT_EVENT = 'bannertv:exit';

function system(): WebOSSystem | undefined {
  return window.webOSSystem ?? window.PalmSystem;
}

export function isWebOS(): boolean {
  return system() !== undefined;
}

/**
 * Leaves the app the way LG requires from the root screen: an exit prompt on
 * webOS 6 and newer, straight to the Home launcher on 5.x.
 */
export function platformBack(): void {
  const target = system();
  if (target?.platformBack) {
    target.platformBack();
    return;
  }
  window.dispatchEvent(new CustomEvent(EXIT_EVENT));
}

export function readDeviceInfo(): Record<string, unknown> | null {
  const raw = system()?.deviceInfo;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readLaunchParams(): Record<string, unknown> {
  const raw = system()?.launchParams;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export class LunaError extends Error {
  readonly errorCode: unknown;

  constructor(uri: string, response: Record<string, unknown>) {
    super(`${uri}: ${String(response.errorText ?? 'call failed')}`);
    this.name = 'LunaError';
    this.errorCode = response.errorCode;
  }
}

/**
 * Whether a Luna answer reports a failure. returnValue is the documented
 * flag; some services leave it out and send only an errorCode, and the media
 * service answers success with errorCode 0 and errorText "No Error". It also
 * sends "No Error" with returnValue false when it fails, so the text alone means nothing.
 */
export function lunaFailed(response: Record<string, unknown>): boolean {
  if (response.returnValue === false) return true;
  if (response.returnValue === true) return false;
  const code = response.errorCode;
  return code !== undefined && code !== null && code !== 0 && code !== '0';
}

// Bridges are kept here until they answer, so they are not garbage-collected mid-call.
const pending = new Set<ServiceBridge>();

/** One-shot Luna service call, for example `luna://com.webos.service.tv.systemproperty/getSystemInfo`. */
export function lunaCall<T extends Record<string, unknown>>(
  uri: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const Bridge = window.PalmServiceBridge;
    if (!Bridge) {
      reject(new Error('PalmServiceBridge is not available (not running on a webOS TV)'));
      return;
    }
    const bridge = new Bridge();
    pending.add(bridge);
    const finish = () => {
      clearTimeout(timer);
      pending.delete(bridge);
      bridge.onservicecallback = null;
    };
    const timer = setTimeout(() => {
      finish();
      bridge.cancel();
      reject(new Error(`${uri}: no answer after ${timeoutMs} ms`));
    }, timeoutMs);
    bridge.onservicecallback = (message) => {
      finish();
      let response: Record<string, unknown>;
      try {
        response = JSON.parse(message) as Record<string, unknown>;
      } catch {
        reject(new Error(`${uri}: unreadable answer ${message}`));
        return;
      }
      if (lunaFailed(response)) {
        reject(new LunaError(uri, response));
      } else {
        resolve(response as T);
      }
    };
    bridge.call(uri, JSON.stringify(params));
  });
}

/**
 * A Luna subscription: every message goes to `onMessage` until the returned
 * function cancels it. Off the TV it does nothing.
 */
export function lunaSubscribe(
  uri: string,
  params: Record<string, unknown>,
  onMessage: (message: Record<string, unknown>) => void,
): () => void {
  const Bridge = window.PalmServiceBridge;
  if (!Bridge) return () => undefined;
  const bridge = new Bridge();
  pending.add(bridge);
  bridge.onservicecallback = (message) => {
    try {
      onMessage(JSON.parse(message) as Record<string, unknown>);
    } catch {
      onMessage({ unreadable: message });
    }
  };
  bridge.call(uri, JSON.stringify({ ...params, subscribe: true }));
  return () => {
    bridge.onservicecallback = null;
    bridge.cancel();
    pending.delete(bridge);
  };
}

/**
 * Wires the app lifecycle. With `handlesRelaunch: true` the TV sends
 * webOSRelaunch instead of restarting, and the app must bring itself forward.
 * `onRelaunch` runs once it is in front, as for someone opening it afresh.
 */
export function initLifecycle(onRelaunch?: () => void): void {
  document.addEventListener('webOSRelaunch', () => {
    system()?.activate?.();
    onRelaunch?.();
  });
  system()?.stageReady?.();
}
