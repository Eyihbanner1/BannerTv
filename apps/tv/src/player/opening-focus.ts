/**
 * What takes the remote's focus in the tracks sheet's Timing column as the sheet opens: decided
 * once, on the first draw that can say, and never again while the sheet stays open. Last
 * episode's timing offered then takes it ("Use it"); else the line last shown, once the lines
 * around now are read. Focus never follows the lines as they go by, nor comes to an offer or a
 * line that shows up later, so it never leaves wherever the viewer took it.
 */
export type OpeningFocus =
  /** The lines around now are not read yet. */
  | { kind: 'waiting' }
  /** The option to focus, by key (OFFER_FOCUS for "Use it"), or null for none. */
  | { kind: 'decided'; key: string | null };

/** The key "Use it" goes by. */
export const OFFER_FOCUS = 'offer';

export const WAITING: OpeningFocus = { kind: 'waiting' };
/** Nothing in the column takes focus: none did, or the one that did has had it. */
export const SPENT: OpeningFocus = { kind: 'decided', key: null };

/**
 * What takes focus, from what was decided and the column as it is drawn now: whether an offer
 * shows, whether the lines can be matched, whether they were read yet, and the key of the line
 * last shown (asked only when it decides).
 */
export function openingFocus(
  was: OpeningFocus,
  now: { offer: boolean; matching: boolean; read: boolean; line: () => string | undefined },
): OpeningFocus {
  if (was.kind === 'decided') return was;
  if (now.offer) return { kind: 'decided', key: OFFER_FOCUS };
  if (!now.matching) return SPENT;
  if (!now.read) return was;
  const line = now.line();
  return line === undefined ? SPENT : { kind: 'decided', key: line };
}

/** Whether the option named takes focus on this draw. */
export function takesFocus(focus: OpeningFocus, key: string): boolean {
  return focus.kind === 'decided' && focus.key === key;
}
