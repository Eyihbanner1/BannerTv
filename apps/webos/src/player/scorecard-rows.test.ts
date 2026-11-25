import type { PlayRecord } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { playRows, scorecardRows } from './scorecard-rows';

const AT = new Date(2026, 10, 25, 18, 2).getTime();

const play = (overrides: Partial<PlayRecord> = {}): PlayRecord => ({
  at: AT,
  kind: 'film',
  outcome: 'played',
  startMs: 1400,
  playedS: 3120,
  waits: 0,
  waitMs: 0,
  failovers: 0,
  stepDowns: 0,
  retries: 0,
  audioChanged: false,
  subtitlesChanged: false,
  ...overrides,
});

describe('scorecardRows', () => {
  it('says so when nothing has played on this screen', () => {
    expect(scorecardRows([])).toEqual([['Plays', 'none yet on this screen']]);
  });

  it('gives the averages against the start target', () => {
    const rows = scorecardRows([
      play({ startMs: 1200, waits: 2, waitMs: 6000, retries: 1, subtitlesChanged: true }),
      play({ startMs: 3000, failovers: 1, stepDowns: 1, audioChanged: true }),
      play({ outcome: 'failed', startMs: undefined, playedS: 0, failovers: 3 }),
      play({ outcome: 'left', startMs: undefined, playedS: 0 }),
    ]);
    expect(rows).toEqual([
      ['Plays', '4 kept · 1 failed · 1 left early · 1.7 h played'],
      ['Start (aim 2.0 s)', '2.1 s middle · 50% in time'],
      ['Waits per hour', '1.2 · 3 s waiting'],
      ['Auto-play', '4 failovers · 1 step-down · 1 reopened'],
      ['Changed soon', 'audio 1 · subtitles 1'],
    ]);
  });

  it('leaves the rates out under six minutes played', () => {
    const rows = scorecardRows([play({ playedS: 300, waits: 1, waitMs: 2000 })]);
    expect(rows).toContainEqual(['Waits per hour', 'under 6 min played']);
  });
});

describe('playRows', () => {
  it('puts each play in one line under its day and time', () => {
    expect(
      playRows([
        play({ waits: 1, retries: 1, subtitlesChanged: true }),
        play({ kind: 'live', outcome: 'failed', startMs: undefined, playedS: 0, failovers: 3 }),
        play({ kind: 'episode', outcome: 'left', startMs: undefined, playedS: 0 }),
      ]),
    ).toEqual([
      ['25/11 18:02', 'film · 1.4 s · 1 wait · 1 switch · subtitles changed · 52 min'],
      ['25/11 18:02', 'live · failed · 0 waits · 3 switches · 0 min'],
      ['25/11 18:02', 'episode · left before the picture'],
    ]);
  });
});
