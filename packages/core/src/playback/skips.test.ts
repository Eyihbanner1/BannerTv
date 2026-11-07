import { describe, expect, it } from 'vitest';
import {
  readSkipSegments,
  SKIP_CARD_S,
  SKIP_TAIL_S,
  skipAt,
  skipCardDone,
  skipKey,
  skipRearms,
} from './skips';

const timed = (start: number, end: number) => ({
  start_sec: start,
  end_sec: end,
  start_ms: start * 1000,
  end_ms: end * 1000,
  confidence: 0.9,
  submission_count: 4,
  updated_at: '2026-10-01T00:00:00Z',
});

describe('readSkipSegments', () => {
  it('reads the recap and the intro of an IntroDB answer, in the order they play', () => {
    const answer = {
      imdb_id: 'tt0903747',
      season: 2,
      episode: 1,
      recap: timed(0, 42.5),
      intro: timed(60, 95),
      outro: timed(2700, 2760),
      post_credits: null,
      no_intro: false,
    };
    expect(readSkipSegments(answer)).toEqual([
      { kind: 'recap', start: 0, end: 42.5 },
      { kind: 'intro', start: 60, end: 95 },
    ]);
  });

  it('takes milliseconds when seconds are missing, and numbers sent as text', () => {
    expect(readSkipSegments({ intro: { start_ms: 12000, end_ms: 41500 } })).toEqual([
      { kind: 'intro', start: 12, end: 41.5 },
    ]);
    expect(readSkipSegments({ intro: { start_sec: '12', end_sec: '41' } })).toEqual([
      { kind: 'intro', start: 12, end: 41 },
    ]);
  });

  it('leaves out what is missing, backwards, too short, too long, or not an answer', () => {
    expect(readSkipSegments({ intro: null, recap: null, no_intro: true })).toEqual([]);
    expect(readSkipSegments({ intro: timed(50, 40) })).toEqual([]);
    expect(readSkipSegments({ intro: timed(-3, 30) })).toEqual([]);
    expect(readSkipSegments({ intro: timed(10, 12) })).toEqual([]);
    expect(readSkipSegments({ intro: timed(0, 400) })).toEqual([]);
    expect(readSkipSegments({ recap: timed(0, 400) })).toHaveLength(1);
    expect(readSkipSegments({ intro: { start_sec: 'soon', end_sec: 30 } })).toEqual([]);
    expect(readSkipSegments(null)).toEqual([]);
    expect(readSkipSegments('<html>')).toEqual([]);
  });

  it('keeps the first of two that overlap', () => {
    expect(readSkipSegments({ recap: timed(0, 70), intro: timed(60, 95) })).toEqual([
      { kind: 'recap', start: 0, end: 70 },
    ]);
  });
});

describe('skipAt', () => {
  const segments = [
    { kind: 'recap' as const, start: 0, end: 40 },
    { kind: 'intro' as const, start: 60, end: 90 },
  ];

  it('offers the segment playing, from its start until a moment before its end', () => {
    expect(skipAt(segments, 0, 2700)?.kind).toBe('recap');
    expect(skipAt(segments, 30, 2700)?.kind).toBe('recap');
    expect(skipAt(segments, 40 - SKIP_TAIL_S, 2700)).toBeUndefined();
    expect(skipAt(segments, 50, 2700)).toBeUndefined();
    expect(skipAt(segments, 59.9, 2700)).toBeUndefined();
    expect(skipAt(segments, 60, 2700)?.kind).toBe('intro');
    expect(skipAt(segments, 95, 2700)).toBeUndefined();
  });

  it('offers nothing whose end is past the end of the file, and waits for a clock', () => {
    expect(skipAt(segments, 65, 80)).toBeUndefined();
    expect(skipAt(segments, 65, 0)?.kind).toBe('intro');
    expect(skipAt(segments, NaN, 2700)).toBeUndefined();
    expect(skipAt([], 10, 2700)).toBeUndefined();
  });
});

describe('the skip card', () => {
  it('goes after SKIP_CARD_S watching seconds, sooner at a faster speed', () => {
    expect(skipCardDone(60, 60 + SKIP_CARD_S - 0.1)).toBe(false);
    expect(skipCardDone(60, 60 + SKIP_CARD_S)).toBe(true);
    expect(skipCardDone(60, 60 + SKIP_CARD_S, 2)).toBe(false);
    expect(skipCardDone(60, 60 + SKIP_CARD_S * 2, 2)).toBe(true);
    expect(skipCardDone(60, 60 + SKIP_CARD_S, 0)).toBe(true);
  });

  it('comes back after a rewind to before where it first showed', () => {
    expect(skipRearms(60, 59.5)).toBe(false);
    expect(skipRearms(60, 58)).toBe(true);
  });

  it('names each segment apart', () => {
    expect(skipKey({ kind: 'intro', start: 60, end: 90 })).not.toBe(
      skipKey({ kind: 'recap', start: 0, end: 40 }),
    );
  });
});
