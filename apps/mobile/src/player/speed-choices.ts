import { SPEED_TEST_RATES } from '@bannertv/core';

/**
 * The phone's playback speeds: Normal, then the TV's (core's SPEED_TEST_RATES), in the order the
 * TV's Speed tab lists them. The TV offers the others only where Settings > Lab measured it
 * keeping them; a phone's player (Media3) keeps every one, so the phone offers them all. Never on
 * a broadcast, which can't run ahead of live. As on the TV, another stream or the next episode
 * starts at Normal again: the shared session sets it back for every stream it opens.
 */
export const PHONE_SPEEDS: readonly number[] = [1, ...SPEED_TEST_RATES];

/** The speed to mark as chosen: the one playing, or Normal for one the list doesn't have. */
export function chosenSpeed(rate: number): number {
  return PHONE_SPEEDS.indexOf(rate) >= 0 ? rate : 1;
}
