import { describe, expect, it } from 'vitest';
import {
  ALIGN_RATES,
  alignedTime,
  alignSubtitles,
  alignSubtitlesInSlices,
  type LineTiming,
} from './align';
import timings from './fixtures/align-timings.json';

/** A small, repeatable random sequence. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * A made-up film's lines, timing only: lines of 1 to 5 s, gaps of a tenth of
 * a second to several seconds, now and then a long quiet stretch.
 */
function film(seconds: number, seed: number): LineTiming[] {
  const next = random(seed);
  const lines: LineTiming[] = [];
  let at = 20 + next() * 30;
  while (at < seconds) {
    const length = 1 + next() * 4;
    lines.push({ start: at, end: at + length });
    const quiet = next() < 0.05 ? 20 + next() * 60 : 0.1 + -Math.log(1 - next() * 0.99) * 2;
    at += length + quiet;
  }
  return lines;
}

/**
 * The file a reference's lines make when timed as `shown` says the video shows
 * them (the alignment to find inverts it), with lines jittered, dropped and added.
 */
function fileFrom(
  reference: readonly LineTiming[],
  toFile: (t: number) => number,
  { jitter = 0.05, drop = 0.1, extra = 0, seed = 7 } = {},
): LineTiming[] {
  const next = random(seed);
  const lines: LineTiming[] = [];
  for (const line of reference) {
    if (next() < drop) continue;
    lines.push({
      start: toFile(line.start) + (next() * 2 - 1) * jitter,
      end: toFile(line.end) + (next() * 2 - 1) * jitter,
    });
  }
  const last = reference[reference.length - 1]!.end;
  for (let n = 0; n < reference.length * extra; n++) {
    const at = toFile(next() * last);
    lines.push({ start: at, end: at + 0.8 + next() * 2 });
  }
  return lines.sort((a, b) => a.start - b.start);
}

/** The worst gap, over the file's lines, between where the alignment puts them and where they belong. */
function worstError(
  file: readonly LineTiming[],
  alignment: { offset: number; rate: number },
  toVideo: (t: number) => number,
): number {
  let worst = 0;
  for (const line of file) {
    worst = Math.max(worst, Math.abs(alignedTime(line.start, alignment) - toVideo(line.start)));
  }
  return worst;
}

/** The fixture's lines: start and end pairs in hundredths of a second. */
function linesOf(flat: readonly number[]): LineTiming[] {
  const lines: LineTiming[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    lines.push({ start: flat[i]! / 100, end: flat[i + 1]! / 100 });
  }
  return lines;
}

const TWO_HOURS = 2 * 60 * 60;
const reference = film(TWO_HOURS, 1);

describe('alignSubtitles on made-up lines', () => {
  it('finds an offset under jitter, with lines missing', () => {
    const file = fileFrom(reference, (t) => t - 7.3, { jitter: 0.08 });
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.rate).toBe(1);
    expect(alignment.offset).toBeCloseTo(7.3, 1);
    expect(alignment.prominence).toBeGreaterThan(3);
    expect(alignment.matched).toBeGreaterThan(0.9);
    expect(alignment.spread).toBeGreaterThan(0.9);
    expect(alignment.split).toBeUndefined();
  });

  it.each(ALIGN_RATES.map((rate) => [rate]))('finds rate %f with its offset', (rate) => {
    // The file's seconds for one of the video's: a line it times at t shows at t / rate + 2.4.
    const file = fileFrom(reference, (t) => (t - 2.4) * rate);
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.rate).toBeCloseTo(rate, 9);
    expect(worstError(file, alignment, (t) => t / rate + 2.4)).toBeLessThan(0.25);
  });

  it('is sure of a file already in step', () => {
    const alignment = alignSubtitles(reference, reference);
    expect(alignment).toMatchObject({ confidence: 'sure', rate: 1 });
    expect(Math.abs(alignment.offset)).toBeLessThan(0.02);
    expect(alignment.score).toBeGreaterThan(0.99);
  });

  it('copes with heavy jitter, many lines missing and lines the reference lacks', () => {
    const file = fileFrom(reference, (t) => t + 12, { jitter: 0.3, drop: 0.3, extra: 0.15 });
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.offset).toBeCloseTo(-12, 0);
  });

  it('copes with a reference that splits its lines differently, as another language does', () => {
    // Each of the reference's longer lines is two lines in the file; some short ones are merged.
    const file: LineTiming[] = [];
    for (const line of reference) {
      const length = line.end - line.start;
      if (length > 3) {
        const cut = line.start + length * 0.45;
        file.push({ start: line.start + 3, end: cut + 3 }, { start: cut + 3.1, end: line.end + 3 });
      } else {
        file.push({ start: line.start + 3, end: line.end + 3.3 });
      }
    }
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.offset).toBeCloseTo(-3, 1);
  });

  it('is not sure of a split, and says where it is and how far it jumps', () => {
    // A different cut: from an hour in, the file's lines are 30 s later than the reference's.
    const file = fileFrom(reference, (t) => (t < 3600 ? t : t + 30));
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('unsure');
    expect(alignment.split).toBeDefined();
    expect(Math.abs(alignment.split!.jump)).toBeCloseTo(30, 0);
    expect(alignment.split!.at).toBeGreaterThan(2400);
    expect(alignment.split!.at).toBeLessThan(4800);
  });

  it('is not sure of a small split either', () => {
    // The file's first half is 1 s early, its second 5.5 s early: lines must move 1 s, then 5.5 s.
    const file = fileFrom(reference, (t) => (t < TWO_HOURS / 2 ? t - 1 : t - 5.5));
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('unsure');
    expect(alignment.split?.jump).toBeCloseTo(4.5, 0);
  });

  it('is not sure of a drift no rate here fixes, which its windows show', () => {
    // 1.002: a file 0.2% fast, between the rates tried. Over two hours it moves 14 s.
    const file = fileFrom(reference, (t) => t * 1.002 + 1);
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).not.toBe('sure');
  });

  it('sees a 0.1% drift (24 and 23.976 frames a second) and fixes it', () => {
    const rate = 24 / (24000 / 1001);
    const file = fileFrom(reference, (t) => t * rate);
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.rate).toBe(rate);
    // Left at rate 1, the end of the film would be over 7 s out.
    expect(worstError(file, alignment, (t) => t / rate)).toBeLessThan(0.25);
  });

  it('says nothing lines up between two different films', () => {
    for (const seed of [2, 3, 4, 5, 6]) {
      const other = film(TWO_HOURS, seed);
      expect(alignSubtitles(other, reference).confidence).toBe('none');
    }
  });

  it('does not let karaoke and flashes of a fraction of a second drown out the lines', () => {
    const file = fileFrom(reference, (t) => t - 4.2);
    // Six songs of three minutes, each line drawn over again syllable by syllable.
    for (const song of [600, 1800, 3000, 4200, 5400, 6600]) {
      for (let at = song; at < song + 180; at += 4) {
        file.push({ start: at, end: at + 3.6 });
        for (let syllable = 0; syllable < 8; syllable++) {
          file.push({ start: at + syllable * 0.45, end: at + syllable * 0.45 + 0.4 });
        }
      }
    }
    // And a hundred flashes of a tenth of a second.
    for (let n = 0; n < 100; n++) file.push({ start: 50 + n * 70, end: 50.1 + n * 70 });
    file.sort((a, b) => a.start - b.start);
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.offset).toBeCloseTo(4.2, 1);
  });

  it('takes no account of lines with no end yet, or no length', () => {
    const file = fileFrom(reference, (t) => t + 1).concat([
      { start: 100, end: Infinity },
      { start: 200, end: 200 },
      { start: NaN, end: 3 },
    ]);
    const alignment = alignSubtitles(file, reference);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.offset).toBeCloseTo(-1, 1);
  });

  it('answers none, moving nothing, when either file has no lines', () => {
    expect(alignSubtitles([], reference)).toMatchObject({ confidence: 'none', offset: 0, rate: 1 });
    expect(alignSubtitles(reference, [])).toMatchObject({ confidence: 'none', offset: 0, rate: 1 });
  });

  it('never says none against a reference still arriving that covers too little', () => {
    const arrived = reference.filter((line) => line.start < 600);
    const other = film(TWO_HOURS, 9);
    expect(alignSubtitles(other, arrived, { growing: true }).confidence).toBe('unsure');
    // Once it covers most of the film, it can.
    const most = reference.filter((line) => line.start < 6000);
    expect(alignSubtitles(other, most, { growing: true }).confidence).toBe('none');
  });

  it('lines up against a reference still arriving once it has enough', () => {
    const file = fileFrom(reference, (t) => t - 6);
    const arrived = reference.filter((line) => line.start < 40 * 60);
    const alignment = alignSubtitles(file, arrived, { growing: true });
    expect(alignment.confidence).toBe('sure');
    expect(alignment.offset).toBeCloseTo(6, 1);
    expect(alignment.covered).toBeLessThan(40 * 60);
  });
});

describe('alignSubtitles on real timing (OpenSubtitles files, timing only)', () => {
  const strangerHungarian = linesOf(timings.strangerThingsE01Hungarian);
  const strangerEnglish = linesOf(timings.strangerThingsE01English);
  const strangerNext = linesOf(timings.strangerThingsE02English);
  const usHearing = linesOf(timings.lastOfUsE01EnglishHearing);
  const usArabic = linesOf(timings.lastOfUsE01Arabic25);
  const usNext = linesOf(timings.lastOfUsE02English);

  it('lines an English file up 5.2 s against a Hungarian one of the same episode', () => {
    const alignment = alignSubtitles(strangerEnglish, strangerHungarian);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.rate).toBe(1);
    expect(alignment.offset).toBeCloseTo(5.2, 0);
  });

  it('stretches an Arabic file timed at 25 frames a second onto an English one', () => {
    const alignment = alignSubtitles(usArabic, usHearing);
    expect(alignment.confidence).toBe('sure');
    expect(alignment.rate).toBe(24000 / 1001 / 25);
    expect(alignment.offset).toBeCloseTo(0.7, 0);
  });

  it('says none for another episode of the same show, and for another show', () => {
    expect(alignSubtitles(strangerNext, strangerHungarian).confidence).toBe('none');
    expect(alignSubtitles(usNext, usHearing).confidence).toBe('none');
    expect(alignSubtitles(usArabic, strangerHungarian).confidence).toBe('none');
    expect(alignSubtitles(strangerEnglish, usHearing).confidence).toBe('none');
  });
});

describe('alignSubtitlesInSlices', () => {
  it('gives the same answer, pausing for the page as it goes', async () => {
    const file = fileFrom(reference, (t) => t + 2);
    let clock = 0;
    let pauses = 0;
    const alignment = await alignSubtitlesInSlices(file, reference, {
      // Each look at the clock is a millisecond later: a pause every eight steps or so.
      now: () => clock++,
      pause: () => {
        pauses++;
        return Promise.resolve();
      },
    });
    expect(alignment).toEqual(alignSubtitles(file, reference));
    expect(pauses).toBeGreaterThan(10);
  });
});
