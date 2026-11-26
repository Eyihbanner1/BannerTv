import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyCode } from '../navigation/keys';

type Tizen = typeof import('./tizen');

/** User agents as Samsung's TV apps send them. */
const UA = {
  tizen50:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36',
  tizen55:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) 69.0.3497.106.1/5.5 TV Safari/537.36',
  tizen60:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36',
  tizen40:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.36 (KHTML, like Gecko) 56.0.2924.0/4.0 TV Safari/537.36',
  webos22:
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager',
};

/** KeyboardEvent as far as the app reads it; Node has none. */
class FakeKeyboardEvent extends Event {
  key: string;
  repeat: boolean;
  keyCode = 0;
  constructor(type: string, init: { key?: string; repeat?: boolean; bubbles?: boolean } = {}) {
    super(type, { bubbles: init.bubbles, cancelable: true });
    this.key = init.key ?? '';
    this.repeat = init.repeat ?? false;
  }
}

/** A key as the Samsung TV sends it, on window. */
function samsungKey(type: 'keydown' | 'keyup', keyCode: number, repeat = false): FakeKeyboardEvent {
  const event = new FakeKeyboardEvent(type, { repeat });
  event.keyCode = keyCode;
  page.dispatchEvent(event);
  return event;
}

interface Calls {
  exit: number;
  registered: string[];
  launched: Array<{ appId: string | null; control: unknown }>;
}

let calls: Calls;
let page: EventTarget;
let focused: EventTarget;
let pressed: Array<{ type: string; keyCode: number; key: string; repeat: boolean }>;
let video: { paused: boolean } | null;
let classes: Set<string>;

class Control {
  constructor(
    readonly operation: string,
    readonly uri: string | null,
    readonly mime: string | null,
    readonly category: string | null,
    readonly data: unknown[] | null,
  ) {}
}

class ControlData {
  constructor(
    readonly key: string,
    readonly value: string[],
  ) {}
}

/** The page as a packaged Tizen app sees it, with `webapis` when the TV loaded Samsung's script. */
function onSamsung(
  userAgent = UA.tizen50,
  webapis?: Record<string, unknown>,
  launch: 'ok' | 'fail' = 'ok',
) {
  calls = { exit: 0, registered: [], launched: [] };
  vi.stubGlobal('navigator', { userAgent });
  page = Object.assign(new EventTarget(), {
    tizen: {
      application: {
        getCurrentApplication: () => ({ exit: () => calls.exit++ }),
        launchAppControl: (
          control: unknown,
          appId: string | null,
          onSuccess: () => void,
          onError: (error: { message: string }) => void,
        ) => {
          calls.launched.push({ appId, control });
          if (launch === 'ok') onSuccess();
          else onError({ message: 'NotFoundError' });
        },
      },
      ApplicationControl: Control,
      ApplicationControlData: ControlData,
      tvinputdevice: {
        registerKey: (name: string) => {
          // A key this TV's remotes lack.
          if (name === 'ColorF3Blue') throw new Error('InvalidValuesError');
          calls.registered.push(name);
        },
      },
      systeminfo: { getCapability: () => 'UE50RU7470' },
    },
    webapis,
  });
  vi.stubGlobal('window', page);
}

async function load(): Promise<Tizen> {
  vi.resetModules();
  return import('./tizen');
}

beforeEach(() => {
  pressed = [];
  focused = new EventTarget();
  for (const type of ['keydown', 'keyup']) {
    focused.addEventListener(type, (event) => {
      const key = event as FakeKeyboardEvent;
      pressed.push({ type, keyCode: key.keyCode, key: key.key, repeat: key.repeat });
    });
  }
  video = null;
  classes = new Set();
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      activeElement: focused,
      body: new EventTarget(),
      querySelector: () => video,
      documentElement: { classList: { add: (name: string) => classes.add(name) } },
    }),
  );
  vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the user agent', () => {
  it('names the Tizen release', async () => {
    const tizen = await load();
    expect(tizen.parseTizenRelease(UA.tizen50)).toBe(5);
    expect(tizen.parseTizenRelease(UA.tizen55)).toBe(5.5);
    expect(tizen.parseTizenRelease(UA.webos22)).toBeNull();
  });

  it('gives the Chromium from the user agent, or from the release on a 2019 TV', async () => {
    const tizen = await load();
    expect(tizen.tizenEngine(UA.tizen50)).toEqual({ release: 5, chromium: 63 });
    expect(tizen.tizenEngine(UA.tizen55)).toEqual({ release: 5.5, chromium: 69 });
    expect(tizen.tizenEngine(UA.tizen60)).toEqual({ release: 6, chromium: 76 });
    expect(tizen.tizenEngine(UA.tizen40)).toEqual({ release: 4, chromium: 56 });
    expect(tizen.tizenEngine(UA.webos22)).toEqual({ release: null, chromium: null });
  });

  it('maps every release to the Chromium it ships', async () => {
    const tizen = await load();
    expect(tizen.chromiumForTizen(6.5)).toBe(85);
    expect(tizen.chromiumForTizen(9)).toBe(120);
    expect(tizen.chromiumForTizen(10)).toBe(120);
    expect(tizen.chromiumForTizen(2.4)).toBeNull();
  });
});

describe('off Samsung', () => {
  it('finds no Tizen, and every call does nothing', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', { userAgent: UA.webos22 });
    const tizen = await load();
    expect(tizen.isTizen()).toBe(false);
    expect(tizen.tizenFacts()).toBeNull();
    expect(tizen.tizenCapabilities()).toBeNull();
    tizen.initTizen();
    await expect(tizen.playTrailerOnTizen('abc')).rejects.toThrow();
  });

  it("takes Samsung's browser, which has no tizen object, for something else", async () => {
    vi.stubGlobal('window', { webapis: {} });
    const tizen = await load();
    expect(tizen.isTizen()).toBe(false);
  });
});

describe('what the TV can play', () => {
  it("reads Samsung's product APIs, with no Dolby Vision, TrueHD or DTS on a 2019 TV", async () => {
    onSamsung(UA.tizen50, {
      productinfo: {
        getRealModel: () => 'UE50RU7470UXXU',
        getModelCode: () => '19_MUSEL_UHD',
        getFirmware: () => 'T-MSLDEUC-1340.5',
        isUdPanelSupported: () => true,
        is8KPanelSupported: () => false,
      },
      avinfo: { isHdrTvSupport: () => true },
    });
    const tizen = await load();
    expect(tizen.isTizen()).toBe(true);
    expect(tizen.tizenFacts()).toEqual({
      release: 5,
      model: 'UE50RU7470UXXU',
      modelCode: '19_MUSEL_UHD',
      firmware: 'T-MSLDEUC-1340.5',
      uhd: true,
      uhd8k: false,
      hdr: true,
    });
    expect(tizen.tizenCapabilities()).toEqual({
      uhd: true,
      hdr10: true,
      dolbyVision: false,
      dts: false,
      truehd: false,
    });
  });

  it("leaves a fact unknown when Samsung's script did not load or a call throws", async () => {
    onSamsung(UA.tizen60, {
      productinfo: {
        isUdPanelSupported: () => {
          throw new Error('SecurityError');
        },
      },
    });
    const tizen = await load();
    expect(tizen.tizenFacts()).toMatchObject({
      model: 'UE50RU7470',
      firmware: null,
      uhd: null,
      hdr: null,
    });
    onSamsung(UA.tizen60);
    expect(tizen.tizenCapabilities()).toMatchObject({ uhd: null, hdr10: null });
  });

  it('knows DTS only for the years Samsung left it out', async () => {
    const tizen = await load();
    expect(tizen.dtsForTizen(3)).toBeNull();
    expect(tizen.dtsForTizen(4)).toBe(false);
    expect(tizen.dtsForTizen(6.5)).toBe(false);
    expect(tizen.dtsForTizen(7)).toBeNull();
    expect(tizen.dtsForTizen(null)).toBeNull();
  });
});

describe('the remote', () => {
  it('asks for the media, colour and digit keys, and goes on past one the TV refuses', async () => {
    onSamsung();
    const tizen = await load();
    tizen.initTizen();
    expect(calls.registered).toContain('MediaPlayPause');
    expect(calls.registered).toContain('ColorF0Red');
    expect(calls.registered).toContain('9');
    expect(calls.registered).not.toContain('ColorF3Blue');
    expect(calls.registered).toHaveLength(tizen.REGISTERED_KEYS.length - 1);
  });

  it("presses LG's Back for Samsung's, and nothing else sees Samsung's code", async () => {
    onSamsung();
    const tizen = await load();
    tizen.initTizen();
    const down = samsungKey('keydown', tizen.TizenKey.Back);
    const up = samsungKey('keyup', tizen.TizenKey.Back);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(pressed).toEqual([
      { type: 'keydown', keyCode: KeyCode.Back, key: 'GoBack', repeat: false },
      { type: 'keyup', keyCode: KeyCode.Back, key: 'GoBack', repeat: false },
    ]);
  });

  it('holds Back as a repeat with no keyup, as the LG does', async () => {
    onSamsung();
    const tizen = await load();
    tizen.initTizen();
    samsungKey('keydown', tizen.TizenKey.Back, true);
    expect(pressed).toEqual([
      { type: 'keydown', keyCode: KeyCode.Back, key: 'GoBack', repeat: true },
    ]);
  });

  it('works Play/Pause out from the player', async () => {
    onSamsung();
    const tizen = await load();
    tizen.initTizen();
    samsungKey('keydown', tizen.TizenKey.PlayPause);
    video = { paused: false };
    samsungKey('keydown', tizen.TizenKey.PlayPause);
    video = { paused: true };
    samsungKey('keydown', tizen.TizenKey.PlayPause);
    expect(pressed.filter((key) => key.type === 'keydown').map((key) => key.keyCode)).toEqual([
      KeyCode.Play,
      KeyCode.Pause,
      KeyCode.Play,
    ]);
  });

  it("presses OK for the keyboard's Done, and one Back for its Cancel and a Back right after", async () => {
    onSamsung();
    const tizen = await load();
    tizen.initTizen();
    samsungKey('keydown', tizen.TizenKey.Done);
    samsungKey('keydown', tizen.TizenKey.Cancel);
    samsungKey('keydown', tizen.TizenKey.Back);
    expect(pressed.filter((key) => key.type === 'keydown').map((key) => key.keyCode)).toEqual([
      KeyCode.Ok,
      KeyCode.Back,
    ]);
  });

  it('leaves the keys that already match the LG alone', async () => {
    onSamsung();
    const tizen = await load();
    tizen.initTizen();
    const down = samsungKey('keydown', KeyCode.Play);
    samsungKey('keydown', KeyCode.Red);
    expect(down.defaultPrevented).toBe(false);
    expect(pressed).toEqual([]);
  });
});

describe('the app', () => {
  it('leaves through Tizen when Back reaches the root screen', async () => {
    onSamsung();
    const tizen = await load();
    const { EXIT_EVENT } = await import('./webos');
    tizen.initTizen();
    page.dispatchEvent(new Event(EXIT_EVENT));
    expect(calls.exit).toBe(1);
  });

  it('asks again on a relaunch', async () => {
    onSamsung();
    const tizen = await load();
    const onRelaunch = vi.fn();
    tizen.initTizen({ onRelaunch });
    page.dispatchEvent(new Event('appcontrol'));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it('turns on low-power mode on 2019 and 2020 TVs only', async () => {
    onSamsung(UA.tizen55);
    (await load()).initTizen();
    expect(classes.has('low-power')).toBe(true);
    classes.clear();
    onSamsung(UA.tizen60);
    (await load()).initTizen();
    expect(classes.has('low-power')).toBe(false);
  });

  it("opens a trailer in Samsung's YouTube app", async () => {
    onSamsung();
    const tizen = await load();
    await tizen.playTrailerOnTizen('dQw4w9WgXcQ');
    expect(calls.launched).toHaveLength(1);
    const { appId, control } = calls.launched[0]!;
    expect(appId).toBe(tizen.TIZEN_YOUTUBE_APP_ID);
    expect(control).toMatchObject({
      operation: 'http://tizen.org/appcontrol/operation/view',
      data: [{ key: 'PAYLOAD', value: ['{"values":"v=dQw4w9WgXcQ"}'] }],
    });
  });

  it('says so when YouTube does not open', async () => {
    onSamsung(UA.tizen50, undefined, 'fail');
    const tizen = await load();
    await expect(tizen.playTrailerOnTizen('abc')).rejects.toThrow('NotFoundError');
  });
});
