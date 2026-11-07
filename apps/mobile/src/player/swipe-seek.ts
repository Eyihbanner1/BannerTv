/**
 * Swipe to seek: a finger dragged sideways across the picture moves the place to play from,
 * and the player goes there when the finger lifts. Small drags are fine-grained, a long one
 * covers minutes; how far a full swipe reaches grows with the video's length, within limits.
 * Pure, so it is unit-tested; the player screen does the touches and the drawing.
 */

/** Sideways movement before a touch counts as a swipe, not a tap. */
export const SWIPE_START_PX = 14;
/**
 * Touches starting this close to the left or right edge are left to Android's back gesture.
 */
export const SWIPE_EDGE_PX = 28;
/** A swipe must be this much more sideways than up or down. */
const SWIPE_SLOPE = 1.6;
/** Above 1, a short drag moves less than its share of the screen: fine control near the start. */
const SWIPE_CURVE = 1.35;
/** A full-width swipe reaches this share of the video... */
const RANGE_SHARE = 0.12;
/** ...but never less than a minute and a half... */
const RANGE_MIN_S = 90;
/** ...nor more than six minutes. */
const RANGE_MAX_S = 360;
/** When the file gives no length yet. */
const RANGE_UNKNOWN_S = 180;
/** A swipe that would move less than this is let go: the finger came back to where it began. */
export const SWIPE_MIN_MOVE_S = 1;

/** Whether a movement of (dx, dy) pixels is a sideways swipe yet. */
export function isSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_START_PX && Math.abs(dx) >= SWIPE_SLOPE * Math.abs(dy);
}

/** Whether a touch starting at x on a surface `width` wide began on the edge. */
export function startsAtEdge(x: number, width: number): boolean {
  return x < SWIPE_EDGE_PX || x > width - SWIPE_EDGE_PX;
}

/** How many seconds a swipe across the whole width moves, for a video `duration` long. */
export function swipeRange(duration: number): number {
  if (!(duration > 0)) return RANGE_UNKNOWN_S;
  return Math.max(RANGE_MIN_S, Math.min(RANGE_MAX_S, duration * RANGE_SHARE));
}

/**
 * Where a swipe of `dx` pixels (from where the finger went down) across a surface `width`
 * wide lands, from `origin`: whole seconds, never before the start, and never past the last
 * second of a file with a length.
 */
export function swipeTarget(origin: number, dx: number, width: number, duration: number): number {
  // Measured from where the touch became a swipe, so it starts from the place playing.
  const travel = Math.sign(dx) * Math.max(0, Math.abs(dx) - SWIPE_START_PX);
  const share = Math.max(-1, Math.min(1, travel / Math.max(1, width)));
  const moved = Math.sign(share) * Math.pow(Math.abs(share), SWIPE_CURVE) * swipeRange(duration);
  const wanted = Math.max(0, Math.round(origin + moved));
  return duration > 0 ? Math.min(Math.floor(duration - 1), wanted) : wanted;
}

/** Whether going from `origin` to `target` is worth a seek. */
export function swipeMoves(origin: number, target: number): boolean {
  return Math.abs(target - origin) >= SWIPE_MIN_MOVE_S;
}
