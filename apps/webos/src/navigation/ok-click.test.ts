import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyCode } from './keys';

vi.mock('@noriginmedia/norigin-spatial-navigation', () => ({
  getCurrentFocusKey: () => 'focused',
}));

type OkClick = typeof import('./ok-click');

/** KeyboardEvent as far as the module reads it; Node has none. */
class FakeKeyEvent extends Event {
  keyCode: number;
  constructor(type: string, keyCode: number) {
    super(type);
    this.keyCode = keyCode;
  }
}

let ok: OkClick;
let page: EventTarget;
let shown: EventTarget & { hidden: boolean };
const down = () => page.dispatchEvent(new FakeKeyEvent('keydown', KeyCode.Ok));
const up = () => page.dispatchEvent(new FakeKeyEvent('keyup', KeyCode.Ok));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  page = new EventTarget();
  vi.stubGlobal('window', page);
  shown = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', shown);
  vi.resetModules();
  ok = await import('./ok-click');
  ok.watchOkHold();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('clickCameWithOk', () => {
  it('takes a click with an OK something answered as the same press, for a moment after', () => {
    down();
    ok.answeredOk();
    up();
    expect(ok.clickCameWithOk()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(ok.clickCameWithOk()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ok.clickCameWithOk()).toBe(false);
  });

  it('takes a click while an answered OK is held as that press, however long the hold', () => {
    down();
    ok.answeredOk();
    vi.advanceTimersByTime(2000);
    expect(ok.clickCameWithOk()).toBe(true);
    up();
    vi.advanceTimersByTime(300);
    expect(ok.clickCameWithOk()).toBe(true);
  });

  it('leaves the click of an OK nothing answered to press, even just after one that was', () => {
    // OK on Watch opens the player.
    down();
    ok.answeredOk();
    up();
    // A moment later, OK with the pointer on the bar, which leaves it to the click.
    vi.advanceTimersByTime(200);
    down();
    expect(ok.clickCameWithOk()).toBe(false);
    up();
    expect(ok.clickCameWithOk()).toBe(false);
  });

  it('keeps a held OK to when it went down, whatever its repeats press', () => {
    down();
    ok.answeredOk();
    // Its repeats land on a sheet it opened, which they press nothing on.
    for (let repeat = 0; repeat < 10; repeat++) {
      vi.advanceTimersByTime(100);
      down();
    }
    expect(ok.clickCameWithOk()).toBe(true);
    up();
    expect(ok.clickCameWithOk()).toBe(true);
  });

  it('counts other keys for nothing', () => {
    down();
    ok.answeredOk();
    up();
    vi.advanceTimersByTime(100);
    page.dispatchEvent(new FakeKeyEvent('keydown', KeyCode.Right));
    page.dispatchEvent(new FakeKeyEvent('keyup', KeyCode.Right));
    expect(ok.clickCameWithOk()).toBe(true);
  });

  it('forgets an OK held when the app loses focus, which then has its key up', () => {
    // OK on Trailer opens YouTube before it comes up.
    down();
    ok.answeredOk();
    expect(ok.okWentDownOn()).toBe('focused');
    page.dispatchEvent(new Event('blur'));
    expect(ok.okWentDownOn()).toBeNull();
    // Back in the app, a click alone presses again.
    vi.advanceTimersByTime(5000);
    expect(ok.clickCameWithOk()).toBe(false);
    // And the next OK counts from its own key down.
    down();
    expect(ok.clickCameWithOk()).toBe(false);
    ok.answeredOk();
    expect(ok.clickCameWithOk()).toBe(true);
  });

  it('forgets an OK held when the app is hidden', () => {
    down();
    ok.answeredOk();
    shown.hidden = true;
    shown.dispatchEvent(new Event('visibilitychange'));
    shown.hidden = false;
    shown.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(5000);
    expect(ok.okWentDownOn()).toBeNull();
    expect(ok.clickCameWithOk()).toBe(false);
  });
});
