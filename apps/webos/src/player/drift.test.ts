import { memoryKeyValueStore } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import {
  createSubtitleDrifts,
  DRIFT_RATES,
  driftInUse,
  driftKeptWithTiming,
  driftOfRate,
  stretchCues,
  timingInUse,
} from './drift';

const line = (text: string) => [[{ text }]];

describe('stretchCues', () => {
  it('leaves the cues as they are without a drift fix', () => {
    const cues = [{ start: 1, end: 2, lines: line('a') }];
    expect(stretchCues(cues, null)).toBe(cues);
  });

  it('moves a PAL file onto a film-speed video: lines that came early come later, more so later on', () => {
    const cues = [
      { start: 60, end: 62, lines: line('early') },
      { start: 6000, end: 6002, lines: line('late'), top: true },
    ];
    const [early, late] = stretchCues(cues, 'ahead');
    // A line the PAL file has at 100 minutes is spoken at 104 min 16 s in the film.
    expect(late!.start).toBeCloseTo(6256.25, 6);
    expect(late!.top).toBe(true);
    expect(early!.start).toBeCloseTo(62.5625, 3);
    expect(early!.end - early!.start).toBeCloseTo(2 / DRIFT_RATES.ahead, 6);
  });

  it('undoes one fix with the other', () => {
    expect(DRIFT_RATES.ahead * DRIFT_RATES.behind).toBeCloseTo(1, 12);
    const [cue] = stretchCues(
      stretchCues([{ start: 3600, end: 3601, lines: line('x') }], 'ahead'),
      'behind',
    );
    expect(cue!.start).toBeCloseTo(3600, 9);
  });
});

describe('the drift store', () => {
  it('is the core one, under the same key, so fixes kept before still read', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitleDrift', [{ key: 'a', drift: 'ahead' }]);
    const drifts = createSubtitleDrifts({ storage });
    await drifts.load();
    expect(drifts.get('a')).toBe('ahead');
  });
});

describe('driftInUse and driftKeptWithTiming', () => {
  const file = { canFix: true, evidence: 'behind' as const, kept: null, offset: 0 };

  it('fixes the drift a file’s length gives away by itself, unless the viewer chose', () => {
    expect(driftInUse(file)).toEqual({ drift: 'behind', auto: true });
    expect(driftInUse({ ...file, evidence: null })).toEqual({ drift: null, auto: false });
    // The viewer's own fix, or No fix, stands.
    expect(driftInUse({ ...file, kept: 'ahead' })).toEqual({ drift: 'ahead', auto: false });
    expect(driftInUse({ ...file, kept: 'none' })).toEqual({ drift: null, auto: false });
    // A timing the viewer set on the file before stands too.
    expect(driftInUse({ ...file, offset: 1.5 })).toEqual({ drift: null, auto: false });
    // Not where no drift fix applies.
    expect(driftInUse({ ...file, canFix: false, kept: 'ahead' })).toEqual({
      drift: null,
      auto: false,
    });
  });

  it('keeps the player’s own fix with the timing once the viewer moves it, so it stays on', () => {
    expect(driftKeptWithTiming(file, 0.5)).toBe('auto');
    expect(driftKeptWithTiming(file, -0.1)).toBe('auto');
    // With 'auto' kept and the timing moved, the fix is still on, still the player's.
    expect(driftInUse({ ...file, kept: 'auto', offset: 0.5 })).toEqual({
      drift: 'behind',
      auto: true,
    });
    // Reset on a file at 0 keeps nothing; neither does a fix the viewer chose, already kept.
    expect(driftKeptWithTiming(file, 0)).toBeNull();
    expect(driftKeptWithTiming({ ...file, kept: 'ahead' }, 0.5)).toBeNull();
    expect(driftKeptWithTiming({ ...file, kept: 'none' }, 0.5)).toBeNull();
    // Nor where no drift fix applies.
    expect(driftKeptWithTiming({ ...file, canFix: false }, 0.5)).toBeNull();
  });

  it('keeps the fix to be worked out on each stream with a timing set where there was none to make', () => {
    // The file fits the stream playing as it is: the timing goes with 'auto'.
    const fits = { ...file, evidence: null };
    expect(driftKeptWithTiming(fits, 0.3)).toBe('auto');
    // On another release of the video, whose length shows the file falling behind, the
    // player still fixes it, with the viewer's timing.
    expect(driftInUse({ ...file, kept: 'auto', offset: 0.3 })).toEqual({
      drift: 'behind',
      auto: true,
    });
    // A timing an older build kept with no drift choice, against lines it left as they were,
    // stays so: moving it keeps nothing, and the lines are not stretched under the viewer.
    expect(driftKeptWithTiming({ ...file, offset: 1.5 }, 1.6)).toBeNull();
  });

  it('works the kept fix out again on another release, where the file fits as it is', () => {
    // The same file and timing, on a release its length shows it fits: no stretch.
    expect(driftInUse({ ...file, evidence: null, kept: 'auto', offset: 0.5 })).toEqual({
      drift: null,
      auto: false,
    });
    // Not where no drift fix applies.
    expect(driftInUse({ ...file, canFix: false, kept: 'auto', offset: 0.5 })).toEqual({
      drift: null,
      auto: false,
    });
  });
});

describe('timingInUse: a file the player lined up itself', () => {
  const file = { canFix: true, evidence: null, kept: null, offset: 0 };
  const moved = { offset: 2.3, rate: 1 };

  it('moves the lines as lining them up found, its rate as the drift fix in use', () => {
    expect(timingInUse({ ...file, aligned: moved })).toEqual({
      drift: null,
      auto: false,
      move: moved,
      offset: 0,
    });
    const pal = { offset: 0.7, rate: DRIFT_RATES.ahead };
    expect(timingInUse({ ...file, aligned: pal })).toEqual({
      drift: 'ahead',
      auto: true,
      move: pal,
      offset: 0,
    });
    expect(driftOfRate(DRIFT_RATES.behind)).toBe('behind');
    expect(driftOfRate(24 / (24000 / 1001))).toBeNull();
    // The rate replaces a drift the file's length gives away.
    expect(timingInUse({ ...file, evidence: 'behind', aligned: moved }).move).toEqual(moved);
  });

  it('leaves the lines as the viewer set them where they chose a drift fix for the file', () => {
    for (const kept of ['ahead', 'behind', 'none'] as const) {
      expect(timingInUse({ ...file, kept, offset: 1.2, aligned: moved })).toEqual({
        ...driftInUse({ ...file, kept, offset: 1.2 }),
        move: null,
        offset: 1.2,
      });
    }
  });

  it('adds timing set on lined-up lines to the move, and sets aside timing set on the file’s own', () => {
    // Set on lines the player had lined up, on any release: it adds to this one's move.
    expect(timingInUse({ ...file, kept: 'aligned', offset: 0.4, aligned: moved })).toMatchObject({
      move: moved,
      offset: 0.4,
    });
    // Set on the file's own lines (another release, or before it was lined up): not stacked.
    for (const kept of [null, 'auto'] as const) {
      expect(timingInUse({ ...file, kept, offset: 3, aligned: moved })).toMatchObject({
        move: moved,
        offset: 0,
      });
    }
    // Where the file is not lined up, the timing kept applies to its own lines, as before.
    expect(timingInUse({ ...file, kept: 'aligned', offset: 0.4 })).toEqual({
      drift: null,
      auto: false,
      move: null,
      offset: 0.4,
    });
    expect(timingInUse({ ...file, kept: null, offset: 3 })).toMatchObject({
      move: null,
      offset: 3,
    });
  });

  it('marks timing set on lined-up lines, so it adds to the move next time and is not stacked', () => {
    expect(driftKeptWithTiming({ ...file, aligned: moved }, 0.4)).toBe('aligned');
    expect(driftKeptWithTiming({ ...file, kept: 'auto', aligned: moved }, 0.4)).toBe('aligned');
    expect(driftKeptWithTiming({ ...file, kept: 'aligned', aligned: moved }, 0.4)).toBe('aligned');
    // Set on the file's own lines again: no longer on top of a move.
    expect(driftKeptWithTiming({ ...file, kept: 'aligned', offset: 0.4 }, 0.5)).toBe('auto');
    // The viewer's own drift fix stands, with nothing kept beside it.
    expect(driftKeptWithTiming({ ...file, kept: 'ahead', aligned: moved }, 0.4)).toBeNull();
    // Back to no timing: nothing to keep.
    expect(driftKeptWithTiming({ ...file, aligned: moved }, 0)).toBeNull();
    // Kept 'aligned' with no move here: the drift is worked out as for 'auto'.
    expect(driftInUse({ ...file, evidence: 'behind', kept: 'aligned', offset: 0.4 })).toEqual({
      drift: 'behind',
      auto: true,
    });
  });
});
