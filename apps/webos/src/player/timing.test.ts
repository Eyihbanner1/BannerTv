import type { Cue } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import {
  COARSE_TIMING_STEPS,
  formatOffset,
  lineKey,
  lineText,
  MATCH_ROWS,
  MATCH_WINDOW_S,
  type MatchRow,
  matchRows,
  preferredRow,
  offsetWay,
  stepAmount,
  stepLabel,
  stepOffset,
  TIMING_COLUMN_STEPS,
  TIMING_STEPS,
  timingSummary,
} from './timing';

describe('subtitle timing', () => {
  it('reads an offset with its sign, a true minus for earlier', () => {
    expect(formatOffset(0.5)).toBe('+0.5 s');
    expect(formatOffset(-1.25)).toBe('−1.2 s');
    expect(formatOffset(0.04)).toBe('0.0 s');
    expect(formatOffset(-0.04)).toBe('0.0 s');
  });

  it('steps in tenths without drifting', () => {
    let offset = 0;
    for (let i = 0; i < 7; i++) offset = stepOffset(offset, 0.1);
    expect(offset).toBe(0.7);
    expect(stepOffset(0.7, -0.5)).toBe(0.2);
    expect(TIMING_STEPS).toEqual([-0.5, -0.1, 0.1, 0.5]);
  });

  it('says which way the subtitles move', () => {
    expect(offsetWay(0.5)).toEqual({ way: 'later', amount: '0.5' });
    expect(offsetWay(-2)).toEqual({ way: 'earlier', amount: '2.0' });
    expect(offsetWay(0)).toEqual({ way: 'none', amount: '0.0' });
  });

  it('has big steps of 5 s beside the fine ones, still landing on tenths', () => {
    expect(COARSE_TIMING_STEPS).toEqual([-5, 5]);
    expect(stepOffset(0.3, 5)).toBe(5.3);
    expect(stepOffset(stepOffset(0.3, 5), -5)).toBe(0.3);
    expect(stepOffset(-0.1, -5)).toBe(-5.1);
  });

  it('names a step in whole seconds where it is one, with a true minus', () => {
    expect(stepLabel(-0.5)).toBe('−0.5 s');
    expect(stepLabel(0.1)).toBe('+0.1 s');
    expect(stepLabel(5)).toBe('+5 s');
    expect(stepLabel(-5)).toBe('−5 s');
    expect(stepAmount(-0.1)).toBe('0.1');
    expect(stepAmount(5)).toBe('5');
  });

  it('the TV app’s column steps are the TV’s and the phone’s, finest first', () => {
    expect(TIMING_COLUMN_STEPS).toEqual([0.1, -0.1, 0.5, -0.5, 5, -5]);
    expect([...TIMING_COLUMN_STEPS].sort((a, b) => a - b)).toEqual(
      [...TIMING_STEPS, ...COARSE_TIMING_STEPS].sort((a, b) => a - b),
    );
  });

  it('timingSummary says nothing for subtitles as the file has them, or off', () => {
    const file = { kind: 'file', key: 'a' };
    expect(timingSummary({ choice: null, offset: 0.5, drift: 'ahead', sync: null })).toBeNull();
    expect(timingSummary({ choice: file, offset: 0, drift: null, sync: null })).toBeNull();
    expect(
      timingSummary({ choice: file, offset: 0, drift: null, sync: { state: 'inStep' } }),
    ).toBeNull();
    expect(
      timingSummary({ choice: file, offset: 0, drift: null, sync: { state: 'checking' } }),
    ).toBeNull();
  });

  it('timingSummary says the offset, lined up and drift fixed', () => {
    const file = { kind: 'file', key: 'a' };
    expect(timingSummary({ choice: file, offset: 0.5, drift: null, sync: null })).toEqual({
      offset: '+0.5 s',
      linedUp: false,
      driftFixed: false,
    });
    expect(
      timingSummary({ choice: file, offset: -1.2, drift: null, sync: { state: 'moved' } }),
    ).toEqual({ offset: '−1.2 s', linedUp: true, driftFixed: false });
    expect(timingSummary({ choice: file, offset: 0, drift: 'ahead', sync: null })).toEqual({
      offset: '0.0 s',
      linedUp: false,
      driftFixed: true,
    });
    // Lined up by BannerTV with no offset of the viewer's: still worth saying.
    expect(
      timingSummary({ choice: file, offset: 0, drift: null, sync: { state: 'moved' } }),
    ).toEqual({ offset: '0.0 s', linedUp: true, driftFixed: false });
  });
});

describe('the lines to match', () => {
  const cue = (start: number, n: number, end = start + 2): Cue => ({
    start,
    end,
    lines: [[{ text: `Test line ${n}` }], [{ text: ' ' }, { text: 'more', italic: true }]],
  });
  /** A line every 5 s, from 0 to 200 s. */
  const film = Array.from({ length: 41 }, (_, i) => cue(i * 5, i + 1));
  const starts = (cues: readonly Cue[], rows: readonly MatchRow[]) =>
    rows.map((row) => cues[row.index]!.start);

  it('two lines before now and two after, within 30 s', () => {
    expect(starts(film, matchRows(film, 101))).toEqual([95, 100, 105, 110]);
    // Near the start, there are fewer before: the later ones fill up.
    expect(starts(film, matchRows(film, 1))).toEqual([0, 5, 10, 15]);
    // Near the end, fewer after: the earlier ones fill up.
    expect(starts(film, matchRows(film, 202))).toEqual([185, 190, 195, 200]);
    // Nothing within 30 s.
    expect(matchRows(film, 300)).toEqual([]);
    expect(matchRows([], 10)).toEqual([]);
    expect(starts(film, matchRows(film, 228))).toEqual([200]);
    expect(lineText(film[2]!)).toBe('Test line 3 more');
  });

  it('only past lines for a track Android hands over: four of them', () => {
    const heard = film.slice(0, 21);
    expect(starts(heard, matchRows(heard, 101))).toEqual([85, 90, 95, 100]);
  });

  it('says which line is on screen', () => {
    const rows = matchRows(film, 101);
    expect(rows.map((row) => row.onScreen)).toEqual([false, true, false, false]);
    // Between two lines, none is.
    expect(matchRows(film, 103).some((row) => row.onScreen)).toBe(false);
  });

  it('keeps the focused line among the rows as the film plays on', () => {
    const pinned = lineKey(film, 19);
    expect(starts(film, matchRows(film, 101, pinned))).toEqual([95, 100, 105, 110]);
    // Later on, the focused line would have left the rows: it takes the place of the farthest.
    expect(starts(film, matchRows(film, 112, pinned))).toEqual([95, 105, 110, 115]);
    expect(matchRows(film, 112, pinned)).toContainEqual(
      expect.objectContaining({ index: 19, key: pinned }),
    );
    // A key no line has any more changes nothing.
    expect(starts(film, matchRows(film, 112, '999999-0'))).toEqual([105, 110, 115, 120]);
  });

  it('a line’s key stays when older lines are dropped, and lines starting together get their own', () => {
    const together = [cue(1, 1), cue(10, 2), cue(10, 3), cue(12.0004, 4)];
    expect(together.map((_, i) => lineKey(together, i))).toEqual([
      '1000-0',
      '10000-0',
      '10000-1',
      '12000-0',
    ]);
    // Android's history drops the oldest: the keys of the rest stay.
    const later = together.slice(1);
    expect(later.map((_, i) => lineKey(later, i))).toEqual(['10000-0', '10000-1', '12000-0']);
  });

  it('the newest line heard is the one focused first', () => {
    const rows = matchRows(film, 103);
    expect(film[preferredRow(rows, film, 103)!.index]!.start).toBe(100);
    // Before the first line, the first row.
    const early = matchRows(film, -1);
    expect(film[preferredRow(early, film, -1)!.index]!.start).toBe(0);
    expect(preferredRow([], film, 10)).toBeUndefined();
    expect(MATCH_WINDOW_S).toBe(30);
    expect(MATCH_ROWS).toBe(4);
  });
});
