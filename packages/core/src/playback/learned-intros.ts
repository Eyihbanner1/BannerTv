import { createPersisted } from '../persisted';
import type { KeyValueStore } from '../storage';
import type { Listener } from '../store';
import type { SkipSegment } from './skips';

/**
 * Skip intro where IntroDB has no timings: learned from the viewer. A skip
 * forward of LEARN_SHORTEST_S to LEARN_LONGEST_S in the first LEARN_WITHIN_S
 * of an episode is taken as its intro, once playback has gone on from where
 * it landed for LEARN_SETTLE_S without going back. The series' next episode
 * then offers Skip intro at the same place. Like IntroDB's, it only offers:
 * the player never skips by itself. Times are media seconds.
 */

/** Only a skip that starts this early in an episode can be its intro. */
export const LEARN_WITHIN_S = 600;
/** Shorter skips are the viewer finding their place, not an intro. */
export const LEARN_SHORTEST_S = 40;
/** Longer ones skip more than an intro. */
export const LEARN_LONGEST_S = 150;
/**
 * Played on this far past where the skip landed, it was the intro. A skip
 * back or forward before then corrects where it ends, or undoes it.
 */
export const LEARN_SETTLE_S = 15;
/**
 * Playback this far before where the skip landed (Back to, Start over, a
 * click on the bar) means it was undone. Less is a big file landing short.
 */
export const LEARN_UNDONE_S = 10;
/** How many series keep a learned intro, the least recently learned forgotten first. */
export const MAX_LEARNED = 300;

/** An intro as the viewer skipped it: from where they skipped to where it landed. */
export interface IntroGuess {
  start: number;
  end: number;
}

function fits(start: number, end: number): boolean {
  const length = end - start;
  return (
    isFinite(start) &&
    isFinite(end) &&
    start >= 0 &&
    start < LEARN_WITHIN_S &&
    length >= LEARN_SHORTEST_S &&
    length <= LEARN_LONGEST_S
  );
}

/**
 * The guess after a jump the viewer made by hand from `from` to `to`. With
 * no guess yet, a skip of the right length early on is one. With one not yet
 * settled, the jump corrects it: back before where it started undoes it,
 * back or forward from where it landed moves its end, if it still fits.
 */
export function guessIntro(guess: IntroGuess | null, from: number, to: number): IntroGuess | null {
  if (!guess) return fits(from, to) ? { start: from, end: to } : null;
  if (to <= guess.start) return null;
  return fits(guess.start, to) ? { start: guess.start, end: to } : null;
}

/**
 * What a clock reading says of a guess: 'learn' once playback has gone on
 * LEARN_SETTLE_S past where it landed, 'drop' once it is well before there
 * (the skip was undone), else 'wait'.
 */
export function guessSettles(guess: IntroGuess, position: number): 'learn' | 'drop' | 'wait' {
  if (!isFinite(position)) return 'wait';
  if (position < guess.end - LEARN_UNDONE_S) return 'drop';
  return position >= guess.end + LEARN_SETTLE_S ? 'learn' : 'wait';
}

/** A series' learned intro, and when it was learned (milliseconds since 1970). */
export interface LearnedIntro extends IntroGuess {
  at: number;
}

/**
 * The intro and recap to offer: IntroDB's, and the learned intro when
 * IntroDB has no intro for the episode, unless it overlaps IntroDB's recap.
 */
export function withLearnedIntro(
  segments: readonly SkipSegment[],
  learned: IntroGuess | undefined,
): readonly SkipSegment[] {
  if (!learned || segments.some((segment) => segment.kind === 'intro')) return segments;
  if (!fits(learned.start, learned.end)) return segments;
  const overlaps = segments.some(
    (segment) => learned.start < segment.end && segment.start < learned.end,
  );
  if (overlaps) return segments;
  const intro: SkipSegment = {
    kind: 'intro',
    start: learned.start,
    end: learned.end,
    learned: true,
  };
  return [...segments, intro].sort((a, b) => a.start - b.start);
}

export interface LearnedIntros {
  /** Reads what was learned. Safe to call more than once. */
  load(): Promise<void>;
  /** The intro learned for a series, by its meta id. */
  get(seriesId: string): LearnedIntro | undefined;
  /** Keeps an intro for a series, in place of any learned before. */
  learn(seriesId: string, intro: IntroGuess): void;
  subscribe(listener: Listener): () => void;
}

type Saved = Readonly<Record<string, LearnedIntro>>;

function readSaved(saved: unknown): Saved {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {};
  const kept: Record<string, LearnedIntro> = {};
  for (const [seriesId, raw] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { start, end, at } = raw as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof at !== 'number') continue;
    if (!fits(start, end) || !isFinite(at)) continue;
    kept[seriesId] = { start, end, at };
  }
  return kept;
}

/** The newest `max` of them. */
function trimmed(all: Record<string, LearnedIntro>, max: number): Record<string, LearnedIntro> {
  const ids = Object.keys(all);
  if (ids.length <= max) return all;
  const kept: Record<string, LearnedIntro> = {};
  ids
    .sort((a, b) => all[b]!.at - all[a]!.at)
    .slice(0, max)
    .forEach((id) => {
      kept[id] = all[id]!;
    });
  return kept;
}

/** Intros learned on this screen, by series, for one profile: kept on the screen, not synced. */
export function createLearnedIntros(options: {
  storage: KeyValueStore;
  now?: () => number;
  max?: number;
}): LearnedIntros {
  const { storage, now = Date.now, max = MAX_LEARNED } = options;
  const state = createPersisted<Saved>({
    storage,
    key: 'learnedIntros',
    initial: {},
    read: readSaved,
  });
  return {
    load: state.load,
    get: (seriesId) =>
      Object.prototype.hasOwnProperty.call(state.get(), seriesId)
        ? state.get()[seriesId]
        : undefined,
    learn(seriesId, intro) {
      if (!fits(intro.start, intro.end)) return;
      const learned: LearnedIntro = { start: intro.start, end: intro.end, at: now() };
      void state.update((all) => trimmed({ ...all, [seriesId]: learned }, max));
    },
    subscribe: state.subscribe,
  };
}
