import { describe, expect, it, vi } from 'vitest';
import { installAbortController, installFocusPreventScroll } from './legacy';

interface Win {
  AbortController?: unknown;
  AbortSignal?: unknown;
  fetch?: typeof fetch;
}

type Controller = { signal: unknown; abort(reason?: unknown): void };
type ControllerClass = new () => Controller;

/** A fetch that answers when told to, like a slow addon. */
function slowFetch() {
  const asked: Array<{ init: RequestInit | undefined; answer: (response: Response) => void }> = [];
  const fetchFn = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => asked.push({ init, answer: resolve })),
  );
  return { fetchFn, asked };
}

describe('AbortController on an engine without it', () => {
  it('is left alone where the engine has one', () => {
    const win: Win = { AbortController: class {}, fetch: vi.fn() };
    const before = win.fetch;
    expect(installAbortController(win)).toBe(false);
    expect(win.fetch).toBe(before);
  });

  it('rejects a fetch with an AbortError once its signal aborts', async () => {
    const { fetchFn, asked } = slowFetch();
    const win: Win = { fetch: fetchFn as unknown as typeof fetch };
    expect(installAbortController(win)).toBe(true);
    const controller = new (win.AbortController as ControllerClass)();
    const request = win.fetch!('https://addon.example/manifest.json', {
      signal: controller.signal as AbortSignal,
      credentials: 'omit',
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    // The old engine is never handed the signal it does not know.
    expect(asked[0]!.init).toEqual({ credentials: 'omit' });
  });

  it('answers as the engine does when nothing aborts', async () => {
    const { fetchFn, asked } = slowFetch();
    const win: Win = { fetch: fetchFn as unknown as typeof fetch };
    installAbortController(win);
    const controller = new (win.AbortController as ControllerClass)();
    const request = win.fetch!('https://addon.example/manifest.json', {
      signal: controller.signal as AbortSignal,
    });
    const response = { ok: true } as Response;
    asked[0]!.answer(response);
    await expect(request).resolves.toBe(response);
    // Aborting afterwards changes nothing.
    controller.abort();
  });

  it('refuses at once a fetch whose signal has already aborted', async () => {
    const { fetchFn } = slowFetch();
    const win: Win = { fetch: fetchFn as unknown as typeof fetch };
    installAbortController(win);
    const controller = new (win.AbortController as ControllerClass)();
    controller.abort();
    await expect(
      win.fetch!('https://addon.example/', { signal: controller.signal as AbortSignal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes a fetch without a signal straight through', async () => {
    const { fetchFn, asked } = slowFetch();
    const win: Win = { fetch: fetchFn as unknown as typeof fetch };
    installAbortController(win);
    void win.fetch!('https://addon.example/', { headers: { Accept: 'application/json' } });
    expect(asked[0]!.init).toEqual({ headers: { Accept: 'application/json' } });
  });

  it('tells listeners and onabort once, with the reason', () => {
    const win: Win = {};
    installAbortController(win);
    const controller = new (win.AbortController as ControllerClass)();
    const signal = controller.signal as {
      aborted: boolean;
      reason: unknown;
      onabort: (() => void) | null;
      addEventListener(type: string, listener: () => void): void;
      removeEventListener(type: string, listener: () => void): void;
    };
    const heard = vi.fn();
    const removed = vi.fn();
    signal.onabort = vi.fn();
    signal.addEventListener('abort', heard);
    signal.addEventListener('abort', removed);
    signal.removeEventListener('abort', removed);
    controller.abort('timeout');
    controller.abort('again');
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('timeout');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(signal.onabort).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});

/** An element in a scrolled row, on an engine whose focus() scrolls whatever it likes. */
function scrollingPage(readsOptions: boolean) {
  const row = { scrollTop: 0, scrollLeft: 0, parentElement: null as unknown };
  const screen = { scrollTop: 40, scrollLeft: 0, parentElement: null };
  row.parentElement = screen;
  const win = { pageXOffset: 0, pageYOffset: 0, scrollTo: vi.fn() };
  const focused: unknown[] = [];
  const proto = {
    focus(this: unknown, options?: FocusOptions) {
      if (readsOptions) void options?.preventScroll;
      focused.push(this);
      // What Chromium 63 does on focus: shows the tile, whatever was asked.
      row.scrollLeft = 300;
      screen.scrollTop = 0;
      win.pageYOffset = 20;
    },
  };
  const tile = { parentElement: row, focus: proto.focus } as unknown as HTMLElement;
  return { proto, tile, row, screen, win, focused };
}

describe('focus({ preventScroll }) on an engine that ignores it', () => {
  it('is left alone where focus() reads its options', () => {
    const { proto, tile, win } = scrollingPage(true);
    const before = proto.focus;
    expect(installFocusPreventScroll(proto as never, tile, win as never)).toBe(false);
    expect(proto.focus).toBe(before);
  });

  it('puts back every scroll the focus moved', () => {
    const { proto, tile, row, screen, win, focused } = scrollingPage(false);
    expect(installFocusPreventScroll(proto as never, tile, win as never)).toBe(true);
    focused.length = 0;
    win.pageYOffset = 0;
    row.scrollLeft = 0;
    screen.scrollTop = 40;
    proto.focus.call(tile, { preventScroll: true });
    expect(focused).toEqual([tile]);
    expect(row.scrollLeft).toBe(0);
    expect(screen.scrollTop).toBe(40);
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('lets a plain focus scroll as it always did', () => {
    const { proto, tile, row, win } = scrollingPage(false);
    installFocusPreventScroll(proto as never, tile, win as never);
    row.scrollLeft = 0;
    proto.focus.call(tile);
    expect(row.scrollLeft).toBe(300);
  });
});
