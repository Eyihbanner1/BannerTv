import type { Cue } from '@bannertv/core';
import type { MatchClock } from '@tv/screens/player/use-match-rows';
import type { Subtitles } from '@tv/screens/player/use-subtitles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimingColumn } from './TimingColumn';

/*
 * The column runs here on a small stand-in for React, enough for the hooks it uses: state, refs,
 * memos and effects after each draw. Its elements are kept as they are, not drawn, so the
 * options it hands the sheet, and which takes the remote's focus, can be read.
 */
const react = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    set?: (next: unknown) => void;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }
  const state = {
    slots: [] as Slot[],
    at: 0,
    dirty: false,
    effects: [] as Array<() => void>,
  };
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
          const value =
            typeof next === 'function' ? (next as (old: unknown) => unknown)(s.value) : next;
          if (Object.is(value, s.value)) return;
          s.value = value;
          state.dirty = true;
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
  const element = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const Fragment = Symbol('Fragment');
  return { state, module, runtime: { jsx: element, jsxs: element, Fragment } };
});

vi.mock('react', () => react.module);
vi.mock('react/jsx-runtime', () => react.runtime);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../ui/Sheet', () => ({
  SheetColumn: function SheetColumn() {},
  SheetNote: function SheetNote() {},
  SheetOption: function SheetOption() {},
}));

interface Element {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

/** Every option the column hands the sheet, in order. */
function options(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(options);
  if (!tree || typeof tree !== 'object') return [];
  const element = tree as Element;
  const own =
    typeof element.type === 'function' && element.type.name === 'SheetOption' ? [element] : [];
  return own.concat(options(element.props.children));
}

/** Seeded lines, two seconds each, one every three seconds. */
const LINES: Cue[] = Array.from({ length: 20 }, (_, i) => ({
  start: 100 + i * 3,
  end: 102 + i * 3,
  lines: [[{ text: `Test line ${i + 1}` }]],
}));

let clock: MatchClock = { time: 0, speed: 1, paused: false };

function subtitles(extra: Partial<Subtitles> = {}): Subtitles {
  return {
    choice: { kind: 'file', key: 'test' },
    pictureTrack: false,
    canMatch: true,
    cues: LINES,
    offset: 0,
    offer: null,
    sync: null,
    drift: null,
    stretched: false,
    autoDrift: false,
    canFixDrift: false,
    matchLine: () => null,
    undoMatch: () => {},
    takeOffer: () => {},
    declineOffer: () => {},
    setOffset: () => {},
    setDrift: () => {},
    ...extra,
  } as unknown as Subtitles;
}

/** The column drawn once more, as React would after a change, its effects run after. */
function draw(props: Subtitles): Element[] {
  let tree: unknown;
  // React draws again at once when the column changes its own state while drawn.
  for (let i = 0; i < 5; i++) {
    react.state.at = 0;
    react.state.dirty = false;
    tree = TimingColumn({ subtitles: props, clock: () => clock });
    if (!react.state.dirty) break;
  }
  const effects = react.state.effects.splice(0);
  for (const effect of effects) effect();
  return options(tree);
}

/** The labels of the options that take focus on this draw. */
const focused = (drawn: Element[]) =>
  drawn.filter((option) => option.props.preferred === true).map((option) => option.props.label);

beforeEach(() => {
  vi.useFakeTimers();
  react.state.slots = [];
  react.state.effects = [];
  clock = { time: 0, speed: 1, paused: false };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TimingColumn', () => {
  it('focuses the line last shown as the sheet opens, and never follows the lines after', () => {
    const props = subtitles();
    // Line 3 (106 s) shows; line 4 starts at 109 s.
    clock = { time: 107, speed: 1, paused: false };
    const seen: unknown[] = [];
    for (let at = 107; at <= 116; at += 0.25) {
      clock = { time: at, speed: 1, paused: false };
      seen.push(...focused(draw(props)));
      vi.advanceTimersByTime(250);
    }
    // Only ever the line shown as it opened: never line 4, 5 or 6 as each starts.
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['Test line 3']));
    // And only on the draws as it opened.
    clock = { time: 116.5, speed: 1, paused: false };
    expect(focused(draw(props))).toEqual([]);
  });

  it('lines that come once it is open take no focus', () => {
    // Nothing to match in the 30 s around now as it opens.
    clock = { time: 10, speed: 1, paused: false };
    const props = subtitles();
    draw(props);
    vi.advanceTimersByTime(250);
    expect(focused(draw(props))).toEqual([]);
    const seen: unknown[] = [];
    for (let at = 70; at <= 110; at += 5) {
      clock = { time: at, speed: 1, paused: false };
      vi.advanceTimersByTime(1000);
      seen.push(...focused(draw(props)));
    }
    expect(seen).toEqual([]);
  });

  it('Use it takes focus when last episode’s timing is offered as it opens, never later', () => {
    clock = { time: 107, speed: 1, paused: false };
    const offered = subtitles({ offer: { offset: 2, drift: null } });
    expect(focused(draw(offered))).toEqual(['player.offerUse']);
    vi.advanceTimersByTime(250);
    expect(focused(draw(offered))).toEqual([]);

    // An offer that comes once the sheet is open.
    react.state.slots = [];
    const plain = subtitles();
    draw(plain);
    vi.advanceTimersByTime(250);
    draw(plain);
    vi.advanceTimersByTime(250);
    expect(focused(draw(subtitles({ offer: { offset: 2, drift: null } })))).toEqual([]);
  });
});
