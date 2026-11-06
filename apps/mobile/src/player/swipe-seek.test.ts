import { describe, expect, it } from 'vitest';
import {
  isSwipe,
  startsAtEdge,
  SWIPE_EDGE_PX,
  SWIPE_START_PX,
  swipeMoves,
  swipeRange,
  swipeTarget,
} from './swipe-seek';

describe('isSwipe', () => {
  it('needs some sideways movement, more sideways than up or down', () => {
    expect(isSwipe(SWIPE_START_PX - 1, 0)).toBe(false);
    expect(isSwipe(SWIPE_START_PX, 0)).toBe(true);
    expect(isSwipe(-40, 10)).toBe(true);
    expect(isSwipe(40, 30)).toBe(false);
    expect(isSwipe(0, 80)).toBe(false);
  });
});

describe('startsAtEdge', () => {
  it("leaves the screen's edges to Android's back gesture", () => {
    expect(startsAtEdge(SWIPE_EDGE_PX - 1, 800)).toBe(true);
    expect(startsAtEdge(400, 800)).toBe(false);
    expect(startsAtEdge(800 - SWIPE_EDGE_PX + 1, 800)).toBe(true);
  });
});

describe('swipeRange', () => {
  it('grows with the length, between a minute and a half and six minutes', () => {
    expect(swipeRange(10 * 60)).toBe(90);
    expect(swipeRange(45 * 60)).toBeCloseTo(324);
    expect(swipeRange(3 * 60 * 60)).toBe(360);
    expect(swipeRange(0)).toBe(180);
    expect(swipeRange(NaN)).toBe(180);
  });
});

describe('swipeTarget', () => {
  const episode = 45 * 60;

  it('moves a whole range for a full-width swipe, either way', () => {
    const full = 800 + SWIPE_START_PX;
    expect(swipeTarget(1000, full, 800, episode)).toBe(1324);
    expect(swipeTarget(1000, -full, 800, episode)).toBe(676);
  });

  it('starts from the place playing as the touch becomes a swipe', () => {
    expect(swipeTarget(1000, SWIPE_START_PX, 800, episode)).toBe(1000);
    expect(swipeTarget(1000, -SWIPE_START_PX, 800, episode)).toBe(1000);
  });

  it('moves less than its share for a short swipe, for fine control', () => {
    const tenth = swipeTarget(1000, 80, 800, episode) - 1000;
    expect(tenth).toBeGreaterThan(5);
    expect(tenth).toBeLessThan(32);
  });

  it('keeps between the start and the last second', () => {
    expect(swipeTarget(30, -800, 800, episode)).toBe(0);
    expect(swipeTarget(episode - 20, 800, 800, episode)).toBe(episode - 1);
    expect(swipeTarget(30, 2000, 800, 0)).toBe(210);
  });

  it('gives whole seconds', () => {
    expect(Number.isInteger(swipeTarget(10.4, 33, 811, episode))).toBe(true);
  });
});

describe('swipeMoves', () => {
  it('lets a swipe go that came back to where it began', () => {
    expect(swipeMoves(100, 100.5)).toBe(false);
    expect(swipeMoves(100, 101)).toBe(true);
    expect(swipeMoves(100, 90)).toBe(true);
  });
});
