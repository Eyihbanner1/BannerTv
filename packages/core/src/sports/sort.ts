/**
 * Array.prototype.sort is not stable before Chromium 70, and webOS 5 runs
 * Chromium 68: equal items keep their order only through this.
 */
export function sortStable<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map((entry) => entry.item);
}
