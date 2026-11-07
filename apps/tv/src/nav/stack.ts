/** A screen stack: what the remote's Back walks down. Pure, so it can be tested off the TV. */
export interface Stack<R> {
  readonly screens: readonly R[];
}

export function push<R>(stack: Stack<R>, route: R): Stack<R> {
  return { screens: [...stack.screens, route] };
}

/** The top screen swapped for another, as the next episode replaces the player. */
export function replace<R>(stack: Stack<R>, route: R): Stack<R> {
  return { screens: [...stack.screens.slice(0, -1), route] };
}

/** One screen back, or null on the first screen, where Back leaves the app. */
export function pop<R>(stack: Stack<R>): Stack<R> | null {
  return stack.screens.length > 1 ? { screens: stack.screens.slice(0, -1) } : null;
}

/** Straight to a top-level screen (the nav row), leaving nothing above it. */
export function reset<R>(route: R): Stack<R> {
  return { screens: [route] };
}

export function top<R>(stack: Stack<R>): R {
  return stack.screens[stack.screens.length - 1]!;
}
