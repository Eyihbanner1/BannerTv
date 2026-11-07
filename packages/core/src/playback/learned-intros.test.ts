import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import {
  createLearnedIntros,
  guessIntro,
  guessSettles,
  introKnown,
  LEARN_LONGEST_S,
  LEARN_SETTLE_S,
  LEARN_SHORTEST_S,
  LEARN_UNDONE_S,
  LEARN_WITHIN_S,
  withLearnedIntro,
} from './learned-intros';

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('guessIntro', () => {
  it('takes a skip forward of an intro’s length early in an episode as its intro', () => {
    expect(guessIntro(null, 62, 152)).toEqual({ start: 62, end: 152 });
    expect(guessIntro(null, 0, LEARN_SHORTEST_S)).toEqual({ start: 0, end: LEARN_SHORTEST_S });
    expect(guessIntro(null, 10, 10 + LEARN_LONGEST_S)).toEqual({
      start: 10,
      end: 10 + LEARN_LONGEST_S,
    });
  });

  it('ignores skips too short, too long, backwards or too late', () => {
    expect(guessIntro(null, 62, 62 + LEARN_SHORTEST_S - 1)).toBeNull();
    expect(guessIntro(null, 62, 62 + LEARN_LONGEST_S + 1)).toBeNull();
    expect(guessIntro(null, 152, 62)).toBeNull();
    expect(guessIntro(null, LEARN_WITHIN_S, LEARN_WITHIN_S + 60)).toBeNull();
    expect(guessIntro(null, NaN, 90)).toBeNull();
  });

  it('lets the next jump correct where it ends, or undo it', () => {
    const guess = { start: 62, end: 152 };
    // Overshot: back a little.
    expect(guessIntro(guess, 152, 142)).toEqual({ start: 62, end: 142 });
    // Short: on a little.
    expect(guessIntro(guess, 152, 172)).toEqual({ start: 62, end: 172 });
    // Back to where it began, or before: no intro.
    expect(guessIntro(guess, 152, 62)).toBeNull();
    expect(guessIntro(guess, 152, 20)).toBeNull();
    // Corrected out of an intro's length: no intro either.
    expect(guessIntro(guess, 152, 80)).toBeNull();
    expect(guessIntro(guess, 152, 300)).toBeNull();
  });
});

describe('guessSettles', () => {
  const guess = { start: 62, end: 152 };

  it('learns once playback goes on past where it landed', () => {
    expect(guessSettles(guess, 152)).toBe('wait');
    expect(guessSettles(guess, 152 + LEARN_SETTLE_S - 0.1)).toBe('wait');
    expect(guessSettles(guess, 152 + LEARN_SETTLE_S)).toBe('learn');
  });

  it('waits through a big file landing a little short, and drops a skip undone', () => {
    expect(guessSettles(guess, 152 - LEARN_UNDONE_S)).toBe('wait');
    expect(guessSettles(guess, 152 - LEARN_UNDONE_S - 0.1)).toBe('drop');
    // Back to where it began: the viewer watches the intro after all.
    expect(guessSettles(guess, 62)).toBe('drop');
    expect(guessSettles(guess, NaN)).toBe('wait');
  });
});

describe('introKnown', () => {
  it('is known where IntroDB times an intro or says there is none, not where it only learned one', () => {
    expect(introKnown({ segments: [{ kind: 'intro', start: 30, end: 60 }] })).toBe(true);
    expect(introKnown({ segments: [], noIntro: true })).toBe(true);
    expect(introKnown({ segments: [] })).toBe(false);
    expect(introKnown({ segments: [{ kind: 'recap', start: 0, end: 40 }] })).toBe(false);
    expect(introKnown({ segments: [{ kind: 'intro', start: 30, end: 90, learned: true }] })).toBe(
      false,
    );
  });
});

describe('withLearnedIntro', () => {
  const learned = { start: 62, end: 152 };

  it('adds the learned intro where IntroDB has none, in the order they play', () => {
    expect(withLearnedIntro([], learned)).toEqual([
      { kind: 'intro', start: 62, end: 152, learned: true },
    ]);
    expect(withLearnedIntro([{ kind: 'recap', start: 0, end: 40 }], learned)).toEqual([
      { kind: 'recap', start: 0, end: 40 },
      { kind: 'intro', start: 62, end: 152, learned: true },
    ]);
  });

  it("keeps IntroDB's intro, and never lays one over its recap", () => {
    const introDb = [{ kind: 'intro' as const, start: 30, end: 60 }];
    expect(withLearnedIntro(introDb, learned)).toBe(introDb);
    const recap = [{ kind: 'recap' as const, start: 0, end: 80 }];
    expect(withLearnedIntro(recap, learned)).toBe(recap);
    expect(withLearnedIntro(recap, undefined)).toBe(recap);
  });
});

describe('createLearnedIntros', () => {
  it('keeps the newest intro of each series, across launches', async () => {
    const storage = memoryKeyValueStore();
    let time = 1000;
    const intros = createLearnedIntros({ storage, now: () => time });
    await intros.load();
    expect(intros.get('tt1')).toBeUndefined();
    intros.learn('tt1', { start: 62, end: 152 });
    await flush();
    expect(intros.get('tt1')).toEqual({ start: 62, end: 152, at: 1000 });
    time = 2000;
    intros.learn('tt1', { start: 60, end: 150 });
    await flush();
    expect(intros.get('tt1')).toEqual({ start: 60, end: 150, at: 2000 });

    const relaunched = createLearnedIntros({ storage });
    await relaunched.load();
    expect(relaunched.get('tt1')).toEqual({ start: 60, end: 150, at: 2000 });
    expect(relaunched.get('toString')).toBeUndefined();
  });

  it('learns nothing that is not an intro, and reads past anything broken in storage', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('learnedIntros', {
      good: { start: 10, end: 70, at: 5 },
      long: { start: 10, end: 500, at: 5 },
      text: { start: '10', end: 70, at: 5 },
      none: null,
    });
    const intros = createLearnedIntros({ storage });
    await intros.load();
    expect(intros.get('good')).toEqual({ start: 10, end: 70, at: 5 });
    expect(intros.get('long')).toBeUndefined();
    expect(intros.get('text')).toBeUndefined();
    intros.learn('short', { start: 10, end: 20 });
    await flush();
    expect(intros.get('short')).toBeUndefined();
  });

  it('forgets the least recently learned past its limit, and tells listeners', async () => {
    let time = 0;
    const intros = createLearnedIntros({ storage: memoryKeyValueStore(), now: () => time, max: 2 });
    await intros.load();
    let told = 0;
    intros.subscribe(() => {
      told += 1;
    });
    for (const id of ['a', 'b', 'c']) {
      time += 1;
      intros.learn(id, { start: 10, end: 70 });
      await flush();
    }
    expect(told).toBe(3);
    expect(intros.get('a')).toBeUndefined();
    expect(intros.get('b')).toBeDefined();
    expect(intros.get('c')).toBeDefined();
  });
});
