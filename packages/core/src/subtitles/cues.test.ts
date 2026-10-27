import { describe, expect, it } from 'vitest';
import { createCueIndex, sortByStart } from './cues';
import type { Cue } from './types';

function cue(start: number, end: number, text = `${start}-${end}`): Cue {
  return { start, end, lines: [[{ text }]] };
}

function names(cues: Cue[]): string[] {
  return cues.map((c) => c.lines[0]![0]!.text);
}

/** A small seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

describe('createCueIndex', () => {
  it('finds nothing in an empty file', () => {
    const index = createCueIndex([]);
    expect(index.at(0)).toEqual([]);
    expect(index.at(100)).toEqual([]);
  });

  it('shows a cue from its start up to, but not including, its end', () => {
    const index = createCueIndex([cue(1, 2), cue(2, 3)]);
    expect(names(index.at(0.999))).toEqual([]);
    expect(names(index.at(1))).toEqual(['1-2']);
    expect(names(index.at(1.999))).toEqual(['1-2']);
    expect(names(index.at(2))).toEqual(['2-3']);
    expect(names(index.at(3))).toEqual([]);
  });

  it('finds a long cue together with the short ones it spans, in start order', () => {
    const index = createCueIndex([cue(5, 6), cue(0, 100, 'long'), cue(7, 9), cue(8, 10)]);
    expect(names(index.at(5.5))).toEqual(['long', '5-6']);
    expect(names(index.at(6.5))).toEqual(['long']);
    expect(names(index.at(8.5))).toEqual(['long', '7-9', '8-10']);
    expect(names(index.at(99))).toEqual(['long']);
  });

  it('answers correctly when playback seeks backwards and forwards', () => {
    const index = createCueIndex([cue(10, 20), cue(30, 40), cue(50, 60)]);
    expect(names(index.at(55))).toEqual(['50-60']);
    expect(names(index.at(15))).toEqual(['10-20']);
    expect(names(index.at(25))).toEqual([]);
    expect(names(index.at(12))).toEqual(['10-20']);
    expect(names(index.at(35))).toEqual(['30-40']);
  });

  it('hands back the same list while nothing starts or ends', () => {
    const index = createCueIndex([cue(1, 3), cue(2, 4)]);
    const first = index.at(2.1);
    expect(index.at(2.5)).toBe(first);
    expect(index.at(2.9)).toBe(first);
    expect(names(index.at(3))).toEqual(['2-4']);
    expect(index.at(2.5)).not.toBe(first);
    expect(names(index.at(2.5))).toEqual(['1-3', '2-4']);
  });

  it('keeps the given order for cues that start together and ignores impossible cues', () => {
    const index = createCueIndex([
      cue(1, 5, 'a'),
      cue(1, 2, 'b'),
      cue(3, 3, 'empty'),
      cue(4, 2, 'backwards'),
      cue(NaN, 5, 'nan'),
      cue(1, 3, 'c'),
    ]);
    expect(names(index.at(1.5))).toEqual(['a', 'b', 'c']);
    expect(names(index.at(3))).toEqual(['a']);
    expect(index.at(NaN)).toEqual([]);
  });

  it('agrees with a plain scan over many overlapping cues at random times', () => {
    const next = random(42);
    const cues: Cue[] = [];
    for (let i = 0; i < 500; i++) {
      const start = Math.round(next() * 10000) / 10;
      const length = next() < 0.05 ? next() * 600 : next() * 6;
      cues.push(cue(start, start + 0.1 + Math.round(length * 10) / 10, String(i)));
    }
    const index = createCueIndex(cues);
    const expected = (time: number) =>
      sortByStart(cues.filter((c) => c.start <= time && time < c.end)).map((c) => c.lines);

    for (let i = 0; i < 2000; i++) {
      const time = Math.round(next() * 11000) / 10;
      expect(index.at(time).map((c) => c.lines)).toEqual(expected(time));
    }
    for (let time = 0; time < 1100; time += 0.1) {
      expect(index.at(time).map((c) => c.lines)).toEqual(expected(time));
    }
  });
});

describe('sortByStart', () => {
  it('sorts by start and keeps ties in order, beyond the size where V8 6.8 sorting was unstable', () => {
    const cues = Array.from({ length: 50 }, (_, i) => cue(i % 2 === 0 ? 1 : 0, 5, String(i)));
    const sorted = names(sortByStart(cues));
    const odd = cues.filter((_, i) => i % 2 === 1).map((c) => c.lines[0]![0]!.text);
    const even = cues.filter((_, i) => i % 2 === 0).map((c) => c.lines[0]![0]!.text);
    expect(sorted).toEqual([...odd, ...even]);
  });
});
