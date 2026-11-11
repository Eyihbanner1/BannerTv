/**
 * When Up Next is due, what its count shows, and what happens when a video
 * ends. Times are in watching seconds: media seconds divided by the playback
 * speed, so the count runs at the speed of the clock on the wall.
 */

/** Up Next is due this many watching seconds before the end, whatever the length. */
export const UP_NEXT_BEFORE_END_S = 30;
/** The countdown given after an end the viewer did not see counted down. */
export const UP_NEXT_AFTER_END_S = 10;
/**
 * A dismissed Up Next comes back once a rewind leaves this much more than
 * UP_NEXT_BEFORE_END_S to watch, so a jittery clock does not bring it back.
 */
export const UP_NEXT_REARM_S = 2;

const usable = (value: number): boolean => isFinite(value) && value > 0;

/** Watching seconds left, never below 0. Null while the length or the speed is unusable. */
function watchingLeft(position: number, duration: number, rate: number): number | null {
  if (!usable(duration) || !usable(rate) || !isFinite(position)) return null;
  return Math.max(0, duration - position) / rate;
}

/**
 * The number Up Next shows: watching seconds left to the real end, rounded
 * up and at most UP_NEXT_BEFORE_END_S, so it never counts up. 0 at or after
 * the end. Null while the length is unknown (0 on live streams) or the
 * speed is not positive.
 */
export function secondsToEnd(position: number, duration: number, rate = 1): number | null {
  const left = watchingLeft(position, duration, rate);
  return left === null ? null : Math.min(UP_NEXT_BEFORE_END_S, Math.ceil(left));
}

/**
 * Whether the video is in its last UP_NEXT_BEFORE_END_S watching seconds,
 * or past the end. False while the length is unknown.
 */
export function inLastStretch(position: number, duration: number, rate = 1): boolean {
  const left = watchingLeft(position, duration, rate);
  return left !== null && left <= UP_NEXT_BEFORE_END_S;
}

/**
 * Whether a rewind has gone far enough back to clear a dismissed Up Next.
 * False while the length is unknown.
 */
export function rearms(position: number, duration: number, rate = 1): boolean {
  const left = watchingLeft(position, duration, rate);
  return left !== null && left > UP_NEXT_BEFORE_END_S + UP_NEXT_REARM_S;
}

/**
 * With "Start next at credits" on, the card that comes up as the credits
 * start counts this many watching seconds, then the next episode plays.
 */
export const CREDITS_COUNT_S = 10;

/**
 * Where Up Next is in an episode:
 * - 'none': not due yet.
 * - 'credits': IntroDB's credits have started (`creditsAt`), before the last
 *   UP_NEXT_BEFORE_END_S. The card offers the next episode, or Watch credits.
 * - 'last': the last UP_NEXT_BEFORE_END_S, or past the end, counting to it.
 */
export type UpNextStage = 'none' | 'credits' | 'last';

/** Which stage of Up Next the episode is at. 'none' while the length is unknown. */
export function upNextStage(
  position: number,
  duration: number,
  rate = 1,
  creditsAt?: number,
): UpNextStage {
  if (inLastStretch(position, duration, rate)) return 'last';
  if (watchingLeft(position, duration, rate) === null) return 'none';
  return creditsAt !== undefined && position >= creditsAt ? 'credits' : 'none';
}

/** The card offered as the credits start, kept while they play. */
export interface CreditsCard {
  /** Where it first showed, in media seconds. */
  at: number;
  /** It counts CREDITS_COUNT_S, then the next episode plays. */
  counts: boolean;
  /** The viewer chose Watch credits (or Back): gone until a rewind before the credits. */
  gone: boolean;
}

/**
 * The credits card after a clock reading: it comes up once playback is past
 * the credits mark, stays while they play, and is forgotten once a rewind
 * goes UP_NEXT_REARM_S before the mark, so it comes again. `counts` says,
 * as it comes up, whether it counts down to the next episode.
 */
export function creditsCardAt(
  card: CreditsCard | null,
  position: number,
  creditsAt: number | undefined,
  counts: () => boolean,
): CreditsCard | null {
  if (creditsAt === undefined || !isFinite(position)) return null;
  if (position < creditsAt) return card && position < creditsAt - UP_NEXT_REARM_S ? null : card;
  return card ?? { at: position, counts: counts(), gone: false };
}

/**
 * The credits card's count: CREDITS_COUNT_S watching seconds from where it
 * came up, rounded up, never more than is left to the real end. 0 once it ran out.
 */
export function creditsCount(
  card: CreditsCard,
  position: number,
  duration: number,
  rate = 1,
): number {
  const speed = usable(rate) ? rate : 1;
  const left = Math.ceil(CREDITS_COUNT_S - Math.max(0, position - card.at) / speed);
  const toEnd = secondsToEnd(position, duration, speed);
  return Math.max(0, toEnd === null ? left : Math.min(left, toEnd));
}

/**
 * What the player does when a video ends:
 * - 'leave': back to the title's page.
 * - 'play': the next episode, now.
 * - 'hold': rest on the last frame. Once nothing holds the end, ask again;
 *   if the answer is still 'hold', give UP_NEXT_AFTER_END_S on the clock
 *   and ask again when it runs out, with `countedOnScreen` true.
 * - 'ask': show "Still watching?".
 * - 'sleep': pause under the sleep timer's dark screen.
 */
export type EndAction = 'leave' | 'play' | 'hold' | 'ask' | 'sleep';

/** What the player knows at the end of a video. */
export interface EndState {
  /** There is a next episode to play. */
  hasNext: boolean;
  /** A live broadcast: it never plays on into anything. */
  live: boolean;
  /** The viewer dismissed Up Next (Keep watching or Back). */
  dismissed: boolean;
  /** A sheet, a menu, a pending skip or a starting stream holds the end. */
  held: boolean;
  /** The viewer saw the count reach 0, on the card or on Next episode. */
  countedOnScreen: boolean;
  /** The sleep timer stops at this end. */
  sleepsHere: boolean;
  /** "Still watching?" is due. */
  stillWatching: boolean;
}

/**
 * The one decision at the end of a video, in this order: anything holding
 * the end wins, even on a film, so the player never leaves from under an
 * open sheet; then the sleep timer; then leaving, for a film, a broadcast or
 * a dismissed Up Next; then "Still watching?"; then the next episode, at
 * once if the viewer saw the count reach 0, or after a short countdown.
 */
export function endAction(state: EndState): EndAction {
  if (state.held) return 'hold';
  if (state.sleepsHere) return 'sleep';
  if (!state.hasNext || state.live || state.dismissed) return 'leave';
  if (state.stillWatching) return 'ask';
  return state.countedOnScreen ? 'play' : 'hold';
}
