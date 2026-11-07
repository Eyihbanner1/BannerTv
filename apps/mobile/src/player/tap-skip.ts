/**
 * Double taps on the picture skip, and so do the 10 s buttons: each tap or press adds 10 s to
 * one total, which lands once, a moment after the last (core's SKIP_LANDS_AFTER_MS), as the
 * TV's remote does. Pure, so it is unit-tested; the player screen does the touches, the timer
 * and the drawing.
 */
import { skipStep } from '@bannertv/core';

/** A second tap on the same half of the picture within this long is a double tap. */
export const DOUBLE_TAP_MS = 280;

export type TapSide = 'left' | 'right';

/** A skip still adding up. */
export interface PendingSkip {
  /** Where the video was as the first tap or press came: the total counts from here. */
  readonly origin: number;
  /** Where it lands. */
  readonly target: number;
  /** The half of the picture its ripple shows on. */
  readonly side: TapSide;
}

/** Which half of a surface `width` wide a tap at x landed on. */
export function tapSide(x: number, width: number): TapSide {
  return x < width / 2 ? 'left' : 'right';
}

/**
 * What a tap on the picture means. While a skip is adding up every tap counts, on either half,
 * so a viewer can keep tapping without pairing taps up. Otherwise a second tap on the same half
 * soon after the first is a double tap, which starts a skip; anything else is a single tap,
 * which shows or hides the controls once no second tap has come.
 */
export function readTap(
  previous: { at: number; side: TapSide } | null,
  adding: boolean,
  now: number,
  side: TapSide,
): 'count' | 'double' | 'single' {
  if (adding) return 'count';
  if (previous && previous.side === side && now - previous.at < DOUBLE_TAP_MS) return 'double';
  return 'single';
}

/**
 * Adds one tap or press to the skip adding up, `direction` -1 for back and 1 for forward, or
 * starts one from `position`. Never before the start, and never past the last second of a file
 * with a length; one whose file gives no length yet is only kept from going before its start.
 *
 * A tap the other way counts back from the total so far rather than starting again, as Left
 * after Right does on the TV's remote: a tap too many is undone by one on the other half, and
 * the two apps land in the same place for the same taps. The ripple sits on the side the total
 * goes, so it moves only when the total turns round.
 */
export function addSkip(
  pending: PendingSkip | null,
  direction: -1 | 1,
  position: number,
  duration: number,
): PendingSkip {
  const origin = pending ? pending.origin : position;
  const from = pending ? pending.target : origin;
  const wanted = Math.max(0, from + direction * skipStep(0));
  const kept = duration > 0 ? Math.min(duration - 1, wanted) : wanted;
  // Within the last second already, a step forward stays put rather than going back.
  const target = direction > 0 ? Math.max(from, kept) : kept;
  const side: TapSide =
    target > origin ? 'right' : target < origin ? 'left' : direction < 0 ? 'left' : 'right';
  return { origin, target, side };
}

/** How far a skip goes from where the video was, in seconds: negative for back. */
export function skipTotal(pending: PendingSkip): number {
  return pending.target - pending.origin;
}
