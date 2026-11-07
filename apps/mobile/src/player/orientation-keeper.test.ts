import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orientationKeeper, type Stance } from './orientation-keeper';

const SETTLE_MS = 400;

function keeper() {
  const applied: Stance[] = [];
  return { applied, keeper: orientationKeeper((stance) => applied.push(stance), SETTLE_MS) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('orientationKeeper', () => {
  it('turns the phone sideways for the player and upright again once it has settled', () => {
    const { applied, keeper: k } = keeper();
    const release = k.hold();
    expect(applied).toEqual(['landscape']);
    release();
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(applied).toEqual(['landscape']);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual(['landscape', 'upright']);
  });

  it('keeps the phone sideways when the next episode takes over while settling', () => {
    const { applied, keeper: k } = keeper();
    const first = k.hold();
    first();
    vi.advanceTimersByTime(SETTLE_MS / 2);
    const second = k.hold();
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(applied).toEqual(['landscape', 'landscape']);
    second();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(applied).toEqual(['landscape', 'landscape', 'upright']);
  });

  it('stays sideways while another player still holds it', () => {
    const { applied, keeper: k } = keeper();
    const first = k.hold();
    const second = k.hold();
    first();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(applied).toEqual(['landscape', 'landscape']);
    second();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(applied.at(-1)).toBe('upright');
  });

  it('counts a release once, however often it is called', () => {
    const { applied, keeper: k } = keeper();
    const first = k.hold();
    const second = k.hold();
    first();
    first();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(applied).not.toContain('upright');
    second();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(applied.at(-1)).toBe('upright');
  });

  it('stands the phone upright when the app starts again with no player open', () => {
    // The app started again under a sideways lock it no longer knows about.
    const { applied, keeper: k } = keeper();
    k.refresh();
    expect(applied).toEqual(['upright']);
  });

  it('turns the phone sideways again when the app comes back to the player', () => {
    const { applied, keeper: k } = keeper();
    k.hold();
    k.refresh();
    expect(applied).toEqual(['landscape', 'landscape']);
  });

  it('stands the phone upright on the next return to the front when letting go went nowhere', () => {
    // Asking for upright failed (there was no activity to ask): the next return asks again.
    const lost: Stance[] = [];
    let screen = false;
    const k = orientationKeeper((stance) => {
      if (screen) lost.push(stance);
    }, SETTLE_MS);
    const release = k.hold();
    release();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(lost).toEqual([]);
    screen = true;
    k.refresh();
    expect(lost).toEqual(['upright']);
  });

  it('leaves the decision to a release that is still settling', () => {
    const { applied, keeper: k } = keeper();
    const first = k.hold();
    first();
    k.refresh();
    expect(applied).toEqual(['landscape']);
    k.hold();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(applied).toEqual(['landscape', 'landscape']);
  });
});
