import { describe, expect, it } from 'vitest';
import { clampToWindow, judgeLive, liveFraction, type LiveWindow } from './live';

// As hls.js reads a broadcast with 6 s segments: what the playlist lists, and its sync point.
const HLS: LiveWindow = { start: 3580, live: 3632, slack: 6 };

/**
 * Judges each distance behind live in turn, carrying each judgement on to the
 * next: "L" for live, "B" for behind.
 */
function follow(slack: number, distances: number[]): string {
  let behind = false;
  return distances
    .map((distance) => {
      behind = !judgeLive({ live: 100, slack }, 100 - distance, behind).atLive;
      return behind ? 'B' : 'L';
    })
    .join('');
}

describe('judgeLive', () => {
  it('counts as live within the slack, and says nothing of the gap', () => {
    expect(judgeLive(HLS, 3632, false)).toEqual({ behind: 0, atLive: true });
    expect(judgeLive(HLS, 3627, false)).toEqual({ behind: 0, atLive: true });
    expect(judgeLive(HLS, 3626, false)).toEqual({ behind: 0, atLive: true });
  });

  it('gives the full distance once more than the slack behind', () => {
    expect(judgeLive(HLS, 3625, false)).toEqual({ behind: 7, atLive: false });
    expect(judgeLive({ live: 7200, slack: 6 }, 7180, false)).toEqual({ behind: 20, atLive: false });
  });

  it('stays behind until within half the slack, so a wobble at the boundary does not flicker', () => {
    expect(judgeLive(HLS, 3627, true)).toEqual({ behind: 5, atLive: false });
    expect(judgeLive(HLS, 3628.9, true).atLive).toBe(false);
    expect(judgeLive(HLS, 3629, true)).toEqual({ behind: 0, atLive: true });
  });

  it('holds its state while the live point wobbles by a segment between playlist reloads', () => {
    // At the sync point, the estimate of live running up to a segment ahead.
    expect(follow(6, [0, 3, 6, -2, 5, 6, 1])).toBe('LLLLLLL');
    // 10 s back, the distance swinging by a segment either way.
    expect(follow(6, [10, 13, 16, 7, 4, 9, 4])).toBe('BBBBBBB');
    // Coming back: behind until within half the slack, then live until past the whole slack.
    expect(follow(6, [20, 6, 4, 3, 5, 6, 7])).toBe('BBBLLLB');
  });

  it('reads a position past live, as the playhead runs ahead of the sync point, as live', () => {
    expect(judgeLive(HLS, 3640, false)).toEqual({ behind: 0, atLive: true });
    expect(judgeLive(HLS, 3640, true)).toEqual({ behind: 0, atLive: true });
  });

  it('gives the whole distance when the position has fallen out of what the broadcast keeps', () => {
    expect(judgeLive(HLS, 3500, true)).toEqual({ behind: 132, atLive: false });
  });

  it('treats a slack that is missing, negative or not a number as none', () => {
    for (const slack of [0, -4, NaN]) {
      const window = { live: 100, slack };
      expect(judgeLive(window, 100, false)).toEqual({ behind: 0, atLive: true });
      expect(judgeLive(window, 99.5, false)).toEqual({ behind: 0.5, atLive: false });
      expect(judgeLive(window, 99.5, true)).toEqual({ behind: 0.5, atLive: false });
    }
  });

  it('counts any distance as live with a slack of no end', () => {
    expect(judgeLive({ live: 100, slack: Infinity }, 0, false)).toEqual({
      behind: 0,
      atLive: true,
    });
    expect(judgeLive({ live: 100, slack: Infinity }, 0, true)).toEqual({ behind: 0, atLive: true });
  });

  it('counts a reading that is not a finite number as live, with no distance', () => {
    expect(judgeLive(HLS, NaN, true)).toEqual({ behind: 0, atLive: true });
    expect(judgeLive(HLS, Infinity, false)).toEqual({ behind: 0, atLive: true });
    expect(judgeLive({ live: NaN, slack: 6 }, 10, true)).toEqual({ behind: 0, atLive: true });
  });

  it("suits each engine's reading: a seek range's end, and a TV that joins short of the end", () => {
    // Shaka: live is the seek range's end, the slack its longest segment.
    const shaka: LiveWindow = { start: 100, live: 160, slack: 4 };
    expect(judgeLive(shaka, 150, false)).toEqual({ behind: 10, atLive: false });
    expect(liveFraction(shaka, 150)).toBeCloseTo(5 / 6);
    // The TV's own player: seekable ends at 104 and it joined 12 s short, so live is 92.
    const native: LiveWindow = { start: 0, live: 92, slack: 3 };
    expect(judgeLive(native, 92, false)).toEqual({ behind: 0, atLive: true });
    expect(clampToWindow(native, 104)).toBe(92);
  });
});

describe('liveFraction', () => {
  it('runs from 0 at the start of what is kept to 1 at live', () => {
    expect(liveFraction(HLS, 3580)).toBe(0);
    expect(liveFraction(HLS, 3606)).toBe(0.5);
    expect(liveFraction(HLS, 3632)).toBe(1);
  });

  it('is clamped to the bar', () => {
    expect(liveFraction(HLS, 3500)).toBe(0);
    expect(liveFraction(HLS, 3700)).toBe(1);
  });

  it('reads a window with no length, or one the wrong way round, as live', () => {
    expect(liveFraction({ start: 50, live: 50 }, 50)).toBe(1);
    expect(liveFraction({ start: 50, live: 50 }, 10)).toBe(1);
    expect(liveFraction({ start: 60, live: 50 }, 55)).toBe(1);
  });

  it('reads a position or window that is not a finite number as live', () => {
    expect(liveFraction(HLS, NaN)).toBe(1);
    expect(liveFraction({ start: 0, live: Infinity }, 10)).toBe(1);
    expect(liveFraction({ start: NaN, live: 10 }, 5)).toBe(1);
  });
});

describe('clampToWindow', () => {
  it('leaves a target within what is kept alone', () => {
    expect(clampToWindow(HLS, 3600)).toBe(3600);
    expect(clampToWindow(HLS, 3580)).toBe(3580);
    expect(clampToWindow(HLS, 3632)).toBe(3632);
  });

  it('never goes past live, nor before the start', () => {
    expect(clampToWindow({ start: 7000, live: 7200 }, 7300)).toBe(7200);
    expect(clampToWindow({ start: 7000, live: 7200 }, 6000)).toBe(7000);
    expect(clampToWindow(HLS, Infinity)).toBe(3632);
    expect(clampToWindow(HLS, -Infinity)).toBe(3580);
  });

  it('lands on live when the window is the wrong way round, or the target is not a number', () => {
    expect(clampToWindow({ start: 60, live: 50 }, 0)).toBe(50);
    expect(clampToWindow({ start: 60, live: 50 }, 100)).toBe(50);
    expect(clampToWindow(HLS, NaN)).toBe(3632);
  });

  it('never turns a good target into one the video cannot take when an end is not a number', () => {
    // The video refuses a jump to NaN or Infinity, so the bad end holds nothing back.
    expect(clampToWindow({ start: NaN, live: 100 }, 50)).toBe(50);
    expect(clampToWindow({ start: NaN, live: 100 }, 150)).toBe(100);
    expect(clampToWindow({ start: NaN, live: 100 }, NaN)).toBe(100);
    expect(clampToWindow({ start: 20, live: NaN }, 50)).toBe(50);
    expect(clampToWindow({ start: 20, live: NaN }, 10)).toBe(20);
    expect(clampToWindow({ start: 20, live: Infinity }, 50)).toBe(50);
  });
});
