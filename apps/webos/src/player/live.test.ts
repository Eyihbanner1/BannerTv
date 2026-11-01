import { describe, expect, it } from 'vitest';
import { AUTO_LIVE_EVERY_MS, shouldReturnToLive } from './live';

const kept = { start: 0, live: 600, slack: 6 };
const fresh = { viewerBehind: false, lastAt: -Infinity, now: 1_000_000 };

describe('going back to live after a stall', () => {
  it('goes back once well behind, by the least or by three slacks', () => {
    expect(shouldReturnToLive(kept, 590, fresh)).toBe(false);
    expect(shouldReturnToLive(kept, 580, fresh)).toBe(true);
    const native = { start: 0, live: 600, slack: 10 };
    expect(shouldReturnToLive(native, 575, fresh)).toBe(false);
    expect(shouldReturnToLive(native, 570, fresh)).toBe(true);
  });

  it('leaves a viewer who moved back or paused on purpose where they are', () => {
    expect(shouldReturnToLive(kept, 300, { ...fresh, viewerBehind: true })).toBe(false);
  });

  it('goes back at most once a minute', () => {
    const now = fresh.now;
    expect(shouldReturnToLive(kept, 500, { ...fresh, lastAt: now - 1000 })).toBe(false);
    expect(shouldReturnToLive(kept, 500, { ...fresh, lastAt: now - AUTO_LIVE_EVERY_MS })).toBe(
      true,
    );
  });
});
