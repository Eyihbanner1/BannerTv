type Apply = (term: string) => void;

let waiting: string | undefined;
const takers = new Set<Apply>();

/**
 * Search shows `term` next, as if typed: a name from a title's cast, say. The
 * Search tab may not have opened yet, so the term waits for it.
 */
export function requestSearch(term: string): void {
  if (takers.size === 0) {
    waiting = term;
    return;
  }
  takers.forEach((apply) => apply(term));
}

/** For Search: the term waiting now, if any, then each one asked for. Returns the stop. */
export function takeSearchRequests(apply: Apply): () => void {
  takers.add(apply);
  if (waiting !== undefined) {
    const term = waiting;
    waiting = undefined;
    apply(term);
  }
  return () => {
    takers.delete(apply);
  };
}
