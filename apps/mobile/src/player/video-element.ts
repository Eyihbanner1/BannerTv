/**
 * The `<video>` element the shared playback session (apps/webos/src/player/session.ts) drives.
 * On the phone nothing is drawn by it: as in the TV's Android app, the Android engine
 * (player/engines/android.ts) lays Android's player clock and controls over these properties
 * while a stream is open, and Android's own player draws the picture (src/player/phone-host.ts).
 * What is here is what is left when the engine takes its properties off again: an empty element.
 * The engine leaves the speed alone, so a speed set here goes on to Android's player (`onRate`).
 */

type Listener = (event: { type: string }) => void;

export class PhoneVideoElement {
  // The values an empty element reports. They sit on the prototype (as getters), so deleting
  // the engine's own properties falls back to them, as a real element falls back to its own.
  private time = 0;
  private rate = 1;
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly style: Record<string, string> = {};
  src = '';

  constructor(private readonly onRate?: (rate: number) => void) {}

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = Number(value) || 0;
  }

  get duration(): number {
    return NaN;
  }

  get paused(): boolean {
    return true;
  }

  get ended(): boolean {
    return false;
  }

  get seeking(): boolean {
    return false;
  }

  get readyState(): number {
    return 0;
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(value: number) {
    this.rate = Number(value) || 1;
    this.onRate?.(this.rate);
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {}

  load(): void {}

  getAttribute(): null {
    return null;
  }

  setAttribute(): void {}

  removeAttribute(): void {}

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string; target?: unknown }): boolean {
    try {
      event.target = this;
    } catch {
      // A read-only target is fine: the session never reads it.
    }
    for (const listener of Array.from(this.listeners.get(event.type) ?? [])) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[BannerTV] player listener failed:', String(error));
      }
    }
    return true;
  }
}

/** The element as the shared session's types name it. */
export function asVideoElement(element: PhoneVideoElement): HTMLVideoElement {
  return element as unknown as HTMLVideoElement;
}
