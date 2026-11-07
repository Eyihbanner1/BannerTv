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

export type SkipKind = 'intro' | 'recap';

export interface SkipSegment {
  kind: SkipKind;
  /** Where it starts, in seconds. */
  start: number;
  /** Where the skip lands, in seconds. */
  end: number;
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
 * play. Anything else in it (the outro, after-credits scenes) is left to Up
 * Next. Two that overlap keep the one that starts first.
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
