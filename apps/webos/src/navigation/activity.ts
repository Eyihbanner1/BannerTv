/**
 * Marks the page while the remote is in use. Motion that only decorates, such
 * as the hero's slow pan, holds still meanwhile: on a 4K TV every frame of it
 * is a full-screen redraw that competes with the frames a key press needs.
 */
const CLASS = 'is-browsing';
/** How long after the last key the page counts as idle again. */
export const IDLE_AFTER_MS = 3000;

let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Tells `listener` each time the remote is used. */
export function onActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markActivity(): void {
  listeners.forEach((listener) => listener());
  const root = document.documentElement;
  if (!root.classList.contains(CLASS)) root.classList.add(CLASS);
  clearTimeout(timer);
  timer = setTimeout(() => root.classList.remove(CLASS), IDLE_AFTER_MS);
}
