import { describe, expect, it } from 'vitest';
import {
  ALIGN_RATES,
  alignedTime,
  alignSubtitles,
  alignSubtitlesInSlices,
  type LineTiming,
} from './align';
import boundaries from './fixtures/align-boundaries.json';
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
 * a second to several seconds (`gap` on average), now and then a long quiet
 * stretch. The first line comes 0 to 30 s after `from`.
 */
function film(seconds: number, seed: number, { from = 20, gap = 2 } = {}): LineTiming[] {
  const next = random(seed);
  const lines: LineTiming[] = [];
  let at = from + next() * 30;
  while (at < seconds) {
    const length = 1 + next() * 4;
    lines.push({ start: at, end: at + length });
    const quiet = next() < 0.05 ? 20 + next() * 60 : 0.1 + -Math.log(1 - next() * 0.99) * gap;
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

/** About `share` of the lines, picked at random, `by` seconds later: two answers in one file. */
function partlyMoved(
  lines: readonly LineTiming[],
  share: number,
  by: number,
  seed = 5,
): LineTiming[] {
  const next = random(seed);
  return lines
    .map((line) => (next() < share ? { start: line.start + by, end: line.end + by } : line))
    .sort((a, b) => a.start - b.start);
}

/** The windows that agree with the answer (within half a second of it). */
function agreeing(alignment: { windows: ReadonlyArray<number | null> }): number {
  return alignment.windows.filter((delta) => delta !== null && Math.abs(delta) <= 0.5).length;
}

/** How far the file's lines landing on speech are beyond what chance lands: 0 at chance, 1 all. */
function beyondChance(alignment: { matched: number; chance: number }): number {
  return (alignment.matched - alignment.chance) / (1 - alignment.chance);
}

/** A window's offset, matched to the nearest tenth of a second, or no offset. */
function near(delta: number | null): unknown {
  return delta === null ? null : expect.closeTo(delta, 1);
}

/** A song's lines, one after another, 2.4 to 3.6 s each. */
function song(at: number, count: number, seed: number): LineTiming[] {
  const next = random(seed);
  const lines: LineTiming[] = [];
  let start = at;
  for (let n = 0; n < count; n++) {
    const length = 2.4 + next() * 1.2;
    lines.push({ start, end: start + length });
    start += length + 0.3 + next() * 0.5;
  }
  return lines;
}

const EPISODE = 23 * 60 + 40;

/**
 * An episode of 23:40, as a series' subtitle group times them: an opening
 * song from the start and a closing song before the end, timed the same in
 * every episode, and the episode's own dialogue (`keep` of a made-up film's).
 */
function episode(seed: number, keep: number): LineTiming[] {
  const opening = song(1, 22, 11);
  const closing = song(EPISODE - 185, 22, 13);
  const dialogue = film(EPISODE - 190, seed, { from: opening[opening.length - 1]!.end + 3 }).filter(
    (line, n) => line.end < EPISODE - 188 && n % 100 < keep * 100,
  );
  return [...opening, ...dialogue, ...closing, { start: EPISODE - 60, end: EPISODE - 56 }].sort(
    (a, b) => a.start - b.start,
  );
}

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
    // A third of the file: sure at rate 1, as the file is, though no other rate could be.
    expect(alignment.coveredShare).toBeLessThan(0.5);
    expect(alignment.rate).toBe(1);
  });
});

describe('alignSubtitles at its gates, on made-up lines', () => {
  // The gates were set on real files (ADR 0003 item 9); these cases sit either side of each.

  it('is sure of a peak twice the next answer, and not of a lower one, whatever the windows say', () => {
    // A share of the lines 40 s late: the higher it is, the lower the answer peaks over 40 s.
    const high = alignSubtitles(partlyMoved(reference, 0.3, 40), reference);
    expect(high.confidence).toBe('sure');
    expect(high.prominence).toBeGreaterThan(2);
    const low = alignSubtitles(partlyMoved(reference, 0.35, 40), reference);
    expect(low.confidence).toBe('unsure');
    expect(low.prominence).toBeGreaterThan(1.6);
    expect(low.prominence).toBeLessThan(2);
    expect(agreeing(low)).toBe(10);
  });

  it('under a peak of 1.6, sees a match only from 1.25 with three windows agreeing', () => {
    /** The answer for a film of `seconds`, its lines `share` 40 s late (picked by `seed`). */
    const partly = (seconds: number, filmSeed: number, share: number, seed: number) => {
      const lines = seconds === TWO_HOURS && filmSeed === 1 ? reference : film(seconds, filmSeed);
      const alignment = alignSubtitles(partlyMoved(lines, share, 40, seed), lines);
      return { ...alignment, agreeing: agreeing(alignment) };
    };
    const cases = [
      // Under 1.25, three windows agreeing are not enough.
      { got: partly(TWO_HOURS, 1, 0.45, 5), from: 1.15, to: 1.25, agree: 3, confidence: 'none' },
      // From 1.25, three are enough, and five.
      { got: partly(40 * 60, 1, 0.38, 8), from: 1.25, to: 1.6, agree: 3, confidence: 'unsure' },
      { got: partly(TWO_HOURS, 1, 0.4, 8), from: 1.25, to: 1.4, agree: 5, confidence: 'unsure' },
      // Two windows are not, of five, or of three.
      { got: partly(40 * 60, 2, 0.4, 8), from: 1.25, to: 1.4, agree: 2, confidence: 'none' },
      { got: partly(25 * 60, 2, 0.42, 8), from: 1.45, to: 1.6, agree: 2, confidence: 'none' },
      // From 1.6, the peak alone is a match.
      { got: partly(25 * 60, 2, 0.4, 8), from: 1.6, to: 2, agree: 2, confidence: 'unsure' },
    ];
    for (const { got, from, to, agree, confidence } of cases) {
      expect(got.prominence).toBeGreaterThan(from);
      expect(got.prominence).toBeLessThan(to);
      expect(got.agreeing).toBe(agree);
      expect(got.confidence).toBe(confidence);
    }
  });

  it('is not sure of a drift left over that moves lines 0.6 s over the film', () => {
    const slight = alignSubtitles(
      fileFrom(reference, (t) => t * 1.00006 + 1),
      reference,
    );
    expect(slight.confidence).toBe('sure');
    expect(Math.abs(slight.drift)).toBeLessThan(0.6);
    const more = alignSubtitles(
      fileFrom(reference, (t) => t * 1.0001 + 1),
      reference,
    );
    expect(more.confidence).toBe('unsure');
    expect(Math.abs(more.drift)).toBeGreaterThan(0.6);
  });

  it('is sure with one window off, not two', () => {
    const one = alignSubtitles(
      fileFrom(reference, (t) => (t > 3250 && t < 3950 ? t + 2 : t)),
      reference,
    );
    expect(one.confidence).toBe('sure');
    expect(one.windows.filter((delta) => delta !== null && Math.abs(delta + 2) < 0.1)).toHaveLength(
      1,
    );
    const two = alignSubtitles(
      fileFrom(reference, (t) => ((t > 1450 && t < 2150) || (t > 5050 && t < 5750) ? t + 2 : t)),
      reference,
    );
    expect(two.confidence).toBe('unsure');
    expect(two.windows.filter((delta) => delta !== null && Math.abs(delta + 2) < 0.1)).toHaveLength(
      2,
    );
  });

  it('is sure with six windows of ten agreeing, not five', () => {
    // In every other tenth of the film, up to `lost` of them, the file's lines are another film's.
    const other = film(TWO_HOURS, 2);
    const withLost = (lost: number) => {
      const gone = (t: number) => {
        const tenth = Math.floor((t - 30) / 717);
        return tenth % 2 === 1 && tenth < 2 * lost;
      };
      return fileFrom(reference, (t) => t)
        .filter((line) => !gone(line.start))
        .concat(other.filter((line) => gone(line.start)))
        .sort((a, b) => a.start - b.start);
    };
    const four = alignSubtitles(withLost(4), reference);
    expect(four.confidence).toBe('sure');
    expect(agreeing(four)).toBe(6);
    const five = alignSubtitles(withLost(5), reference);
    expect(five.confidence).toBe('unsure');
    expect(agreeing(five)).toBe(5);
    expect(five.prominence).toBeGreaterThan(10);
  });

  it('is sure only with two windows, 300 s in common and 40 lines of each', () => {
    // Ten minutes make two windows; nine make one.
    const ten = film(600, 1);
    expect(
      alignSubtitles(
        fileFrom(ten, (t) => t + 3),
        ten,
      ).confidence,
    ).toBe('sure');
    const nine = film(540, 1);
    const one = alignSubtitles(
      fileFrom(nine, (t) => t + 3),
      nine,
    );
    expect(one).toMatchObject({ confidence: 'unsure', windows: [expect.any(Number)] });
    expect(one.prominence).toBeGreaterThan(10);

    const file = fileFrom(reference, (t) => t + 3);
    // A reference of under 300 s against the whole file: two windows, both agreeing.
    const short = reference.filter((line) => line.start >= 500 && line.end <= 790);
    const brief = alignSubtitles(file, short);
    expect(brief.confidence).toBe('unsure');
    expect(brief.covered).toBeLessThan(300);
    expect(agreeing(brief)).toBe(2);
    // Seven minutes of a reference whose lines are joined in twos: the same speech, 28 lines.
    const part = reference.filter((line) => line.start >= 4250 && line.end <= 4670);
    const joined: LineTiming[] = [];
    for (let n = 0; n < part.length; n += 2) {
      joined.push({ start: part[n]!.start, end: part[Math.min(n + 1, part.length - 1)]!.end });
    }
    expect(joined.length).toBeLessThan(40);
    const few = alignSubtitles(file, joined);
    expect(few.confidence).toBe('unsure');
    expect(few.covered).toBeGreaterThan(300);
    expect(agreeing(few)).toBe(2);
  });

  it('is not sure where most of the file is lines the reference lacks', () => {
    // A reference with every other line: under 60% of the file's lines land on its speech.
    const sparse = reference.filter((_, n) => n % 2 === 0);
    const half = alignSubtitles(
      fileFrom(reference, (t) => t + 2),
      sparse,
    );
    expect(half.confidence).toBe('unsure');
    expect(half.matched).toBeLessThan(0.6);
    expect(agreeing(half)).toBe(10);
    // Dense dialogue: chance lands over half the lines on speech, so 60% is not enough.
    const dense = film(TWO_HOURS, 1, { gap: 0.5 });
    const some = alignSubtitles(
      fileFrom(dense, (t) => t + 2, { extra: 1 }),
      dense,
    );
    expect(some.confidence).toBe('sure');
    const most = alignSubtitles(
      fileFrom(dense, (t) => t + 2, { extra: 1.3 }),
      dense,
    );
    expect(most.confidence).toBe('unsure');
    expect(most.matched).toBeGreaterThan(0.6);
    expect(most.chance).toBeGreaterThan(0.5);
    expect(agreeing(most)).toBe(10);
  });

  it('with fewer than four windows, is sure only if every one agrees, far beyond chance', () => {
    const clip = film(15 * 60, 1);
    // The middle third's lines are another film's: two windows of three agree.
    const other = film(15 * 60, 51);
    const middle = (t: number) => Math.abs(t / (15 * 60) - 0.5) < 0.15;
    const mixed = alignSubtitles(
      fileFrom(clip, (t) => t)
        .filter((line) => !middle(line.start))
        .concat(other.filter((line) => middle(line.start)))
        .sort((a, b) => a.start - b.start),
      clip,
    );
    expect(mixed).toMatchObject({ confidence: 'unsure', windows: [0, null, 0].map(near) });
    expect(mixed.prominence).toBeGreaterThan(10);
    // Lines the reference lacks, nearly as many as its own: all three agree, but chance lands
    // so many lines on speech that those landing are not far enough beyond it.
    const padded = alignSubtitles(
      fileFrom(clip, (t) => t + 3, { extra: 0.9 }),
      clip,
    );
    expect(padded.confidence).toBe('unsure');
    expect(agreeing(padded)).toBe(3);
    expect(beyondChance(padded)).toBeLessThan(0.5);
    // Three of three agreeing, half way beyond chance or more: sure.
    const three = film(25 * 60, 2);
    const whole = alignSubtitles(partlyMoved(three, 0.36, 40, 5), three);
    expect(whole.confidence).toBe('sure');
    expect(agreeing(whole)).toBe(3);
    expect(beyondChance(whole)).toBeGreaterThan(0.5);
    expect(beyondChance(whole)).toBeLessThan(0.9);
    // Four windows are enough to say without every one: three of four agreeing are sure.
    const four = film(25 * 60, 1);
    const most = alignSubtitles(partlyMoved(four, 0.36, 40, 8), four);
    expect(most).toMatchObject({ confidence: 'sure', windows: [0, 0, 0, null].map(near) });
  });

  it('with too few windows to tell, says unsure from a peak of 1.15, and none under it', () => {
    // Seven minutes: one window, which a file for another video can agree with as well.
    const clip = film(420, 1);
    const weak = alignSubtitles(partlyMoved(clip, 0.45, 40), clip);
    expect(weak.confidence).toBe('unsure');
    expect(weak.windows).toHaveLength(1);
    expect(weak.prominence).toBeGreaterThan(1.15);
    expect(weak.prominence).toBeLessThan(1.6);
    const flat = alignSubtitles(partlyMoved(clip, 0.5, 40), clip);
    expect(flat.confidence).toBe('none');
    expect(flat.prominence).toBeLessThan(1.15);
  });

  it('is not sure of two episodes that share only their songs', () => {
    for (let n = 0; n < 10; n++) {
      for (const keep of [0.4, 0.5]) {
        const alignment = alignSubtitles(episode(100 + 2 * n, keep), episode(101 + 2 * n, keep));
        expect(alignment.confidence).toBe('unsure');
        expect(alignment.offset).toBeCloseTo(0, 1);
      }
    }
    // The same episode, songs and all, is.
    const own = episode(100, 0.5);
    const alignment = alignSubtitles(
      fileFrom(own, (t) => t + 3),
      own,
    );
    expect(alignment.confidence).toBe('sure');
    expect(alignment.offset).toBeCloseTo(-3, 1);
  });

  it('sees a part of the film that lines up more than a minute away', () => {
    // A cut with a scene of 90 s the video lacks, 36 minutes in.
    const alignment = alignSubtitles(
      fileFrom(reference, (t) => (t > 2160 ? t + 90 : t)),
      reference,
    );
    expect(alignment.confidence).toBe('unsure');
    expect(alignment.windows.slice(0, 3).every((delta) => Math.abs(delta! - 90) < 0.5)).toBe(true);
    expect(alignment.split?.jump).toBeCloseTo(-90, 0);
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

  it("is not sure of a file timed for a cut with a scene longer, or shorter, than the video's", () => {
    const end = strangerEnglish[strangerEnglish.length - 1]!.end;
    for (const scene of [90, -120]) {
      const cut = strangerEnglish.map((line) =>
        line.start > 0.3 * end ? { start: line.start + scene, end: line.end + scene } : line,
      );
      const alignment = alignSubtitles(cut, strangerHungarian);
      expect(alignment.confidence).toBe('unsure');
      // The lines before the scene line up on their own, the scene's length from the rest.
      expect(alignment.windows[0]).toBeCloseTo(scene, 0);
    }
  });

  it('says none for another episode of the same show, and for another show', () => {
    expect(alignSubtitles(strangerNext, strangerHungarian).confidence).toBe('none');
    expect(alignSubtitles(usNext, usHearing).confidence).toBe('none');
    expect(alignSubtitles(usArabic, strangerHungarian).confidence).toBe('none');
    expect(alignSubtitles(strangerEnglish, usHearing).confidence).toBe('none');
  });
});

describe('alignSubtitles on real timing at its gates (OpenSubtitles files, timing only)', () => {
  const shawshank = linesOf(boundaries.shawshankEnglishCd1);
  const oppenheimer = linesOf(boundaries.oppenheimerEnglish);
  const oppenheimerOtherCut = linesOf(boundaries.oppenheimerArabicOtherCut);
  const matrixGreek = linesOf(boundaries.matrixGreek);
  const matrixFrench = linesOf(boundaries.matrixFrench);
  const matrixFinnish = linesOf(boundaries.matrixFinnish);
  const thrones = linesOf(boundaries.gameOfThronesE01English);
  const usHearing = linesOf(timings.lastOfUsE01EnglishHearing);

  it('does not say none against five minutes of a reference that agree, though rates it cannot tell apart there differ elsewhere', () => {
    // A stream's track from 80% into the film, 5 minutes of it: 24 and 23.976 frames a second
    // put the file's lines on its lines alike there, and 8 s apart at the film's start.
    const file = linesOf(boundaries.interstellarBrazilian);
    const track = linesOf(boundaries.interstellarOtherFrom80);
    for (const growing of [true, false]) {
      const alignment = alignSubtitles(file, track, { growing });
      expect(alignment.confidence).toBe('unsure');
      expect(alignment.coveredShare).toBeLessThan(0.05);
      expect(alignment.prominence).toBeGreaterThan(1.6);
    }
  });

  it('says none for the highest peak a file for another video reached', () => {
    const alignment = alignSubtitles(shawshank, oppenheimer);
    expect(alignment.confidence).toBe('none');
    expect(alignment.prominence).toBeGreaterThan(1.3);
    expect(alignment.prominence).toBeLessThan(1.6);
  });

  it('says none for a peak over 1.25 that one window agrees with', () => {
    const alignment = alignSubtitles(thrones, usHearing);
    expect(alignment.confidence).toBe('none');
    expect(alignment.prominence).toBeGreaterThan(1.25);
    expect(agreeing(alignment)).toBe(1);
  });

  it('is not sure of a file for another cut, and says where it jumps', () => {
    const alignment = alignSubtitles(oppenheimerOtherCut, oppenheimer);
    expect(alignment.confidence).toBe('unsure');
    expect(alignment.split?.jump).toBeCloseTo(-30, 0);
    expect(alignment.split?.at).toBeGreaterThan(2800);
    expect(alignment.split?.at).toBeLessThan(3500);
  });

  it('is not sure of a file timed loosely, its windows over a second apart, nor says none', () => {
    const alignment = alignSubtitles(matrixGreek, matrixFrench);
    expect(alignment.confidence).toBe('unsure');
    expect(alignment.rate).toBe(1);
    expect(alignment.prominence).toBeGreaterThan(1.6);
  });

  it('takes a frame rate from a reference covering the film, never from one still arriving that covers under half', () => {
    const film25 = 24000 / 1001 / 25;
    const whole = alignSubtitles(matrixGreek, matrixFinnish);
    expect(whole).toMatchObject({ confidence: 'sure', rate: film25 });
    expect(whole.coveredShare).toBeGreaterThan(0.9);
    // 24 and 23.976 against 25 are 0.1% apart: lines a second apart after twenty minutes.
    for (const minutes of [20, 40]) {
      const arrived = matrixFinnish.filter((line) => line.end <= minutes * 60);
      const alignment = alignSubtitles(matrixGreek, arrived, { growing: true });
      expect(alignment.confidence).toBe('unsure');
      expect(alignment.coveredShare).toBeLessThan(0.5);
    }
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
