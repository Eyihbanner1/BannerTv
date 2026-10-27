/**
 * Moves a vertical stack of rows so the row with this focus key sits at the
 * top of its window, like Home under the hero. Rows mark themselves with
 * `data-row-key`. Spatial navigation measures layout positions, which a
 * transform does not change, so moving the stack never confuses it.
 */
export function slideTrack(track: HTMLElement | null, rowFocusKey: string | undefined): void {
  if (!track) return;
  const element = rowFocusKey
    ? track.querySelector<HTMLElement>(`[data-row-key="${rowFocusKey}"]`)
    : null;
  track.style.transform = element ? `translateY(${-element.offsetTop}px)` : '';
}
