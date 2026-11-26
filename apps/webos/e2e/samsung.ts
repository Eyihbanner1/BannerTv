import type { Page } from '@playwright/test';

/**
 * The app as a 2019 Samsung TV (Tizen 5.0) runs it: the same build from
 * file://, with Tizen's `tizen` and Samsung's `webapis` in the page, and the
 * web engine held back to Chromium 63's: no AbortController, and a focus()
 * that ignores preventScroll and scrolls to the element.
 */
export const TIZEN_50_UA =
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36';

/** Samsung's YouTube app (platform/tizen.ts). */
export const SAMSUNG_YOUTUBE = '111299001912';

/** What the page asked of the TV. */
export interface SamsungCalls {
  registered: string[];
  exits: number;
  launched: Array<{ appId: string | null; operation: string; data: unknown }>;
}

declare global {
  interface Window {
    __samsungCalls?: SamsungCalls;
  }
}

/** Puts the Samsung TV's APIs in each page, and takes away what Chromium 63 lacks. Before goto. */
export async function openAsSamsung(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.AbortController;
    delete w.AbortSignal;
    const focus = HTMLElement.prototype.focus;
    // Chromium 63's focus() takes no options, and scrolls the element into view.
    HTMLElement.prototype.focus = function (this: HTMLElement) {
      focus.call(this);
    };

    const calls: SamsungCalls = { registered: [], exits: 0, launched: [] };
    window.__samsungCalls = calls;
    class ApplicationControl {
      constructor(
        readonly operation: string,
        readonly uri: string | null,
        readonly mime: string | null,
        readonly category: string | null,
        readonly data: unknown[] | null,
      ) {}
    }
    class ApplicationControlData {
      constructor(
        readonly key: string,
        readonly value: string[],
      ) {}
    }
    w.tizen = {
      application: {
        getCurrentApplication: () => ({ exit: () => calls.exits++ }),
        launchAppControl: (
          control: ApplicationControl,
          appId: string | null,
          onSuccess?: () => void,
        ) => {
          calls.launched.push({ appId, operation: control.operation, data: control.data });
          onSuccess?.();
        },
      },
      ApplicationControl,
      ApplicationControlData,
      tvinputdevice: { registerKey: (name: string) => calls.registered.push(name) },
      systeminfo: { getCapability: () => 'UE50RU7470' },
    };
    w.webapis = {
      productinfo: {
        getRealModel: () => 'UE50RU7470UXXU',
        getModelCode: () => '19_MUSEL_UHD',
        getFirmware: () => 'T-MSLDEUC-1340.5',
        isUdPanelSupported: () => true,
        is8KPanelSupported: () => false,
      },
      avinfo: { isHdrTvSupport: () => true },
    };
  });
}

/** What the page has asked of the TV so far. */
export function samsungCalls(page: Page): Promise<SamsungCalls> {
  return page.evaluate(() => window.__samsungCalls!);
}

/** Samsung's codes (platform/tizen.ts TizenKey). */
export const SamsungKey = { Back: 10009, PlayPause: 10252, Done: 65376, Cancel: 65385 } as const;

/** Presses a key as the Samsung TV sends it: its own code, keydown then keyup. */
export async function pressSamsung(page: Page, keyCode: number): Promise<void> {
  await page.evaluate((code) => {
    for (const type of ['keydown', 'keyup']) {
      const event = new KeyboardEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'keyCode', { get: () => code });
      Object.defineProperty(event, 'which', { get: () => code });
      (document.activeElement ?? document.body).dispatchEvent(event);
    }
  }, keyCode);
  await page.waitForTimeout(120);
}
