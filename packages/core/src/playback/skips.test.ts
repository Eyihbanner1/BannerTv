import { describe, expect, it } from 'vitest';
import {
  CREDITS_EXACT_S,
  CREDITS_FIT_S,
  CREDITS_LONGEST_S,
  creditsCue,
  readCredits,
  readEpisodeMarks,
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

describe('readCredits', () => {
  it("reads IntroDB's end credits, and whether a scene plays after them", () => {
    expect(readCredits({ outro: timed(2600, 2680), post_credits: null })).toEqual({
      start: 2600,
      end: 2680,
      sceneAfter: false,
    });
    expect(readCredits({ outro: timed(2600, 2680), post_credits: timed(2680, 2720) })).toEqual({
      start: 2600,
      end: 2680,
      sceneAfter: true,
    });
    expect(readCredits({ outro: { start_ms: 2600000, end_ms: 2650500 } })).toEqual({
      start: 2600,
      end: 2650.5,
      sceneAfter: false,
    });
  });

  it('has none when the mark is missing, too short, too long or from the start', () => {
    expect(readCredits({ intro: timed(60, 90) })).toBeUndefined();
    expect(readCredits({ outro: null })).toBeUndefined();
    expect(readCredits({ outro: timed(2600, 2603) })).toBeUndefined();
    expect(readCredits({ outro: timed(100, 100 + CREDITS_LONGEST_S + 1) })).toBeUndefined();
    expect(readCredits({ outro: timed(0, 60) })).toBeUndefined();
    expect(readCredits({ outro: { start_sec: 2600 } })).toBeUndefined();
    expect(readCredits(null)).toBeUndefined();
  });
});

describe('readEpisodeMarks', () => {
  it('reads the skips and the credits together', () => {
    expect(
      readEpisodeMarks({ recap: timed(0, 40), intro: timed(60, 95), outro: timed(2700, 2760) }),
    ).toEqual({
      segments: [
        { kind: 'recap', start: 0, end: 40 },
        { kind: 'intro', start: 60, end: 95 },
      ],
      credits: { start: 2700, end: 2760, sceneAfter: false },
    });
  });

  it("keeps IntroDB's word that an episode has no intro, unless it times one", () => {
    expect(readEpisodeMarks({ intro: null, no_intro: true })).toEqual({
      segments: [],
      noIntro: true,
    });
    expect(readEpisodeMarks({ intro: null, no_intro: false })).toEqual({ segments: [] });
    expect(readEpisodeMarks({ intro: timed(60, 95), no_intro: true })).toEqual({
      segments: [{ kind: 'intro', start: 60, end: 95 }],
    });
  });

  it('drops credits that start before the intro has ended', () => {
    expect(readEpisodeMarks({ intro: timed(60, 95), outro: timed(80, 140) })).toEqual({
      segments: [{ kind: 'intro', start: 60, end: 95 }],
    });
  });
});

describe('creditsCue', () => {
  const mark = { start: 2500, end: 2600, sceneAfter: false };

  it('offers the next episode from the credits when the mark fits the file, and may start it there', () => {
    expect(creditsCue(mark, 2600)).toEqual({ start: 2500, startsNext: true });
    expect(creditsCue(mark, 2600 - CREDITS_EXACT_S)).toEqual({ start: 2500, startsNext: true });
  });

  it('is never early on a longer file, whose extra time may come before the credits', () => {
    expect(creditsCue(mark, 2600 + CREDITS_EXACT_S)).toEqual({
      start: 2500 + CREDITS_EXACT_S,
      startsNext: true,
    });
    expect(creditsCue(mark, 2645)).toEqual({ start: 2545, startsNext: false });
    expect(creditsCue(mark, 2600 + CREDITS_FIT_S)).toEqual({
      start: 2500 + CREDITS_FIT_S,
      startsNext: false,
    });
  });

  it('only offers it, never starting it, from a release cut a little differently or with a scene after', () => {
    expect(creditsCue(mark, 2600 - CREDITS_EXACT_S - 1)).toEqual({
      start: 2500,
      startsNext: false,
    });
    expect(creditsCue(mark, 2600 - CREDITS_FIT_S)).toEqual({ start: 2500, startsNext: false });
    expect(creditsCue({ ...mark, sceneAfter: true }, 2600)).toEqual({
      start: 2500,
      startsNext: false,
    });
  });

  it("has none for another cut, an unknown length, or credits Up Next's last 30 s covers", () => {
    expect(creditsCue(mark, 2600 + CREDITS_FIT_S + 1)).toBeUndefined();
    expect(creditsCue(mark, 2600 - CREDITS_FIT_S - 1)).toBeUndefined();
    expect(creditsCue(mark, 0)).toBeUndefined();
    expect(creditsCue(mark, Infinity)).toBeUndefined();
    expect(creditsCue(undefined, 2600)).toBeUndefined();
    expect(creditsCue({ start: 2575, end: 2600, sceneAfter: false }, 2600)).toBeUndefined();
    // Credits starting more than CREDITS_LONGEST_S before the file's end.
    const longest = { start: 1000, end: 1000 + CREDITS_LONGEST_S, sceneAfter: false };
    expect(creditsCue(longest, 1000 + CREDITS_LONGEST_S)).toEqual({
      start: 1000,
      startsNext: true,
    });
    expect(creditsCue({ ...longest, start: 995 }, 1000 + CREDITS_LONGEST_S)).toBeUndefined();
  });
});
