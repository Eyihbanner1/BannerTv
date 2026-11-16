import type { Cue } from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MatchClock, useMatchRows } from './use-match-rows';

/*
 * The hook runs here on a small stand-in for React, enough for the hooks it uses: state, refs,
 * memos and effects after each render. A render happens when the test draws, as React would
 * after a change.
 */
const react = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    set?: (next: unknown) => void;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }
  const state = { slots: [] as Slot[], at: 0, effects: [] as Array<() => void> };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const slot = (): Slot => {
    const i = state.at++;
    if (!state.slots[i]) state.slots[i] = {};
    return state.slots[i]!;
  };
  const module = {
    useState(init: unknown) {
      const s = slot();
      if (!('value' in s)) s.value = typeof init === 'function' ? (init as () => unknown)() : init;
      if (!s.set) {
        s.set = (next: unknown) => {
          s.value =
            typeof next === 'function' ? (next as (old: unknown) => unknown)(s.value) : next;
        };
      }
      return [s.value, s.set];
    },
    useRef(init: unknown) {
      const s = slot();
      if (!('value' in s)) s.value = { current: init };
      return s.value;
    },
    useMemo(make: () => unknown, deps: unknown[]) {
      const s = slot();
      if (!same(s.deps, deps)) {
        s.value = make();
        s.deps = deps;
      }
      return s.value;
    },
    useEffect(effect: () => unknown, deps?: unknown[]) {
      const s = slot();
      if (deps && same(s.deps, deps)) return;
      s.deps = deps;
      state.effects.push(() => {
        if (s.cleanup) s.cleanup();
        const cleanup = effect();
        s.cleanup = typeof cleanup === 'function' ? (cleanup as () => void) : undefined;
      });
    },
  };
  return { state, module };
});

vi.mock('react', () => react.module);

/** Seeded lines, two seconds each, one every three seconds. */
const lines = (count: number): Cue[] =>
  Array.from({ length: count }, (_, i) => ({
    start: 100 + i * 3,
    end: 102 + i * 3,
    lines: [[{ text: `Test line ${i + 1}` }]],
  }));

let clock: MatchClock = { time: 0, speed: 1, paused: false };

/** Draws the hook as a screen would, its effects run after. */
function draw(cues: readonly Cue[] | null, pinned?: string) {
  let result!: ReturnType<typeof useMatchRows>;
  // The screen, drawn once more.
  const Screen = () => {
    react.state.at = 0;
    result = useMatchRows(cues, 0, () => clock, pinned);
  };
  Screen();
  const effects = react.state.effects.splice(0);
  for (const effect of effects) effect();
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  react.state.slots = [];
  react.state.effects = [];
  clock = { time: 0, speed: 1, paused: false };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMatchRows', () => {
  it('reads the lines around now once the clock is read', () => {
    const cues = lines(10);
    clock = { time: 107, speed: 1, paused: false };
    expect(draw(cues).rows).toEqual([]);
    vi.advanceTimersByTime(0);
    const { rows } = draw(cues);
    expect(rows.map((row) => cues[row.index]!.start)).toEqual([103, 106, 109, 112]);
  });

  it('keeps the rows it showed as the track hands over its lines again, never an empty list', () => {
    // As Android does: the lines so far, handed over again in a new list as each starts.
    const first = lines(4);
    clock = { time: 107, speed: 1, paused: false };
    draw(first);
    vi.advanceTimersByTime(0);
    const before = draw(first, '106000-0').rows;
    expect(before.map((row) => row.key)).toContain('106000-0');

    const grown = lines(5);
    const now = draw(grown, '106000-0').rows;
    // The lines around the moment last read, of the new list, the one with focus among them.
    expect(now.map((row) => grown[row.index]!.start)).toEqual([103, 106, 109, 112]);
    expect(now.map((row) => row.key)).toContain('106000-0');
    // Read again on the clock as it is.
    clock = { time: 112.5, speed: 1, paused: false };
    vi.advanceTimersByTime(0);
    const read = draw(grown, '106000-0').rows;
    expect(read.map((row) => row.key)).toContain('112000-0');
    expect(read.map((row) => row.key)).toContain('106000-0');
  });

  it('starts afresh once the list was closed', () => {
    const cues = lines(10);
    clock = { time: 107, speed: 1, paused: false };
    draw(cues);
    vi.advanceTimersByTime(0);
    expect(draw(cues).rows).not.toEqual([]);
    draw(null);
    vi.advanceTimersByTime(0);
    // Opened much later in the film: nothing kept from before is shown.
    clock = { time: 500, speed: 1, paused: false };
    expect(draw(cues).rows).toEqual([]);
  });
});
