/**
 * Skip intro and Skip recap: the stretches of an episode a viewer may jump
 * over, and when the player offers to. Times are in media seconds, as the
 * video's own clock counts them.
 *
 * The timings come from IntroDB (integrations/introdb), where viewers mark
 * them on one release of the episode. Another release can be cut a few
 * seconds differently, so the player only ever offers the skip: it never
 * jumps by itself.
 */

import { UP_NEXT_BEFORE_END_S } from './up-next';

export type SkipKind = 'intro' | 'recap';

export interface SkipSegment {
  kind: SkipKind;
  /** Where it starts, in seconds. */
  start: number;
  /** Where the skip lands, in seconds. */
  end: number;
  /** Learned from the viewer's own skips (learned-intros.ts), not IntroDB's. */
  learned?: true;
}

/** Nothing is offered in a segment's last seconds: there is too little left to skip. */
export const SKIP_TAIL_S = 2;
/**
 * The card offering the skip shows for this many watching seconds from when
 * it first appears, then goes, so it never sits over a whole recap. Watching
 * seconds are media seconds divided by the speed, as Up Next counts them.
 */
export const SKIP_CARD_S = 10;
/** A rewind this far back from where the card first showed shows it again. */
export const SKIP_REARM_S = 1;

/** The longest each kind can be: IntroDB's own limits (300 s for an intro, 480 s for a recap). */
const LONGEST: Readonly<Record<SkipKind, number>> = { intro: 300, recap: 480 };
/** The shortest worth a button. */
const SHORTEST_S = 5;

const KINDS: readonly SkipKind[] = ['recap', 'intro'];

function seconds(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return isFinite(n) ? n : undefined;
}

/** One of IntroDB's segment objects, in seconds, or undefined when it is missing or makes no sense. */
function readSegment(kind: SkipKind, raw: unknown): SkipSegment | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const fields = raw as Record<string, unknown>;
  const ms = (name: string) => {
    const value = seconds(fields[name]);
    return value === undefined ? undefined : value / 1000;
  };
  const start = seconds(fields.start_sec) ?? ms('start_ms');
  const end = seconds(fields.end_sec) ?? ms('end_ms');
  if (start === undefined || end === undefined || start < 0) return undefined;
  const length = end - start;
  if (length < SHORTEST_S || length > LONGEST[kind]) return undefined;
  return { kind, start, end };
}

/**
 * The intro and recap in an IntroDB /segments answer, in the order they
 * play. The end credits are read by readCredits, for Up Next. Two that
 * overlap keep the one that starts first.
 */
export function readSkipSegments(answer: unknown): SkipSegment[] {
  if (typeof answer !== 'object' || answer === null) return [];
  const fields = answer as Record<string, unknown>;
  const found: SkipSegment[] = [];
  for (const kind of KINDS) {
    const segment = readSegment(kind, fields[kind]);
    if (segment) found.push(segment);
  }
  found.sort((a, b) => a.start - b.start);
  return found.filter((segment, i) => i === 0 || segment.start >= found[i - 1]!.end);
}

/**
 * The segment the player is in now, if it is worth a skip: from its start
 * until SKIP_TAIL_S before its end. Never one that would land past the end
 * of the file (its timings are for a longer release), nor while the clock
 * is unknown. `duration` 0 or less means the length is not known yet.
 */
export function skipAt(
  segments: readonly SkipSegment[],
  position: number,
  duration: number,
): SkipSegment | undefined {
  if (!isFinite(position)) return undefined;
  return segments.find(
    (segment) =>
      position >= segment.start &&
      position < segment.end - SKIP_TAIL_S &&
      (!(duration > 0) || segment.end < duration),
  );
}

/** Names a segment, so the player can tell one offer from the next. */
export function skipKey(segment: SkipSegment): string {
  return `${segment.kind}:${segment.start}`;
}

/** Whether the card that first showed at `shownAt` has had its time, at the speed playing. */
export function skipCardDone(shownAt: number, position: number, rate = 1): boolean {
  const speed = isFinite(rate) && rate > 0 ? rate : 1;
  return (position - shownAt) / speed >= SKIP_CARD_S;
}

/** Whether a rewind went back far enough from where the card first showed to show it again. */
export function skipRearms(shownAt: number, position: number): boolean {
  return position < shownAt - SKIP_REARM_S;
}

/**
 * The end credits, as IntroDB marks them (its "outro"), and whether it marks
 * a scene after them. Up Next offers the next episode from their start.
 */
export interface CreditsMark {
  /** Where the credits start, in seconds. */
  start: number;
  /** Where they end, in seconds. */
  end: number;
  /** A scene plays after the credits, which starting the next episode would cut. */
  sceneAfter: boolean;
}

/** Credits longer than this are not credits a viewer sits through: the mark is for another cut. */
export const CREDITS_LONGEST_S = 600;
/**
 * The marked credits end this close to this file's end, either way, or the
 * file is another cut and the mark's start can't be trusted for it.
 */
export const CREDITS_FIT_S = 60;
/**
 * Closer still, the release is the one marked: only then may the next
 * episode start at the credits by itself ("Start next at credits").
 */
export const CREDITS_EXACT_S = 10;

/** IntroDB's end credits, in seconds, or undefined when it has none or they make no sense. */
export function readCredits(answer: unknown): CreditsMark | undefined {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const fields = answer as Record<string, unknown>;
  const outro = fields.outro;
  if (typeof outro !== 'object' || outro === null) return undefined;
  const at = (raw: Record<string, unknown>, name: 'start' | 'end') => {
    const sec = seconds(raw[`${name}_sec`]);
    if (sec !== undefined) return sec;
    const ms = seconds(raw[`${name}_ms`]);
    return ms === undefined ? undefined : ms / 1000;
  };
  const marked = outro as Record<string, unknown>;
  const start = at(marked, 'start');
  const end = at(marked, 'end');
  if (start === undefined || end === undefined || start <= 0) return undefined;
  const length = end - start;
  if (length < SHORTEST_S || length > CREDITS_LONGEST_S) return undefined;
  const after = fields.post_credits;
  const sceneAfter =
    typeof after === 'object' &&
    after !== null &&
    at(after as Record<string, unknown>, 'start') !== undefined;
  return { start, end, sceneAfter };
}

/** What IntroDB marks in an episode: the intro and recap to skip, and the end credits. */
export interface EpisodeMarks {
  segments: readonly SkipSegment[];
  credits?: CreditsMark;
  /**
   * IntroDB's viewers agree the episode has no intro (its no_intro): there
   * is nothing to skip, so no intro learned elsewhere in the series is offered.
   */
  noIntro?: true;
}

/** An IntroDB /segments answer, read. */
export function readEpisodeMarks(answer: unknown): EpisodeMarks {
  const segments = readSkipSegments(answer);
  const marks: EpisodeMarks = { segments };
  const fields =
    typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
  if (fields.no_intro === true && !segments.some((segment) => segment.kind === 'intro')) {
    marks.noIntro = true;
  }
  const credits = readCredits(answer);
  // Credits that start before the intro or recap has ended are not this episode's.
  const last = segments[segments.length - 1];
  if (credits && !(last && credits.start < last.end)) marks.credits = credits;
  return marks;
}

/** Where Up Next offers the next episode in the file playing, from IntroDB's credits mark. */
export interface CreditsCue {
  /** Where the credits start, in seconds. */
  start: number;
  /**
   * The release is the one IntroDB marked and nothing plays after the
   * credits: with "Start next at credits" on, the next episode may start here.
   */
  startsNext: boolean;
}

/**
 * The credits mark, if it fits the file playing: its credits end within
 * CREDITS_FIT_S of the file's end, and start before the last
 * UP_NEXT_BEFORE_END_S, which Up Next counts anyway. Undefined while the
 * length is unknown, or with no mark.
 *
 * Never early: a file longer than the one marked may have its extra time
 * before the credits, so their start moves on by all of it. A shorter one
 * keeps the marked start, which can then only be late.
 */
export function creditsCue(
  mark: CreditsMark | undefined,
  duration: number,
): CreditsCue | undefined {
  if (!mark || !isFinite(duration) || duration <= 0) return undefined;
  const miss = Math.abs(duration - mark.end);
  if (miss > CREDITS_FIT_S) return undefined;
  const start = mark.start + Math.max(0, duration - mark.end);
  if (start >= duration - UP_NEXT_BEFORE_END_S) return undefined;
  if (duration - start > CREDITS_LONGEST_S) return undefined;
  return { start, startsNext: !mark.sceneAfter && miss <= CREDITS_EXACT_S };
}
