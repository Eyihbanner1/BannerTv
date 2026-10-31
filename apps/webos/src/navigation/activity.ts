/**
 * Marks the page while the remote is in use. Motion that only decorates, such
 * as the hero's slow pan, holds still meanwhile: on a 4K TV every frame of it
 * is a full-screen redraw that competes with the frames a key press needs.
 */
const CLASS = 'is-browsing';
/** How long after the last key the page counts as idle again. */
export const IDLE_AFTER_MS = 3000;

let timer: ReturnType<typeof setTimeout> | undefined;
let lastAt = 0;
// Any use of the remote at all, the pointer's moves and clicks included.
let inputAt = 0;
let gap = Infinity;
const listeners = new Set<() => void>();

/** Tells `listener` each time the remote is used. */
export function onActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called for each key press, and each pointer move onto something new. */
export function markActivity(): void {
  const now = Date.now();
  gap = now - lastAt;
  lastAt = now;
  inputAt = now;
  listeners.forEach((listener) => listener());
  const root = document.documentElement;
  if (!root.classList.contains(CLASS)) root.classList.add(CLASS);
  clearTimeout(timer);
  timer = setTimeout(() => root.classList.remove(CLASS), IDLE_AFTER_MS);
}

/** How long before the latest key press (or pointer move) the one before it came. */
export function activityGap(): number {
  return gap;
}

/** How long ago the latest key press (or pointer move) came. */
export function sinceActivity(): number {
  return Date.now() - lastAt;
}

/**
 * The pointer moved or clicked. Unlike a key press it leaves the page's
 * motion alone: it only says someone is there.
 */
export function noteInput(): void {
  inputAt = Date.now();
}

/** How long ago anyone used the remote: a key, the wheel, or the pointer moving or clicking. */
export function sinceInput(): number {
  return Date.now() - inputAt;
}
