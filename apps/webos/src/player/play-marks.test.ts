import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tuning } from '../platform/tuning';

// The tester's switches, which a test can change.
const tuned = vi.hoisted(() => ({}) as Tuning);

vi.mock(import('../platform/tuning'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, tuning: Object.assign(tuned, actual.TUNING_DEFAULTS) };
});

let now = 0;
let marked: string[] = [];

beforeEach(() => {
  vi.resetModules();
  now = 0;
  marked = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(performance, 'mark').mockImplementation((name: string) => {
    marked.push(name);
    return undefined as unknown as PerformanceMark;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh copy of the module, so no earlier Play is remembered, with marks on or off. */
async function load(marks = true) {
  const loaded = await import('./play-marks');
  tuned.marks = marks;
  return loaded;
}

describe('play marks', () => {
  it('times each stage of the latest Play from the press', async () => {
    const { markPlayPress, playMark, readPlayMarks } = await load();
    const finder = {};
    expect(readPlayMarks()).toBeNull();
    now = 1000;
    markPlayPress();
    now = 1120;
    playMark(finder, 'open');
    now = 1130;
    playMark(finder, 'finder-start');
    now = 1900;
    playMark(finder, 'first-stream');
    now = 3900;
    playMark(finder, 'settled');
    playMark(finder, 'chosen', 'waited');
    now = 4000;
    playMark(finder, 'load', 'hls.js');
    now = 5000;
    playMark(finder, 'metadata');
    now = 5600;
    playMark(finder, 'first-frame');
    expect(readPlayMarks()).toEqual({
      stages: {
        press: 0,
        open: 120,
        'finder-start': 130,
        'first-stream': 900,
        settled: 2900,
        chosen: 2900,
        load: 3000,
        metadata: 4000,
        'first-frame': 4600,
      },
      streams: 1,
    });
    expect(marked).toEqual([
      'play:press',
      'play:open',
      'play:finder-start',
      'play:first-stream',
      'play:settled',
      'play:chosen:waited',
      'play:load:hls.js',
      'play:metadata',
      'play:first-frame',
    ]);
  });

  it("reads a lookup Details began before the press as negative, and keeps each stage's first time", async () => {
    const { markPlayPress, playMark, readPlayMarks } = await load();
    const finder = {};
    now = 1000;
    playMark(finder, 'finder-start');
    now = 1800;
    playMark(finder, 'first-stream');
    now = 2500;
    playMark(finder, 'settled');
    now = 6000;
    markPlayPress();
    playMark(finder, 'open');
    playMark(finder, 'chosen', 'ready');
    now = 6100;
    playMark(finder, 'load', 'native');
    // The first stream failed: auto-play opened another.
    now = 9000;
    playMark(finder, 'load', 'native');
    now = 9500;
    playMark(finder, 'first-frame');
    expect(readPlayMarks()).toEqual({
      stages: {
        press: 0,
        open: 0,
        'finder-start': -5000,
        'first-stream': -4200,
        settled: -3500,
        chosen: 0,
        load: 100,
        'first-frame': 3500,
      },
      streams: 2,
    });
  });

  it("leaves out another video's stages, and starts from the opening when nothing was pressed", async () => {
    const { playMark, readPlayMarks } = await load();
    const finder = {};
    const other = {};
    now = 500;
    playMark(finder, 'open');
    now = 700;
    playMark(other, 'finder-start');
    playMark(other, 'load', 'native');
    expect(readPlayMarks()).toEqual({ stages: { press: 0, open: 0 }, streams: 0 });
  });

  it('marks nothing with the switch off', async () => {
    const { markPlayPress, playMark, readPlayMarks } = await load(false);
    const finder = {};
    markPlayPress();
    playMark(finder, 'open');
    playMark(finder, 'first-frame');
    expect(marked).toEqual([]);
    expect(readPlayMarks()).toBeNull();
  });
});
