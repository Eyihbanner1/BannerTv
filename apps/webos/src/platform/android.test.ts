import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyCode } from '../navigation/keys';

type Android = typeof import('./android');

/** What the Android app was asked to do. */
interface Calls {
  exit: number;
  opened: string[];
  player: string[];
}

/** KeyboardEvent as far as the app reads it; Node has none. */
class FakeKeyboardEvent extends Event {
  key: string;
  repeat: boolean;
  constructor(type: string, init: { key: string; repeat: boolean; bubbles: boolean }) {
    super(type, init);
    this.key = init.key;
    this.repeat = init.repeat;
  }
}

let calls: Calls;
let focused: EventTarget;
let video: { paused: boolean } | null;
let classes: Set<string>;
let page: EventTarget & { __bannerAndroid?: unknown };

/** The page as the Android app shows it, with `host` given for window.BannerAndroid. */
function onAndroid(host: Record<string, unknown> = {}) {
  calls = { exit: 0, opened: [], player: [] };
  page = Object.assign(new EventTarget(), {
    BannerAndroid: {
      protocol: () => '1',
      hostInfo: () =>
        JSON.stringify({ appVersion: '0.1.0', versionCode: 1000, sdk: 34, lowRam: false }),
      capabilities: () => JSON.stringify({ uhd: true, hdr10: false, dolbyVision: null }),
      exit: () => calls.exit++,
      openExternal: (url: string) => calls.opened.push(url),
      player: (command: string) => calls.player.push(command),
      ...host,
    },
  });
  vi.stubGlobal('window', page);
}

/** A fresh copy of the module, as the page has it on start. */
async function load(): Promise<Android> {
  vi.resetModules();
  return import('./android');
}

beforeEach(() => {
  focused = new EventTarget();
  video = null;
  classes = new Set();
  const doc = Object.assign(new EventTarget(), {
    activeElement: focused,
    body: new EventTarget(),
    querySelector: () => video,
    documentElement: { classList: { add: (name: string) => classes.add(name) } },
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('off Android', () => {
  it('finds no host, and every call does nothing', async () => {
    vi.stubGlobal('window', new EventTarget());
    const android = await load();
    expect(android.isAndroid()).toBe(false);
    expect(android.androidHostInfo()).toBeNull();
    expect(android.androidCapabilities()).toBeNull();
    android.sendPlayerCommand({ op: 'play' });
    android.openExternal('https://www.youtube.com/watch?v=x');
    android.initAndroid();
    expect((window as unknown as Record<string, unknown>).__bannerAndroid).toBeUndefined();
  });

  it('takes a BannerAndroid without a protocol for something else', async () => {
    vi.stubGlobal('window', { BannerAndroid: { exit() {} } });
    const android = await load();
    expect(android.isAndroid()).toBe(false);
  });
});

describe('the Android host', () => {
  it('describes the device, and leaves unknown facts unknown', async () => {
    onAndroid({ capabilities: () => '{"uhd":true,"hdr10":false,"dolbyVision":null,"hevc":"yes"}' });
    const android = await load();
    expect(android.isAndroid()).toBe(true);
    expect(android.androidHostInfo()).toMatchObject({ appVersion: '0.1.0', versionCode: 1000 });
    expect(android.androidCapabilities()).toEqual({
      uhd: true,
      hdr10: false,
      dolbyVision: null,
      hevc: null,
      av1: null,
      dts: null,
      truehd: null,
    });
  });

  it('knows nothing from an answer it cannot read', async () => {
    onAndroid({ capabilities: () => 'not json', hostInfo: () => '' });
    const android = await load();
    expect(android.androidCapabilities()).toBeNull();
    expect(android.androidHostInfo()).toBeNull();
  });

  it('sends player commands and links to open as Android reads them', async () => {
    onAndroid();
    const android = await load();
    android.sendPlayerCommand({ op: 'seek', position: 61.5 });
    android.openExternal('https://www.youtube.com/watch?v=abc');
    expect(calls.player.map((command) => JSON.parse(command))).toEqual([
      { op: 'seek', position: 61.5 },
    ]);
    expect(calls.opened).toEqual(['https://www.youtube.com/watch?v=abc']);
  });
});

describe('keyCodeFor', () => {
  it("gives Android's keys the LG codes the app answers", async () => {
    const { keyCodeFor } = await load();
    expect(keyCodeFor('Back', true)).toBe(KeyCode.Back);
    expect(keyCodeFor('MediaFastForward', true)).toBe(KeyCode.FastForward);
    expect(keyCodeFor('Red', true)).toBe(KeyCode.Red);
    expect(keyCodeFor('Menu', true)).toBeUndefined();
  });

  it('makes the one Play/Pause button play when paused and pause when playing', async () => {
    const { keyCodeFor } = await load();
    expect(keyCodeFor('MediaPlayPause', true)).toBe(KeyCode.Play);
    expect(keyCodeFor('MediaPlayPause', false)).toBe(KeyCode.Pause);
  });
});

describe('initAndroid', () => {
  /** keydown and keyup on whatever has focus, as [type, keyCode, key]. */
  function pressed() {
    const seen: [string, number, string][] = [];
    for (const type of ['keydown', 'keyup']) {
      focused.addEventListener(type, (event) => {
        const key = event as KeyboardEvent;
        seen.push([type, key.keyCode, key.key]);
      });
    }
    return seen;
  }

  function send(event: unknown) {
    (page.__bannerAndroid as { event(event: unknown): void }).event(event);
  }

  it('presses Back as the LG remote does', async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const seen = pressed();
    send({ type: 'key', key: 'Back' });
    expect(seen).toEqual([
      ['keydown', KeyCode.Back, 'GoBack'],
      ['keyup', KeyCode.Back, 'GoBack'],
    ]);
  });

  it('holds a key down while Android repeats it', async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const seen = pressed();
    send({ type: 'key', key: 'MediaFastForward', repeat: true });
    expect(seen).toEqual([['keydown', KeyCode.FastForward, 'MediaFastForward']]);
  });

  it('turns Play/Pause into Pause while the video plays', async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const seen = pressed();
    video = { paused: false };
    send({ type: 'key', key: 'MediaPlayPause' });
    video = null;
    send({ type: 'key', key: 'MediaPlayPause' });
    expect(seen.filter(([type]) => type === 'keydown').map(([, code]) => code)).toEqual([
      KeyCode.Pause,
      KeyCode.Play,
    ]);
  });

  it('ignores keys the app has no use for', async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const seen = pressed();
    send({ type: 'key', key: 'Menu' });
    expect(seen).toEqual([]);
  });

  it("tells text fields when Android's keyboard opens and closes, as webOS does", async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const seen: unknown[] = [];
    document.addEventListener('keyboardStateChange', (event) =>
      seen.push((event as CustomEvent).detail),
    );
    send({ type: 'keyboard', visible: true });
    send({ type: 'keyboard', visible: false });
    expect(seen).toEqual([{ visibility: true }, { visibility: false }]);
  });

  it('passes on coming back to the front', async () => {
    onAndroid();
    const android = await load();
    const onRelaunch = vi.fn();
    android.initAndroid({ onRelaunch });
    send({ type: 'relaunch' });
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it('hands player news to the player until it stops listening', async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const heard = vi.fn();
    const stop = android.onAndroidPlayer(heard);
    const news = { type: 'player', event: 'seeked', position: 12 };
    send(news);
    stop();
    send(news);
    expect(heard.mock.calls).toEqual([[news]]);
  });

  it('leaves the app when Back on the root screen asks to', async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    const { EXIT_EVENT } = await import('./webos');
    window.dispatchEvent(new Event(EXIT_EVENT));
    expect(calls.exit).toBe(1);
  });

  it("lets go of anything Android's player still holds from before a reload", async () => {
    onAndroid();
    const android = await load();
    android.initAndroid();
    expect(calls.player.map((command) => JSON.parse(command))).toEqual([{ op: 'release' }]);
  });

  it('turns on low-power mode on a low-memory device', async () => {
    onAndroid({ hostInfo: () => JSON.stringify({ lowRam: true }) });
    const android = await load();
    android.initAndroid();
    expect(classes.has('low-power')).toBe(true);
  });
});
